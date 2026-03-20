import { existsSync, readFileSync } from "node:fs";
import { defineCommand, runMain } from "citty";
import { chatCommand } from "./commands/chat.js";
import { initCommand } from "./commands/init.js";
import { queryCommand } from "./commands/query.js";
import { serveCommand } from "./commands/serve.js";
import { sessionCommand } from "./commands/session.js";
import { templatesCommand } from "./commands/templates.js";
import { parseEnvFile } from "./parse-env.js";

// Load .env with override — the project .env is the source of truth for API keys.
// Bun's built-in .env loading does NOT override existing env vars, which causes
// stale shell vars to shadow the .env values.
if (existsSync(".env")) {
	const entries = parseEnvFile(readFileSync(".env", "utf-8"));
	for (const [key, value] of Object.entries(entries)) {
		process.env[key] = value;
	}
}

const knownSubcommands = new Set([
	"query",
	"serve",
	"init",
	"templates",
	"session",
	"chat",
]);

const main = defineCommand({
	meta: {
		name: "sandcaster",
		description: "Run AI agents in isolated sandboxes",
	},
	subCommands: {
		query: queryCommand,
		serve: serveCommand,
		init: initCommand,
		templates: templatesCommand,
		session: sessionCommand,
		chat: chatCommand,
	},
});

// If first arg is -T/--template, treat as query shorthand (inject "query" before it).
// Otherwise, if it's not a known subcommand and doesn't start with -, treat as query prompt.
const firstArg = process.argv[2];
if (firstArg === "-T" || firstArg === "--template") {
	process.argv.splice(2, 0, "query");
} else if (
	firstArg &&
	!knownSubcommands.has(firstArg) &&
	!firstArg.startsWith("-")
) {
	process.argv.splice(2, 0, "query");
}

runMain(main);
