import type { AgentEvent, AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage } from "@mariozechner/pi-ai";

// ---------------------------------------------------------------------------
// SandcasterEvent types
// ---------------------------------------------------------------------------

export type SandcasterEvent =
	| { type: "system"; subtype: string; content: string }
	| { type: "assistant"; subtype: "delta" | "complete"; content: string }
	| { type: "thinking"; subtype: "delta" | "complete"; content: string }
	| { type: "tool_use"; toolName: string; content: string }
	| {
			type: "tool_result";
			toolName: string;
			content: string;
			isError: boolean;
	  }
	| {
			type: "result";
			subtype: "success";
			content: string;
			costUsd?: number;
			numTurns?: number;
			model?: string;
	  }
	| { type: "error"; content: string; code?: string; hint?: string };

// ---------------------------------------------------------------------------
// createEventTranslator
// ---------------------------------------------------------------------------

export function createEventTranslator(): {
	translate: (event: AgentEvent) => SandcasterEvent[];
} {
	// Accumulated text per contentIndex, keyed by contentIndex number
	const textAccumulator = new Map<number, string>();
	const thinkingAccumulator = new Map<number, string>();

	function translate(event: AgentEvent): SandcasterEvent[] {
		switch (event.type) {
			case "agent_start": {
				return [{ type: "system", subtype: "init", content: "Agent started" }];
			}

			case "agent_end": {
				const assistantMessages = event.messages.filter(
					(m): m is AssistantMessage =>
						(m as AgentMessage & { role?: string }).role === "assistant",
				);

				if (assistantMessages.length === 0) {
					return [
						{
							type: "result",
							subtype: "success",
							content: "Agent completed",
						},
					];
				}

				const last = assistantMessages[assistantMessages.length - 1];

				if (last.stopReason === "error") {
					// Error already emitted by the message_end handler — skip
					// to avoid duplicate error events
					return [];
				}

				const costUsd = last.usage?.cost?.total;
				const model = last.model;
				const numTurns = assistantMessages.length;

				return [
					{
						type: "result",
						subtype: "success",
						content: "Agent completed",
						costUsd,
						model,
						numTurns,
					},
				];
			}

			case "message_update": {
				const assistantEvent = event.assistantMessageEvent;

				switch (assistantEvent.type) {
					case "text_delta": {
						const { contentIndex, delta } = assistantEvent;
						const current = textAccumulator.get(contentIndex) ?? "";
						textAccumulator.set(contentIndex, current + delta);
						return [{ type: "assistant", subtype: "delta", content: delta }];
					}

					case "text_end": {
						const { contentIndex, content } = assistantEvent;
						textAccumulator.delete(contentIndex);
						return [{ type: "assistant", subtype: "complete", content }];
					}

					case "thinking_delta": {
						const { contentIndex, delta } = assistantEvent;
						const current = thinkingAccumulator.get(contentIndex) ?? "";
						thinkingAccumulator.set(contentIndex, current + delta);
						return [{ type: "thinking", subtype: "delta", content: delta }];
					}

					case "thinking_end": {
						const { contentIndex, content } = assistantEvent;
						thinkingAccumulator.delete(contentIndex);
						return [{ type: "thinking", subtype: "complete", content }];
					}

					case "error": {
						const errorMsg = assistantEvent.error;
						const content =
							errorMsg.errorMessage ?? `Agent error: ${assistantEvent.reason}`;
						return [{ type: "error", content }];
					}

					// Ignored: start, text_start, thinking_start, toolcall_start,
					// toolcall_delta, toolcall_end, done
					default: {
						return [];
					}
				}
			}

			case "tool_execution_start": {
				return [
					{
						type: "tool_use",
						toolName: event.toolName,
						content: JSON.stringify(event.args),
					},
				];
			}

			case "tool_execution_end": {
				return [
					{
						type: "tool_result",
						toolName: event.toolName,
						content: JSON.stringify(event.result),
						isError: event.isError,
					},
				];
			}

			case "message_end": {
				// Surface LLM errors (e.g. auth failures) that arrive as
				// stopReason: "error" on message_end without a message_update
				const msg = event.message as AssistantMessage;
				if (msg.stopReason === "error") {
					const content =
						(msg as AssistantMessage & { errorMessage?: string })
							.errorMessage ?? "LLM request failed";
					return [{ type: "error", content }];
				}
				return [];
			}

			// Ignored: turn_start, turn_end, message_start,
			// tool_execution_update
			default: {
				return [];
			}
		}
	}

	return { translate };
}
