#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { defineCommand, runMain } from "citty";
import { initCommand } from "./commands/init.js";
import { queryCommand } from "./commands/query.js";
import { serveCommand } from "./commands/serve.js";
import { templatesCommand } from "./commands/templates.js";
import { webhookCommand } from "./commands/webhook.js";

// Load .env with override — the project .env is the source of truth for API keys.
// Bun's built-in .env loading does NOT override existing env vars, which causes
// stale shell vars to shadow the .env values.
if (existsSync(".env")) {
	for (const line of readFileSync(".env", "utf-8").split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eqIdx = trimmed.indexOf("=");
		if (eqIdx === -1) continue;
		const key = trimmed.slice(0, eqIdx).trim();
		const value = trimmed.slice(eqIdx + 1).trim();
		process.env[key] = value;
	}
}

const knownSubcommands = new Set([
	"query",
	"serve",
	"init",
	"webhook",
	"templates",
]);

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
		templates: templatesCommand,
	},
});

// If first positional arg isn't a known subcommand, treat as query shorthand
const firstArg = process.argv[2];
if (firstArg && !knownSubcommands.has(firstArg) && !firstArg.startsWith("-")) {
	process.argv.splice(2, 0, "query");
}

runMain(main);
