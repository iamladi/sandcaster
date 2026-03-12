import { readFileSync } from "node:fs";
import type {
	RunOptions,
	SandcasterConfig,
	SandcasterEvent,
} from "@sandcaster/core";
import {
	loadConfig as coreLoadConfig,
	runAgentInSandbox,
} from "@sandcaster/core";
import { defineCommand } from "citty";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QueryArgs {
	prompt: string;
	model?: string;
	provider?: "anthropic" | "vertex" | "bedrock" | "openrouter";
	file: string[];
	timeout: number;
	maxTurns?: number;
	noTui: boolean;
}

export interface QueryDeps {
	runAgent: (options: RunOptions) => AsyncGenerator<SandcasterEvent>;
	loadConfig: (dir?: string) => SandcasterConfig | null;
	stdout: { write: (data: string) => boolean };
	readFile: (path: string) => string;
	exit: (code: number) => void;
}

// ---------------------------------------------------------------------------
// Core logic (injectable for testing)
// ---------------------------------------------------------------------------

export async function executeQuery(
	args: QueryArgs,
	deps: QueryDeps,
): Promise<void> {
	const config = deps.loadConfig();

	// Read file contents
	let files: Record<string, string> | undefined;
	if (args.file && args.file.length > 0) {
		files = {};
		for (const filePath of args.file) {
			files[filePath] = deps.readFile(filePath);
		}
	}

	const request = {
		prompt: args.prompt,
		...(args.model !== undefined ? { model: args.model } : {}),
		...(args.provider !== undefined ? { provider: args.provider } : {}),
		...(args.timeout !== undefined ? { timeout: args.timeout } : {}),
		...(args.maxTurns !== undefined ? { maxTurns: args.maxTurns } : {}),
		...(files !== undefined ? { files } : {}),
	};

	const options: RunOptions = {
		request,
		...(config !== null ? { config } : {}),
	};

	if (args.noTui) {
		let exitCode = 1;
		for await (const event of deps.runAgent(options)) {
			deps.stdout.write(`${JSON.stringify(event)}\n`);
			if (event.type === "result") {
				exitCode = 0;
			} else if (event.type === "error") {
				exitCode = 1;
			}
		}
		deps.exit(exitCode);
	} else {
		// TUI path — stub for Phase 2
		// TODO: render Ink <App> component
		for await (const event of deps.runAgent(options)) {
			deps.stdout.write(`${JSON.stringify(event)}\n`);
		}
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
			default: "300",
		},
		"max-turns": {
			type: "string",
			description: "Max agent turns",
		},
		"no-tui": {
			type: "boolean",
			description: "Output JSON lines to stdout instead of TUI",
			default: false,
		},
	},
	async run({ args }) {
		const fileArg = args.file;
		const files = fileArg ? (Array.isArray(fileArg) ? fileArg : [fileArg]) : [];

		const maxTurnsRaw = args["max-turns"];
		const maxTurns =
			maxTurnsRaw !== undefined ? Number(maxTurnsRaw) : undefined;

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
				model: args.model as string | undefined,
				provider,
				file: files,
				timeout: Number(args.timeout),
				maxTurns,
				noTui: args["no-tui"] as boolean,
			},
			prodDeps,
		);
	},
});
