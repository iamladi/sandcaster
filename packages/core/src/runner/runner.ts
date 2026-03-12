/**
 * Runner script — executed inside the E2B sandbox.
 *
 * Uses Pi-mono Agent to run an AI agent with tools, subscribes to events,
 * and streams translated SandcasterEvents as JSON lines to stdout.
 */
import { readFileSync } from "node:fs";
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import { Agent } from "@mariozechner/pi-agent-core";
import { createEventTranslator } from "./event-translator.js";
import { resolveModelFromConfig } from "./model-aliases.js";

// Config is uploaded by the host to /opt/sandcaster/agent_config.json
const config = JSON.parse(
	readFileSync("/opt/sandcaster/agent_config.json", "utf-8"),
);

function emit(event: Record<string, unknown>): void {
	process.stdout.write(`${JSON.stringify(event)}\n`);
}

async function main(): Promise<void> {
	emit({ type: "system", subtype: "init", content: "Runner starting" });

	// TODO: Phase 3 — load skills

	const model = resolveModelFromConfig(config, process.env);
	const translator = createEventTranslator();
	const agent = new Agent();
	agent.setModel(model);

	if (config.system_prompt) {
		agent.setSystemPrompt(config.system_prompt);
	}

	agent.subscribe((event: AgentEvent) => {
		for (const translated of translator.translate(event)) {
			emit(translated);
		}
	});

	await agent.prompt(config.prompt);
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
