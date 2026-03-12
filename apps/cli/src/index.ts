#!/usr/bin/env node
import { defineCommand, runMain } from "citty";
import { initCommand } from "./commands/init.js";
import type { QueryArgs } from "./commands/query.js";
import { queryCommand } from "./commands/query.js";
import { serveCommand } from "./commands/serve.js";
import { webhookCommand } from "./commands/webhook.js";

export const defaultQueryArgs: Omit<QueryArgs, "prompt"> = {
	file: [],
	timeout: 300,
	noTui: false,
	model: undefined,
	provider: undefined,
	maxTurns: undefined,
};

const main = defineCommand({
	meta: {
		name: "sandcaster",
		description: "Run AI agents in E2B sandboxes",
	},
	subCommands: {
		query: queryCommand,
		serve: serveCommand,
		init: initCommand,
		webhook: webhookCommand,
	},
	args: {
		prompt: {
			type: "positional",
			required: false,
			description: "Query to run (shorthand for `sandcaster query <prompt>`)",
		},
	},
	async run({ args, rawArgs }) {
		// If a positional prompt was given without a subcommand, treat as query
		const prompt = args.prompt as string | undefined;
		if (prompt) {
			const { executeQuery } = await import("./commands/query.js");
			const { loadConfig, runAgentInSandbox } = await import(
				"@sandcaster/core"
			);
			const { readFileSync } = await import("node:fs");
			await executeQuery(
				{ prompt, ...defaultQueryArgs },
				{
					runAgent: runAgentInSandbox,
					loadConfig,
					stdout: process.stdout,
					readFile: (path: string) => readFileSync(path, "utf-8"),
					exit: (code: number) => process.exit(code),
				},
			);
			return;
		}

		// No subcommand and no positional — print help
		if (rawArgs.length === 0) {
			// citty will print usage when no subcommand is matched
		}
	},
});

runMain(main);
