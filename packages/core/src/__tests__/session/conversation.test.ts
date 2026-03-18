import { describe, expect, it, vi } from "vitest";
import {
	addTurn,
	buildAgentContext,
	clearHistory,
	compactHistory,
} from "../../session/conversation.js";
import type { ConversationTurn } from "../../session/types.js";

// ---------------------------------------------------------------------------
// addTurn
// ---------------------------------------------------------------------------

describe("addTurn", () => {
	it("appends a turn to history", () => {
		const history: ConversationTurn[] = [];
		addTurn(history, { role: "user", content: "hello" });
		expect(history).toHaveLength(1);
		expect(history[0]).toEqual({ role: "user", content: "hello" });
	});

	it("returns the mutated history array", () => {
		const history: ConversationTurn[] = [];
		const result = addTurn(history, { role: "assistant", content: "hi" });
		expect(result).toBe(history);
	});

	it("trims oldest turns when exceeding maxTurns", () => {
		const history: ConversationTurn[] = [
			{ role: "user", content: "turn 1" },
			{ role: "assistant", content: "turn 2" },
		];
		addTurn(history, { role: "user", content: "turn 3" }, 2);
		expect(history).toHaveLength(2);
		expect(history[0].content).toBe("turn 2");
		expect(history[1].content).toBe("turn 3");
	});

	it("removes tool_use/tool_result pair together when oldest is a tool call", () => {
		const history: ConversationTurn[] = [
			{ role: "assistant", content: "tool_use: run_shell", isToolCall: true },
			{ role: "user", content: "tool_result: ok", isToolCall: true },
			{ role: "assistant", content: "done" },
		];
		addTurn(history, { role: "user", content: "next" }, 3);
		// Oldest is a tool call pair — both must be removed together
		expect(history).toHaveLength(2);
		expect(history[0].content).toBe("done");
		expect(history[1].content).toBe("next");
	});

	it("does not split a tool call pair when trimming", () => {
		const history: ConversationTurn[] = [
			{ role: "user", content: "regular" },
			{ role: "assistant", content: "tool_use: fetch", isToolCall: true },
			{ role: "user", content: "tool_result: data", isToolCall: true },
		];
		// maxTurns=3, adding one more should trim. Oldest is regular, remove only it.
		addTurn(history, { role: "assistant", content: "response" }, 3);
		expect(history).toHaveLength(3);
		expect(history[0].content).toBe("tool_use: fetch");
		expect(history[1].content).toBe("tool_result: data");
		expect(history[2].content).toBe("response");
	});
});

// ---------------------------------------------------------------------------
// compactHistory
// ---------------------------------------------------------------------------

describe("compactHistory", () => {
	it("replaces history with a single summary turn on success", async () => {
		const history: ConversationTurn[] = [
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "hi there" },
		];
		const summarizer = vi.fn().mockResolvedValue("summary of conversation");

		const result = await compactHistory(history, summarizer);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.history).toHaveLength(1);
			expect(result.history[0]).toEqual({
				role: "assistant",
				content: "summary of conversation",
			});
		}
	});

	it("leaves history unchanged when summarizer throws", async () => {
		const original: ConversationTurn[] = [
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "hi" },
		];
		const history = [...original];
		const summarizer = vi.fn().mockRejectedValue(new Error("LLM unavailable"));

		const result = await compactHistory(history, summarizer);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("LLM unavailable");
		}
		expect(history).toHaveLength(2);
		expect(history[0].content).toBe("hello");
	});

	it("passes model argument to the summarizer", async () => {
		const history: ConversationTurn[] = [{ role: "user", content: "question" }];
		const summarizer = vi.fn().mockResolvedValue("summary");

		await compactHistory(history, summarizer, "claude-opus-4-5");

		expect(summarizer).toHaveBeenCalledWith(history, "claude-opus-4-5");
	});
});

// ---------------------------------------------------------------------------
// clearHistory
// ---------------------------------------------------------------------------

describe("clearHistory", () => {
	it("returns an empty array", () => {
		expect(clearHistory()).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// buildAgentContext
// ---------------------------------------------------------------------------

describe("buildAgentContext", () => {
	it("formats history as a conversation string", () => {
		const history: ConversationTurn[] = [
			{ role: "user", content: "What is 2+2?" },
			{ role: "assistant", content: "4" },
		];
		const result = buildAgentContext(history);
		expect(result).toBe(
			"[Previous conversation]\nUser: What is 2+2?\nAssistant: 4",
		);
	});

	it("includes summary section when conversationSummary is provided", () => {
		const history: ConversationTurn[] = [
			{ role: "user", content: "follow-up" },
		];
		const result = buildAgentContext(history, "Earlier we discussed X.");
		expect(result).toBe(
			"[Conversation summary]\nEarlier we discussed X.\n\n[Recent conversation]\nUser: follow-up",
		);
	});

	it("returns empty string for empty history and no summary", () => {
		expect(buildAgentContext([])).toBe("");
	});

	it("handles mixed tool call and regular turns", () => {
		const history: ConversationTurn[] = [
			{ role: "user", content: "run a command" },
			{ role: "assistant", content: "tool_use: run_shell", isToolCall: true },
			{ role: "user", content: "tool_result: done", isToolCall: true },
			{ role: "assistant", content: "finished" },
		];
		const result = buildAgentContext(history);
		expect(result).toBe(
			"[Previous conversation]\nUser: run a command\nAssistant: tool_use: run_shell\nUser: tool_result: done\nAssistant: finished",
		);
	});
});
