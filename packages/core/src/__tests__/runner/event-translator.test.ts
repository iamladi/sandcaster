import type { AgentEvent } from "@mariozechner/pi-agent-core";
import type {
	AssistantMessage,
	AssistantMessageEvent,
} from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import { createEventTranslator } from "../../runner/event-translator.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAssistantMessage(
	overrides: Partial<AssistantMessage> = {},
): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-6",
		usage: {
			input: 100,
			output: 50,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 150,
			cost: {
				input: 0.001,
				output: 0.002,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0.003,
			},
		},
		stopReason: "stop",
		timestamp: Date.now(),
		...overrides,
	};
}

function makeMessageUpdateEvent(
	assistantMessageEvent: AssistantMessageEvent,
): AgentEvent {
	return {
		type: "message_update",
		message: makeAssistantMessage(),
		assistantMessageEvent,
	};
}

function makeTextDeltaEvent(contentIndex: number, delta: string): AgentEvent {
	const partial = makeAssistantMessage();
	return makeMessageUpdateEvent({
		type: "text_delta",
		contentIndex,
		delta,
		partial,
	});
}

function makeTextEndEvent(contentIndex: number, content: string): AgentEvent {
	const partial = makeAssistantMessage();
	return makeMessageUpdateEvent({
		type: "text_end",
		contentIndex,
		content,
		partial,
	});
}

function makeThinkingDeltaEvent(
	contentIndex: number,
	delta: string,
): AgentEvent {
	const partial = makeAssistantMessage();
	return makeMessageUpdateEvent({
		type: "thinking_delta",
		contentIndex,
		delta,
		partial,
	});
}

