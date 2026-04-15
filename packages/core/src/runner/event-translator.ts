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
	| { type: "error"; content: string; code?: string; hint?: string }
	// Branch event types
	| {
			type: "branch_request";
			alternatives: string[];
			reason?: string;
	  }
	| { type: "confidence_report"; level: number; reason: string }
	| {
			type: "branch_start";
			branchId: string;
			branchIndex: number;
			totalBranches: number;
			prompt: string;
	  }
	| {
			type: "branch_progress";
			branchId: string;
			branchIndex: number;
			status: "running" | "completed" | "error";
			numTurns?: number;
			costUsd?: number;
	  }
	| {
			type: "branch_complete";
			branchId: string;
			status: "success" | "error";
			costUsd?: number;
			numTurns?: number;
			content?: string;
	  }
	| {
			type: "branch_selected";
			branchId: string;
			branchIndex: number;
			reason: string;
			scores?: Record<string, number>;
	  }
	| {
			type: "branch_summary";
			totalBranches: number;
			successCount: number;
			totalCostUsd: number;
			evaluator: string;
			winnerId?: string;
	  };

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

				// Sum cost across all assistant messages
				let totalCost = 0;
				let hasCost = false;
				for (const msg of assistantMessages) {
					if (msg.usage?.cost?.total !== undefined) {
						totalCost += msg.usage.cost.total;
						hasCost = true;
					}
				}
				const costUsd = hasCost ? totalCost : undefined;
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
