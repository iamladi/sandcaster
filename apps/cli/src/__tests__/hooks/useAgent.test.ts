import type { SandcasterEvent } from "@sandcaster/core";
import { describe, expect, it } from "vitest";
import {
	type AgentState,
	initialAgentState,
	reduceAgentState,
} from "../../hooks/useAgent.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function applyEvents(events: SandcasterEvent[]): AgentState {
	let state = initialAgentState;
	for (const event of events) {
		state = reduceAgentState(state, event);
	}
	return state;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("reduceAgentState", () => {
	describe("initial state", () => {
		it("has idle status", () => {
			expect(initialAgentState.status).toBe("idle");
		});

		it("has empty events array", () => {
			expect(initialAgentState.events).toEqual([]);
		});

		it("has empty completedTurns", () => {
			expect(initialAgentState.completedTurns).toEqual([]);
		});

		it("has empty currentTurn", () => {
			expect(initialAgentState.currentTurn).toEqual([]);
		});

		it("has null result", () => {
			expect(initialAgentState.result).toBeNull();
		});

		it("has null error", () => {
			expect(initialAgentState.error).toBeNull();
		});
	});

	describe("status transitions", () => {
		it("transitions to running on first event", () => {
			const state = reduceAgentState(initialAgentState, {
				type: "system",
				content: "started",
			});
			expect(state.status).toBe("running");
		});

		it("stays running after assistant delta events", () => {
			const state = applyEvents([
				{ type: "assistant", subtype: "delta", content: "hello" },
				{ type: "assistant", subtype: "delta", content: " world" },
			]);
			expect(state.status).toBe("running");
		});

		it("transitions to completed on result event", () => {
			const state = applyEvents([
				{ type: "assistant", subtype: "delta", content: "hi" },
				{ type: "result", content: "done" },
			]);
			expect(state.status).toBe("completed");
		});

		it("transitions to error on error event", () => {
			const state = applyEvents([
				{ type: "error", content: "something went wrong" },
			]);
			expect(state.status).toBe("error");
		});
	});

	describe("event accumulation", () => {
		it("accumulates all events in order", () => {
			const events: SandcasterEvent[] = [
				{ type: "system", content: "start" },
				{ type: "assistant", subtype: "delta", content: "hello" },
				{ type: "result", content: "done" },
			];
			const state = applyEvents(events);
			expect(state.events).toEqual(events);
		});

		it("accumulates tool_use and tool_result events", () => {
			const events: SandcasterEvent[] = [
				{
					type: "tool_use",
					toolName: "bash",
					content: '{"cmd":"ls"}',
				},
				{
					type: "tool_result",
					toolName: "bash",
					content: "file.txt",
					isError: false,
				},
			];
			const state = applyEvents(events);
			expect(state.events).toEqual(events);
		});
	});

	describe("turn grouping", () => {
		it("accumulates events in currentTurn before completion", () => {
			const state = applyEvents([
				{ type: "assistant", subtype: "delta", content: "part 1" },
				{ type: "assistant", subtype: "delta", content: "part 2" },
			]);
			expect(state.currentTurn).toEqual([
				{ type: "assistant", subtype: "delta", content: "part 1" },
				{ type: "assistant", subtype: "delta", content: "part 2" },
			]);
			expect(state.completedTurns).toEqual([]);
		});

		it("moves currentTurn to completedTurns on assistant complete event", () => {
			const state = applyEvents([
				{ type: "assistant", subtype: "delta", content: "part 1" },
				{ type: "assistant", subtype: "complete", content: "part 1" },
			]);
			expect(state.completedTurns).toHaveLength(1);
			expect(state.completedTurns[0]).toEqual([
				{ type: "assistant", subtype: "delta", content: "part 1" },
				{ type: "assistant", subtype: "complete", content: "part 1" },
			]);
			expect(state.currentTurn).toEqual([]);
		});

		it("starts a fresh turn after assistant complete", () => {
			const state = applyEvents([
				{ type: "assistant", subtype: "delta", content: "turn 1" },
				{ type: "assistant", subtype: "complete", content: "turn 1" },
				{ type: "tool_use", toolName: "bash", content: "{}" },
			]);
			expect(state.completedTurns).toHaveLength(1);
			expect(state.currentTurn).toEqual([
				{ type: "tool_use", toolName: "bash", content: "{}" },
			]);
		});

		it("groups multiple turns correctly", () => {
			const state = applyEvents([
				{ type: "assistant", subtype: "delta", content: "a" },
				{ type: "assistant", subtype: "complete", content: "a" },
				{ type: "assistant", subtype: "delta", content: "b" },
				{ type: "assistant", subtype: "complete", content: "b" },
			]);
			expect(state.completedTurns).toHaveLength(2);
			expect(state.currentTurn).toEqual([]);
		});

		it("moves remaining currentTurn to completedTurns on result event", () => {
			const state = applyEvents([
				{ type: "assistant", subtype: "delta", content: "final" },
				{ type: "result", content: "done", costUsd: 0.01 },
			]);
			expect(state.completedTurns).toHaveLength(1);
			expect(state.completedTurns[0]).toEqual([
				{ type: "assistant", subtype: "delta", content: "final" },
				{ type: "result", content: "done", costUsd: 0.01 },
			]);
			expect(state.currentTurn).toEqual([]);
		});

		it("result event after a completed turn creates a second turn containing the result", () => {
			const state = applyEvents([
				{ type: "assistant", subtype: "delta", content: "turn 1" },
				{ type: "assistant", subtype: "complete", content: "turn 1" },
				{ type: "result", content: "done" },
			]);
			// Turn 1 from assistant complete, turn 2 containing just the result event
			expect(state.completedTurns).toHaveLength(2);
			expect(state.completedTurns[1]).toEqual([
				{ type: "result", content: "done" },
			]);
		});
	});

	describe("result info", () => {
		it("populates result on result event", () => {
			const state = applyEvents([
				{
					type: "result",
					content: "final answer",
					costUsd: 0.05,
					numTurns: 3,
					durationSecs: 12.5,
					model: "claude-sonnet-4-6",
				},
			]);
			expect(state.result).toEqual({
				content: "final answer",
				costUsd: 0.05,
				numTurns: 3,
				durationSecs: 12.5,
				model: "claude-sonnet-4-6",
			});
		});

		it("populates result with only content when optional fields are absent", () => {
			const state = applyEvents([{ type: "result", content: "done" }]);
			expect(state.result).toEqual({ content: "done" });
		});

		it("keeps result null until result event", () => {
			const state = applyEvents([{ type: "assistant", content: "thinking" }]);
			expect(state.result).toBeNull();
		});
	});

	describe("error info", () => {
		it("populates error message on error event", () => {
			const state = applyEvents([
				{ type: "error", content: "sandbox crashed", code: "E500" },
			]);
			expect(state.error).toBe("sandbox crashed");
		});

		it("keeps error null until error event", () => {
			const state = applyEvents([{ type: "system", content: "hello" }]);
			expect(state.error).toBeNull();
		});
	});
});