function makeThinkingEndEvent(
	contentIndex: number,
	content: string,
): AgentEvent {
	const partial = makeAssistantMessage();
	return makeMessageUpdateEvent({
		type: "thinking_end",
		contentIndex,
		content,
		partial,
	});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createEventTranslator", () => {
	describe("agent_start", () => {
		it("emits a system init event", () => {
			const translator = createEventTranslator();
			const events = translator.translate({ type: "agent_start" });

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({
				type: "system",
				subtype: "init",
				content: "Agent started",
			});
		});
	});

	describe("agent_end", () => {
		it("emits a result success event with content", () => {
			const translator = createEventTranslator();
			const events = translator.translate({
				type: "agent_end",
				messages: [],
			});

			expect(events).toHaveLength(1);
			expect(events[0].type).toBe("result");
			expect((events[0] as { type: "result"; subtype: string }).subtype).toBe(
				"success",
			);
			expect((events[0] as { content: string }).content).toBe(
				"Agent completed",
			);
		});

		it("emits result with usage info from last assistant message", () => {
			const translator = createEventTranslator();
			const lastAssistant = makeAssistantMessage({
				model: "claude-opus-4-5",
				usage: {
					input: 200,
					output: 100,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 300,
					cost: {
						input: 0.01,
						output: 0.02,
						cacheRead: 0,
						cacheWrite: 0,
						total: 0.05,
					},
				},
			});
			const messages = [
				{
					role: "user" as const,
					content: "Hello",
					timestamp: Date.now(),
				},
				lastAssistant,
			];
			const events = translator.translate({
				type: "agent_end",
				messages,
			});

			expect(events).toHaveLength(1);
			const resultEvent = events[0] as {
				type: string;
				costUsd: number;
				model: string;
				numTurns: number;
			};
			expect(resultEvent.costUsd).toBe(0.05);
			expect(resultEvent.model).toBe("claude-opus-4-5");
			expect(resultEvent.numTurns).toBe(1);
		});

		it("counts all assistant messages for numTurns", () => {
			const translator = createEventTranslator();
			const messages = [
				makeAssistantMessage(),
				makeAssistantMessage(),
				makeAssistantMessage(),
			];
			const events = translator.translate({
				type: "agent_end",
				messages,
			});

			expect(events).toHaveLength(1);
			expect((events[0] as { numTurns: number }).numTurns).toBe(3);
		});

		it("emits result without usage info when messages is empty", () => {
			const translator = createEventTranslator();
			const events = translator.translate({
				type: "agent_end",
				messages: [],
			});

			expect(events).toHaveLength(1);
			const result = events[0] as {
				costUsd?: number;
				model?: string;
				numTurns?: number;
			};
			expect(result.costUsd).toBeUndefined();
			expect(result.model).toBeUndefined();
			expect(result.numTurns).toBeUndefined();
		});
	});

	describe("message_update with text_delta", () => {
		it("emits an assistant delta event", () => {
			const translator = createEventTranslator();
			const events = translator.translate(makeTextDeltaEvent(0, "Hello"));

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({
				type: "assistant",
				subtype: "delta",
				content: "Hello",
			});
		});

		it("emits consecutive deltas for the same contentIndex", () => {
			const translator = createEventTranslator();
			translator.translate(makeTextDeltaEvent(0, "Hello"));
			const events = translator.translate(makeTextDeltaEvent(0, " world"));

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({
				type: "assistant",
				subtype: "delta",
				content: " world",
			});
		});
	});

	describe("message_update with text_end", () => {
		it("emits an assistant complete event with full accumulated text", () => {
			const translator = createEventTranslator();
			translator.translate(makeTextDeltaEvent(0, "Hello"));
			translator.translate(makeTextDeltaEvent(0, " world"));
			const events = translator.translate(makeTextEndEvent(0, "Hello world"));

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({
				type: "assistant",
				subtype: "complete",
				content: "Hello world",
			});
		});

		it("uses the content field from text_end directly", () => {
			const translator = createEventTranslator();
			// No prior deltas — text_end content is authoritative
			const events = translator.translate(makeTextEndEvent(0, "Full text"));

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({
				type: "assistant",
				subtype: "complete",
				content: "Full text",
			});
		});
	});

	describe("message_update with thinking_delta", () => {
		it("emits a thinking delta event", () => {
			const translator = createEventTranslator();
			const events = translator.translate(
				makeThinkingDeltaEvent(0, "Reasoning..."),
			);

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({
				type: "thinking",
				subtype: "delta",
				content: "Reasoning...",
			});
		});
	});

	describe("message_update with thinking_end", () => {
		it("emits a thinking complete event", () => {
			const translator = createEventTranslator();
			const events = translator.translate(
				makeThinkingEndEvent(0, "Full reasoning"),
			);

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({
				type: "thinking",
				subtype: "complete",
				content: "Full reasoning",
			});
		});
	});

	describe("tool_execution_start", () => {
		it("emits a tool_use event with stringified args", () => {
			const translator = createEventTranslator();
			const events = translator.translate({
				type: "tool_execution_start",
				toolCallId: "call-1",
				toolName: "bash",
				args: { command: "ls -la" },
			});

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({
				type: "tool_use",
				toolName: "bash",
				content: JSON.stringify({ command: "ls -la" }),
			});
		});

		it("emits tool_use with null args stringified", () => {
			const translator = createEventTranslator();
			const events = translator.translate({
				type: "tool_execution_start",
				toolCallId: "call-2",
				toolName: "noop",
				args: null,
			});

			expect(events).toHaveLength(1);
			expect((events[0] as { content: string }).content).toBe("null");
		});
	});

	describe("tool_execution_end", () => {
		it("emits a tool_result event with stringified result and isError=false", () => {
			const translator = createEventTranslator();
			const events = translator.translate({
				type: "tool_execution_end",
				toolCallId: "call-1",
				toolName: "bash",
				result: { output: "file.txt\n" },
				isError: false,
			});

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({
				type: "tool_result",
				toolName: "bash",
				content: JSON.stringify({ output: "file.txt\n" }),
				isError: false,
			});
		});

		it("emits a tool_result event with isError=true when tool failed", () => {
			const translator = createEventTranslator();
			const events = translator.translate({
				type: "tool_execution_end",
				toolCallId: "call-1",
				toolName: "bash",
				result: "command not found",
				isError: true,
			});

			expect(events).toHaveLength(1);
			expect((events[0] as { isError: boolean }).isError).toBe(true);
		});
	});

	describe("message_update with done (error reason)", () => {
		it("emits an error event when done reason is error", () => {
			const errorMessage = makeAssistantMessage({
				stopReason: "error",
				errorMessage: "Something went wrong",
			});
			const translator = createEventTranslator();
			const events = translator.translate(
				makeMessageUpdateEvent({
					type: "error",
					reason: "error",
					error: errorMessage,
				}),
			);

			expect(events).toHaveLength(1);
			expect(events[0].type).toBe("error");
		});

		it("emits an error event when done reason is aborted", () => {
			const errorMessage = makeAssistantMessage({ stopReason: "error" });
			const translator = createEventTranslator();
			const events = translator.translate(
				makeMessageUpdateEvent({
					type: "error",
					reason: "aborted",
					error: errorMessage,
				}),
			);

			expect(events).toHaveLength(1);
			expect(events[0].type).toBe("error");
		});
	});

	describe("ignored events", () => {
		it("returns empty array for turn_start", () => {
			const translator = createEventTranslator();
			expect(translator.translate({ type: "turn_start" })).toEqual([]);
		});

		it("returns empty array for turn_end", () => {
			const translator = createEventTranslator();
			expect(
				translator.translate({
					type: "turn_end",
					message: makeAssistantMessage(),
					toolResults: [],
				}),
			).toEqual([]);
		});

		it("returns empty array for message_start", () => {
			const translator = createEventTranslator();
			expect(
				translator.translate({
					type: "message_start",
					message: makeAssistantMessage(),
				}),
			).toEqual([]);
		});

		it("returns empty array for message_end", () => {
			const translator = createEventTranslator();
			expect(
				translator.translate({
					type: "message_end",
					message: makeAssistantMessage(),
				}),
			).toEqual([]);
		});

		it("returns empty array for tool_execution_update", () => {
			const translator = createEventTranslator();
			expect(
				translator.translate({
					type: "tool_execution_update",
					toolCallId: "call-1",
					toolName: "bash",
					args: {},
					partialResult: "running...",
				}),
			).toEqual([]);
		});

		it("returns empty array for message_update with text_start", () => {
			const translator = createEventTranslator();
			expect(
				translator.translate(
					makeMessageUpdateEvent({
						type: "text_start",
						contentIndex: 0,
						partial: makeAssistantMessage(),
					}),
				),
			).toEqual([]);
		});

		it("returns empty array for message_update with thinking_start", () => {
			const translator = createEventTranslator();
			expect(
				translator.translate(
					makeMessageUpdateEvent({
						type: "thinking_start",
						contentIndex: 0,
						partial: makeAssistantMessage(),
					}),
				),
			).toEqual([]);
		});

		it("returns empty array for message_update with toolcall_start", () => {
			const translator = createEventTranslator();
			expect(
				translator.translate(
					makeMessageUpdateEvent({
						type: "toolcall_start",
						contentIndex: 0,
						partial: makeAssistantMessage(),
					}),
				),
			).toEqual([]);
		});

		it("returns empty array for message_update with toolcall_delta", () => {
			const translator = createEventTranslator();
			expect(
				translator.translate(
					makeMessageUpdateEvent({
						type: "toolcall_delta",
						contentIndex: 0,
						delta: "partial args",
						partial: makeAssistantMessage(),
					}),
				),
			).toEqual([]);
		});

		it("returns empty array for message_update with start", () => {
			const translator = createEventTranslator();
			expect(
				translator.translate(
					makeMessageUpdateEvent({
						type: "start",
						partial: makeAssistantMessage(),
					}),
				),
			).toEqual([]);
		});

		it("returns empty array for message_update with done (stop reason)", () => {
			const translator = createEventTranslator();
			expect(
				translator.translate(
					makeMessageUpdateEvent({
						type: "done",
						reason: "stop",
						message: makeAssistantMessage(),
					}),
				),
			).toEqual([]);
		});
	});

	describe("multiple contentIndex values", () => {
		it("tracks text accumulation independently per contentIndex", () => {
			const translator = createEventTranslator();

			// contentIndex 0 gets some text
			translator.translate(makeTextDeltaEvent(0, "Hello"));
			// contentIndex 1 gets different text
			translator.translate(makeTextDeltaEvent(1, "World"));

			// text_end for index 0 — should use its own accumulation
			const events0 = translator.translate(makeTextEndEvent(0, "Hello"));
			expect(events0[0]).toEqual({
				type: "assistant",
				subtype: "complete",
				content: "Hello",
			});

			// text_end for index 1 — should use its own accumulation
			const events1 = translator.translate(makeTextEndEvent(1, "World"));
			expect(events1[0]).toEqual({
				type: "assistant",
				subtype: "complete",
				content: "World",
			});
		});

		it("tracks thinking accumulation independently per contentIndex", () => {
			const translator = createEventTranslator();

			translator.translate(makeThinkingDeltaEvent(0, "Step 1"));
			translator.translate(makeThinkingDeltaEvent(2, "Step A"));

			const events0 = translator.translate(makeThinkingEndEvent(0, "Step 1"));
			expect((events0[0] as { content: string }).content).toBe("Step 1");

			const events2 = translator.translate(makeThinkingEndEvent(2, "Step A"));
			expect((events2[0] as { content: string }).content).toBe("Step A");
		});
	});

	describe("translator is stateful across calls", () => {
		it("each translator instance has independent state", () => {
			const t1 = createEventTranslator();
			const t2 = createEventTranslator();

			t1.translate(makeTextDeltaEvent(0, "from t1"));
			t2.translate(makeTextDeltaEvent(0, "from t2"));

			const e1 = t1.translate(makeTextEndEvent(0, "from t1"));
			const e2 = t2.translate(makeTextEndEvent(0, "from t2"));

			expect((e1[0] as { content: string }).content).toBe("from t1");
			expect((e2[0] as { content: string }).content).toBe("from t2");
		});
	});
});
