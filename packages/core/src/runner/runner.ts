/**
 * Runner script — executed inside the E2B sandbox.
 *
 * Uses Pi-mono Agent to run an AI agent with tools, subscribes to events,
 * and streams translated SandcasterEvents as JSON lines to stdout.
 */
import { readFileSync } from "node:fs";
import { runAgent } from "./runner-main.js";

const config = JSON.parse(
	readFileSync("/opt/sandcaster/agent_config.json", "utf-8"),
);

function emit(event: Record<string, unknown>): void {
	process.stdout.write(`${JSON.stringify(event)}\n`);
}

// Handle signals gracefully
process.on("SIGTERM", () => {
	emit({ type: "error", content: "Received SIGTERM", code: "SIGTERM" });
	process.exit(0);
});
process.on("SIGINT", () => {
	emit({ type: "error", content: "Received SIGINT", code: "SIGINT" });
	process.exit(0);
});

runAgent(config, process.env as Record<string, string>, emit).catch((err) => {
	emit({
		type: "error",
		content: err instanceof Error ? err.message : String(err),
		code: "RUNNER_ERROR",
	});
	process.exit(1);
});
