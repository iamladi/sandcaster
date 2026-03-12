import {
	existsSync,
	mkdirSync,
	readdirSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { defineCommand } from "citty";
import type { StarterDefinition } from "../starters/catalog.js";
import {
	listStarters as catalogListStarters,
	resolveStarter as catalogResolveStarter,
	ENV_EXAMPLE,
} from "../starters/catalog.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InitArgs {
	starter?: string;
	directory?: string;
	list: boolean;
	force: boolean;
}

export interface InitDeps {
	listStarters: () => StarterDefinition[];
	resolveStarter: (name: string) => StarterDefinition;
	writeFile: (path: string, content: string) => void;
	mkdirp: (path: string) => void;
	exists: (path: string) => boolean;
	isDir: (path: string) => boolean;
	isEmpty: (path: string) => boolean;
	stdout: { write: (data: string) => boolean };
	exit: (code: number) => void;
	prompt?: (question: string, choices?: string[]) => Promise<string>;
	getEnv: (name: string) => string;
}

// ---------------------------------------------------------------------------
// Provider env detection (ported from Sandstorm)
// ---------------------------------------------------------------------------

function resolveEnvValues(
	getEnv: (name: string) => string,
): Record<string, string> {
	const values: Record<string, string> = {};

	const e2bApiKey = getEnv("E2B_API_KEY");
	if (e2bApiKey) values.E2B_API_KEY = e2bApiKey;

	const copyIfPresent = (...names: string[]) => {
		for (const name of names) {
			const val = getEnv(name);
			if (val) values[name] = val;
		}
	};

	if (getEnv("CLAUDE_CODE_USE_VERTEX")) {
		copyIfPresent(
			"CLAUDE_CODE_USE_VERTEX",
			"CLOUD_ML_REGION",
			"ANTHROPIC_VERTEX_PROJECT_ID",
			"GOOGLE_APPLICATION_CREDENTIALS",
		);
		return values;
	}

	if (getEnv("CLAUDE_CODE_USE_BEDROCK")) {
		copyIfPresent(
			"CLAUDE_CODE_USE_BEDROCK",
			"AWS_REGION",
			"AWS_ACCESS_KEY_ID",
			"AWS_SECRET_ACCESS_KEY",
			"AWS_SESSION_TOKEN",
		);
		return values;
	}

	if (getEnv("CLAUDE_CODE_USE_FOUNDRY")) {
		copyIfPresent(
			"CLAUDE_CODE_USE_FOUNDRY",
			"AZURE_FOUNDRY_RESOURCE",
			"AZURE_API_KEY",
		);
		return values;
	}

	const baseUrl = getEnv("ANTHROPIC_BASE_URL");
	const openrouterKey = getEnv("OPENROUTER_API_KEY");

	if (openrouterKey || baseUrl.includes("openrouter.ai")) {
		values.ANTHROPIC_BASE_URL = baseUrl || "https://openrouter.ai/api";
		copyIfPresent("OPENROUTER_API_KEY");
		return values;
	}

	if (baseUrl) {
		values.ANTHROPIC_BASE_URL = baseUrl;
		copyIfPresent("ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY");
		return values;
	}

	const anthropicKey = getEnv("ANTHROPIC_API_KEY");
	if (anthropicKey) {
		values.ANTHROPIC_API_KEY = anthropicKey;
	}

	return values;
}

function hasProviderEnv(getEnv: (name: string) => string): boolean {
	const providerVars = [
		"CLAUDE_CODE_USE_VERTEX",
		"CLAUDE_CODE_USE_BEDROCK",
		"CLAUDE_CODE_USE_FOUNDRY",
		"OPENROUTER_API_KEY",
		"ANTHROPIC_BASE_URL",
		"ANTHROPIC_API_KEY",
	];
	return providerVars.some((v) => !!getEnv(v));
}

