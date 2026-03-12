import { readFileSync } from "node:fs";
import type {
	RunOptions,
	SandcasterConfig,
	SandcasterEvent,
} from "@sandcaster/core";
import {
	loadConfig as coreLoadConfig,
	runAgentInSandbox,
	SandcasterConfigSchema,
} from "@sandcaster/core";
import { defineCommand } from "citty";
import { render as inkRender } from "ink";
import type { ReactElement } from "react";
import type { StarterDefinition } from "../starters/catalog.js";
import { resolveStarter as catalogResolveStarter } from "../starters/catalog.js";
import { App } from "../tui/App.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QueryArgs {
	prompt: string;
	model?: string;
	provider?: "anthropic" | "vertex" | "bedrock" | "openrouter";
	file: string[];
	timeout?: number;
	maxTurns?: number;
	noTui: boolean;
	template?: string;
}

export type InkInstance = ReturnType<typeof inkRender>;

export interface QueryDeps {
	runAgent: (options: RunOptions) => AsyncGenerator<SandcasterEvent>;
	loadConfig: (dir?: string) => SandcasterConfig | null;
	stdout: { write: (data: string) => boolean };
	readFile: (path: string) => string;
	exit: (code: number) => void;
	render?: (element: ReactElement) => InkInstance;
	resolveStarter: (name: string) => StarterDefinition;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract skill name from extraFiles path like ".claude/skills/owasp-top-10/SKILL.md"
 * Returns the directory name (e.g., "owasp-top-10").
 */
function extractSkillName(path: string): string | null {
	const match = /\.claude\/skills\/([a-zA-Z0-9_-]+)\/SKILL\.md$/.exec(path);
	return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Core logic (injectable for testing)
// ---------------------------------------------------------------------------

export async function executeQuery(
	args: QueryArgs,
	deps: QueryDeps,
): Promise<void> {
	let config: SandcasterConfig | null = null;
	let extraSkills: Record<string, string> | undefined;

	if (args.template !== undefined) {
		// Template mode: resolve starter, validate configJson, skip loadConfig
		let starter: StarterDefinition;
		try {
			starter = deps.resolveStarter(args.template);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			deps.stdout.write(`${msg}\n`);
			deps.exit(1);
			return;
		}

		const parsed = SandcasterConfigSchema.safeParse(starter.configJson);
		if (!parsed.success) {
			deps.stdout.write(
				`Invalid template config for "${starter.slug}": ${parsed.error.message}\n`,
			);
			deps.exit(1);
			return;
		}
		config = parsed.data;

		// Convert extraFiles skill paths to extraSkills
		if (starter.extraFiles) {
			const skills: Record<string, string> = {};
			for (const [path, content] of Object.entries(starter.extraFiles)) {
				const skillName = extractSkillName(path);
				if (skillName) {
					skills[skillName] = content;
				}
			}
			if (Object.keys(skills).length > 0) {
				extraSkills = skills;
			}
		}
	} else {
		config = deps.loadConfig();
	}

	// Read file contents
	let files: Record<string, string> | undefined;
	if (args.file && args.file.length > 0) {
		files = {};
		for (const filePath of args.file) {
			try {
				files[filePath] = deps.readFile(filePath);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				deps.stdout.write(`Error reading file ${filePath}: ${msg}\n`);
				deps.exit(1);
				return;
			}
		}
	}

	// Only set request.timeout when the user explicitly passed --timeout.
	// When not provided: let config (template or local) handle it.
	// Fall back to 300 only when no source provides a timeout.
	const effectiveTimeout =
		args.timeout !== undefined
			? args.timeout
			: config?.timeout !== undefined
				? undefined
				: 300;

	const request = {
		prompt: args.prompt,
		...(args.model !== undefined ? { model: args.model } : {}),
		...(args.provider !== undefined ? { provider: args.provider } : {}),
		...(effectiveTimeout !== undefined ? { timeout: effectiveTimeout } : {}),
		...(args.maxTurns !== undefined ? { maxTurns: args.maxTurns } : {}),
		...(files !== undefined ? { files } : {}),
		...(extraSkills !== undefined ? { extraSkills } : {}),
	};

	const options: RunOptions = {
		request,
		...(config !== null ? { config } : {}),
	};

	if (args.noTui) {
		let exitCode = 1;
		let hasError = false;
		for await (const event of deps.runAgent(options)) {
			deps.stdout.write(`${JSON.stringify(event)}\n`);
			if (event.type === "error") {
				hasError = true;
			} else if (event.type === "result" && !hasError) {
				exitCode = 0;
			}
		}
		deps.exit(hasError ? 1 : exitCode);
	} else {
		const generator = deps.runAgent(options);
		const renderFn = deps.render ?? inkRender;
		let exitCode = 0;
		const instance = renderFn(
			<App
				eventSource={generator}
				onExit={(code) => {
					exitCode = code;
				}}
			/>,
		);
		await instance.waitUntilExit();
		deps.exit(exitCode);
	}
}

// ---------------------------------------------------------------------------
// Production deps
// ---------------------------------------------------------------------------

const prodDeps: QueryDeps = {
	runAgent: runAgentInSandbox,
	loadConfig: coreLoadConfig,
	stdout: process.stdout,
	readFile: (path: string) => readFileSync(path, "utf-8"),
	exit: (code: number) => process.exit(code),
	render: inkRender,
	resolveStarter: catalogResolveStarter,
};

// ---------------------------------------------------------------------------
// citty command definition
// ---------------------------------------------------------------------------

export const queryCommand = defineCommand({
	meta: {
		name: "query",
		description: "Run an AI agent in an E2B sandbox",
	},
	args: {
		prompt: {
			type: "positional",
			required: true,
			description: "The query to run",
		},
		template: {
			type: "string",
			alias: "T",
			description: "Use a template (starter) for this query",
		},
		model: {
			type: "string",
			alias: "m",
			description: "Model override",
		},
		provider: {
			type: "string",
			description: "Provider (anthropic, vertex, bedrock, openrouter)",
		},
		file: {
			type: "string",
			alias: "f",
			description: "Files to upload (can be specified multiple times)",
		},
		timeout: {
			type: "string",
			alias: "t",
			description: "Sandbox timeout in seconds",
		},
		"max-turns": {
			type: "string",
			description: "Max agent turns",
		},
		tui: {
			type: "boolean",
			description: "Use the TUI (pass --no-tui for JSON lines to stdout)",
			default: true,
		},
	},
	async run({ args }) {
		const fileArg = args.file;
		const files = fileArg ? (Array.isArray(fileArg) ? fileArg : [fileArg]) : [];

		const maxTurnsRaw = args["max-turns"];
		let maxTurns: number | undefined;
		if (maxTurnsRaw !== undefined) {
			maxTurns = Number(maxTurnsRaw);
			if (!Number.isFinite(maxTurns) || maxTurns < 1) {
				console.error(`Invalid --max-turns value: ${maxTurnsRaw}`);
				process.exit(1);
			}
		}

		let timeout: number | undefined;
		if (args.timeout !== undefined) {
			timeout = Number(args.timeout);
			if (!Number.isFinite(timeout) || timeout < 1) {
				console.error(`Invalid --timeout value: ${args.timeout}`);
				process.exit(1);
			}
		}

		const providerRaw = args.provider as string | undefined;
		const validProviders = [
			"anthropic",
			"vertex",
			"bedrock",
			"openrouter",
		] as const;
		const provider =
			providerRaw !== undefined &&
			validProviders.includes(providerRaw as (typeof validProviders)[number])
				? (providerRaw as (typeof validProviders)[number])
				: undefined;

		await executeQuery(
			{
				prompt: args.prompt as string,
				template: args.template as string | undefined,
				model: args.model as string | undefined,
				provider,
				file: files,
				timeout,
				maxTurns,
				noTui: !(args.tui as boolean),
			},
			prodDeps,
		);
	},
});
