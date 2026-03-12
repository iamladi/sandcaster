/**
 * Runner script — executed inside the E2B sandbox.
 *
 * Uses Pi-mono Agent to run an AI agent with tools, subscribes to events,
 * and streams translated SandcasterEvents as JSON lines to stdout.
 */
import { readFileSync } from "node:fs";
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import { Agent } from "@mariozechner/pi-agent-core";

// Config is uploaded by the host to /opt/agent_config.json
const config = JSON.parse(readFileSync("/opt/agent_config.json", "utf-8"));

function emit(event: Record<string, unknown>): void {
	process.stdout.write(`${JSON.stringify(event)}\n`);
}

async function main(): Promise<void> {
	emit({ type: "system", subtype: "init", content: "Runner starting" });

	// TODO: Phase 2 — resolve model alias, create tools, set up agent
	// TODO: Phase 3 — load skills
	// TODO: Wire up event subscription via event-translator

	const agent = new Agent();

	// Placeholder: set model from config
	if (config.model) {
		// Model resolution will be handled by model-aliases.ts in Phase 2
	}

	if (config.system_prompt) {
		agent.setSystemPrompt(config.system_prompt);
	}

	agent.subscribe((event: AgentEvent) => {
		// TODO: Phase 2 — translate via event-translator
		emit({ type: "system", content: `event: ${event.type}` });
	});

	await agent.prompt(config.prompt);

	emit({ type: "result", subtype: "success", content: "Agent completed" });
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

main().catch((err) => {
	emit({
		type: "error",
		content: err instanceof Error ? err.message : String(err),
		code: "RUNNER_ERROR",
	});
	process.exit(1);
});
