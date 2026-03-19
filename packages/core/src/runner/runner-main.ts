/**
 * Core runner logic — extracted for testability.
 * The runner.ts script calls this with config loaded from disk.
 */
import { readFileSync, unlinkSync } from "node:fs";
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import { Agent } from "@mariozechner/pi-agent-core";
import { createCompositeTools } from "./composite-tools.js";
import { createEventTranslator } from "./event-translator.js";
import { IpcClient } from "./ipc-client.js";
import { resolveModelFromConfig } from "./model-aliases.js";
import { createBranchTools, createSandboxTools } from "./sandbox-tools.js";

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

	const tools = [...createSandboxTools()];

	// Branch tools (when branching is enabled from orchestrator)
	let branchShouldAbort: (() => boolean) | undefined;
	if (config.branching_enabled === true) {
		const branchResult = createBranchTools({ emit });
		tools.push(...branchResult.tools);
		branchShouldAbort = branchResult.shouldAbort;
	}

	if (
		config.composite_enabled === true &&
		typeof config.composite_nonce === "string"
	) {
		const _readFileSync = readFileSync;
		const _unlinkSync = unlinkSync;
		const ipcClient = new IpcClient(
			{
				emit: (line) => process.stdout.write(`${line}\n`),
				readFile: async (path) => {
					try {
						return _readFileSync(path, "utf-8");
					} catch {
						return null;
					}
				},
				deleteFile: async (path) => {
					try {
						_unlinkSync(path);
					} catch {
						// File may already be deleted by host
					}
				},
				sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
			},
			{
				nonce: config.composite_nonce,
				pollIntervalMs:
					typeof config.composite_poll_interval_ms === "number"
						? config.composite_poll_interval_ms
						: 200,
				pollTimeoutMs: 360000, // 6 min — exceeds max exec_in timeout (300s)
			},
		);
		tools.push(...createCompositeTools(ipcClient));
	}

	agent.setTools(tools);

	if (config.system_prompt) {
		agent.setSystemPrompt(config.system_prompt as string);
	}

	const maxTurns =
		typeof config.max_turns === "number" ? config.max_turns : undefined;
	let turnCount = 0;

	agent.subscribe((event: AgentEvent) => {
		if (event.type === "turn_end") {
			turnCount++;
			if (maxTurns !== undefined && turnCount >= maxTurns) {
				agent.abort();
			}
		}
		// Abort after tool execution when branch tool has been called
		if (event.type === "tool_execution_end" && branchShouldAbort?.() === true) {
			agent.abort();
		}
		for (const translated of translator.translate(event)) {
			emit(translated);
		}
	});

	// Enforce timeout from config
	const timeoutSecs =
		typeof config.timeout === "number" ? config.timeout : undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	if (timeoutSecs !== undefined) {
		timer = setTimeout(() => {
			agent.abort();
		}, timeoutSecs * 1000);
	}

	try {
		await agent.prompt(config.prompt as string);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}
