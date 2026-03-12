/**
 * Core runner logic — extracted for testability.
 * The runner.ts script calls this with config loaded from disk.
 */
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import { Agent } from "@mariozechner/pi-agent-core";
import { createEventTranslator } from "./event-translator.js";
import { resolveModelFromConfig } from "./model-aliases.js";
import { createSandboxTools } from "./sandbox-tools.js";

export async function runAgent(
	config: Record<string, unknown>,
	env: Record<string, string | undefined>,
	emit: (event: Record<string, unknown>) => void,
): Promise<void> {
	emit({ type: "system", subtype: "init", content: "Runner starting" });

	const model = resolveModelFromConfig(config, env);
	const translator = createEventTranslator();
	const agent = new Agent();
	agent.setModel(model);
	agent.setTools(createSandboxTools());

	if (config.system_prompt) {
		agent.setSystemPrompt(config.system_prompt as string);
	}

	agent.subscribe((event: AgentEvent) => {
		for (const translated of translator.translate(event)) {
			emit(translated);
		}
	});

	await agent.prompt(config.prompt as string);
}