function buildEnvFileContent(values: Record<string, string>): string {
	return `${Object.entries(values)
		.filter(([, v]) => v)
		.map(([k, v]) => `${k}=${v}`)
		.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Core logic (injectable for testing)
// ---------------------------------------------------------------------------

export async function executeInit(
	args: InitArgs,
	deps: InitDeps,
): Promise<void> {
	// --list: print starters and return
	if (args.list) {
		const starters = deps.listStarters();
		for (const starter of starters) {
			deps.stdout.write(`${starter.slug}  — ${starter.title}\n`);
			deps.stdout.write(`  ${starter.description}\n`);
		}
		return;
	}

	// Require starter name
	if (!args.starter) {
		deps.stdout.write(
			"Usage: sandcaster init <starter> [directory]\n\nAvailable starters:\n",
		);
		for (const starter of deps.listStarters()) {
			deps.stdout.write(`  ${starter.slug}\n`);
		}
		deps.exit(1);
		return;
	}

	// Resolve starter
	let starter: StarterDefinition;
	try {
		starter = deps.resolveStarter(args.starter);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		deps.stdout.write(`Error: ${msg}\n`);
		deps.exit(1);
		return;
	}

	// Determine destination directory
	const destDir = args.directory ?? starter.slug;

	// Validate destination
	if (deps.exists(destDir) && deps.isDir(destDir) && !deps.isEmpty(destDir)) {
		if (!args.force) {
			deps.stdout.write(
				`Error: directory "${destDir}" already exists and is not empty. Use --force to overwrite.\n`,
			);
			deps.exit(1);
			return;
		}
	}

	// Create destination directory
	deps.mkdirp(destDir);

	// Write core files
	deps.writeFile(
		`${destDir}/sandcaster.json`,
		JSON.stringify(starter.configJson, null, 2),
	);
	deps.writeFile(`${destDir}/README.md`, starter.readme);
	deps.writeFile(`${destDir}/.env.example`, ENV_EXAMPLE);

	// Write extra files
	if (starter.extraFiles) {
		for (const [relativePath, content] of Object.entries(starter.extraFiles)) {
			deps.writeFile(`${destDir}/${relativePath}`, content);
		}
	}

	// Write .env if provider env vars are detected and .env doesn't already exist
	const envPath = `${destDir}/.env`;
	if (!deps.exists(envPath) && hasProviderEnv(deps.getEnv)) {
		const envValues = resolveEnvValues(deps.getEnv);
		const envContent = buildEnvFileContent(envValues);
		if (envContent.trim()) {
			deps.writeFile(envPath, envContent);
		}
	}

	// Print success
	deps.stdout.write(`\nInitialized ${starter.slug} in ${destDir}.\n`);
	deps.stdout.write("\nNext steps:\n");
	deps.stdout.write(`  cd ${destDir}\n`);
	deps.stdout.write(`  ${starter.nextStepCommand}\n`);
}

// ---------------------------------------------------------------------------
// Production deps
// ---------------------------------------------------------------------------

const prodDeps: InitDeps = {
	listStarters: catalogListStarters,
	resolveStarter: catalogResolveStarter,
	writeFile: (path: string, content: string) => {
		// Ensure parent directories exist
		const dir = path.substring(0, path.lastIndexOf("/"));
		if (dir) mkdirSync(dir, { recursive: true });
		writeFileSync(path, content, "utf-8");
	},
	mkdirp: (path: string) => mkdirSync(path, { recursive: true }),
	exists: (path: string) => existsSync(path),
	isDir: (path: string) => {
		try {
			return statSync(path).isDirectory();
		} catch {
			return false;
		}
	},
	isEmpty: (path: string) => {
		try {
			return readdirSync(path).length === 0;
		} catch {
			return true;
		}
	},
	stdout: process.stdout,
	exit: (code: number) => process.exit(code),
	getEnv: (name: string) => process.env[name]?.trim() ?? "",
};

// ---------------------------------------------------------------------------
// citty command definition
// ---------------------------------------------------------------------------

export type CommandDef = ReturnType<typeof defineCommand>;

export const initCommand: CommandDef = defineCommand({
	meta: {
		name: "init",
		description: "Initialize a sandcaster.json config from a starter template",
	},
	args: {
		starter: {
			type: "positional",
			required: false,
			description: "Starter template name (or alias)",
		},
		directory: {
			type: "positional",
			required: false,
			description: "Destination directory (defaults to starter slug)",
		},
		list: {
			type: "boolean",
			default: false,
			description: "List available starters",
		},
		force: {
			type: "boolean",
			default: false,
			description: "Overwrite files in an existing directory",
		},
	},
	async run({ args }) {
		await executeInit(
			{
				starter: args.starter as string | undefined,
				directory: args.directory as string | undefined,
				list: args.list as boolean,
				force: args.force as boolean,
			},
			prodDeps,
		);
	},
});
