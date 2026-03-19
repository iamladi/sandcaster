import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock @mariozechner/pi-agent-core at the boundary
// ---------------------------------------------------------------------------

let capturedSubscribeCallback: ((e: unknown) => void) | null = null;
const mockSetModel = vi.fn();
const mockSetSystemPrompt = vi.fn();
const mockSubscribe = vi.fn().mockImplementation((fn: (e: unknown) => void) => {
	capturedSubscribeCallback = fn;
	return () => {};
});
const mockPrompt = vi.fn().mockResolvedValue(undefined);

vi.mock("@mariozechner/pi-agent-core", () => {
	return {
		Agent: class MockAgent {
			setModel = mockSetModel;
			setSystemPrompt = mockSetSystemPrompt;
			subscribe = mockSubscribe;
			prompt = mockPrompt;
		},
	};
});

vi.mock("../../runner/model-aliases.js", () => ({
	resolveModel: (alias: string) => alias,
	autoDetectModel: () => "auto-detected-model",
}));

import {
	CustomEvaluator,
	createEvaluator,
	LlmJudgeEvaluator,
	SchemaEvaluator,
} from "../evaluator.js";
import type { BranchResult } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBranchResult(
	overrides: Partial<BranchResult> & { branchId: string; branchIndex: number },
): BranchResult {
	return {
		events: [],
		finalContent: "result content",
		status: "success",
		...overrides,
	};
}

/** Emit a fake agent_end event through the captured subscribe callback */
function emitAgentEnd(text: string) {
	capturedSubscribeCallback?.({
		type: "agent_end",
		messages: [
			{
				role: "assistant",
				content: [{ type: "text", text }],
			},
		],
	});
}

/** Configure mockPrompt to emit agent_end after resolving */
function setAgentResponse(text: string) {
	mockPrompt.mockImplementationOnce(async () => {
		emitAgentEnd(text);
	});
}

// ---------------------------------------------------------------------------
// 1. createEvaluator factory — returns correct evaluator type
// ---------------------------------------------------------------------------

describe("createEvaluator factory", () => {
	it("returns LlmJudgeEvaluator for type llm-judge", () => {
		const evaluator = createEvaluator({ type: "llm-judge" });
		expect(evaluator).toBeInstanceOf(LlmJudgeEvaluator);
	});

	it("returns SchemaEvaluator for type schema", () => {
		const evaluator = createEvaluator(
			{ type: "schema" },
			{
				type: "object",
				properties: { name: { type: "string" } },
				required: ["name"],
			},
		);
		expect(evaluator).toBeInstanceOf(SchemaEvaluator);
	});

	it("returns CustomEvaluator for type custom", () => {
		const evaluator = createEvaluator({
			type: "custom",
			prompt: "Pick the best result",
		});
		expect(evaluator).toBeInstanceOf(CustomEvaluator);
	});
});

// ---------------------------------------------------------------------------
// 2. createEvaluator errors
// ---------------------------------------------------------------------------

describe("createEvaluator errors", () => {
	it("throws when type is schema but no outputSchema is provided", () => {
		expect(() => createEvaluator({ type: "schema" })).toThrow(
			"SchemaEvaluator requires outputSchema",
		);
	});

	it("throws when type is custom but no prompt is provided", () => {
		expect(() => createEvaluator({ type: "custom" })).toThrow(
			"CustomEvaluator requires a prompt",
		);
	});
});

// ---------------------------------------------------------------------------
// 3. LlmJudgeEvaluator — returns valid evaluation
// ---------------------------------------------------------------------------

describe("LlmJudgeEvaluator", () => {
	beforeEach(() => {
		capturedSubscribeCallback = null;
		mockSetModel.mockClear();
		mockSetSystemPrompt.mockClear();
		mockSubscribe.mockClear();
		mockPrompt.mockClear();
	});

	it("returns a valid EvaluationResult when agent returns valid JSON", async () => {
		const evaluator = new LlmJudgeEvaluator();
		const results: BranchResult[] = [
			makeBranchResult({ branchId: "branch-0", branchIndex: 0 }),
			makeBranchResult({ branchId: "branch-1", branchIndex: 1 }),
		];

		const expectedEvalJson = JSON.stringify({
			winnerId: "branch-1",
			winnerIndex: 1,
			reasoning: "Branch 1 was more thorough",
			scores: { "branch-0": 0.6, "branch-1": 0.9 },
		});

		setAgentResponse(expectedEvalJson);

		const result = await evaluator.evaluate("Do something", results);

		expect(result.winnerId).toBe("branch-1");
		expect(result.winnerIndex).toBe(1);
		expect(result.reasoning).toBe("Branch 1 was more thorough");
		expect(result.scores?.["branch-1"]).toBe(0.9);
	});

	it("uses model override when provided", async () => {
		const evaluator = new LlmJudgeEvaluator("custom-model");
		const results: BranchResult[] = [
			makeBranchResult({ branchId: "branch-0", branchIndex: 0 }),
		];

		setAgentResponse(
			JSON.stringify({
				winnerId: "branch-0",
				winnerIndex: 0,
				reasoning: "Only option",
			}),
		);

		await evaluator.evaluate("Do something", results);

		expect(mockSetModel).toHaveBeenCalledWith("custom-model");
	});

	it("sets a system prompt on the agent", async () => {
		const evaluator = new LlmJudgeEvaluator();
		const results: BranchResult[] = [
			makeBranchResult({ branchId: "branch-0", branchIndex: 0 }),
		];

		setAgentResponse(
			JSON.stringify({
				winnerId: "branch-0",
				winnerIndex: 0,
				reasoning: "Only option",
			}),
		);

		await evaluator.evaluate("Original task", results);

		expect(mockSetSystemPrompt).toHaveBeenCalledOnce();
		const systemPromptArg: string = mockSetSystemPrompt.mock.calls[0][0];
		expect(typeof systemPromptArg).toBe("string");
		expect(systemPromptArg.length).toBeGreaterThan(0);
	});

	it("falls back to first result when agent returns malformed JSON", async () => {
		const evaluator = new LlmJudgeEvaluator();
		const results: BranchResult[] = [
			makeBranchResult({ branchId: "branch-0", branchIndex: 0 }),
			makeBranchResult({ branchId: "branch-1", branchIndex: 1 }),
		];

		setAgentResponse("This is not JSON at all");

		const result = await evaluator.evaluate("Do something", results);

		expect(result.winnerId).toBe("branch-0");
		expect(result.winnerIndex).toBe(0);
		expect(typeof result.reasoning).toBe("string");
	});
});

// ---------------------------------------------------------------------------
// 5. SchemaEvaluator — picks valid result
// ---------------------------------------------------------------------------

describe("SchemaEvaluator", () => {
	const outputSchema = {
		type: "object",
		properties: { name: { type: "string" }, age: { type: "number" } },
		required: ["name", "age"],
	};

	beforeEach(() => {
		capturedSubscribeCallback = null;
		mockSetModel.mockClear();
		mockSetSystemPrompt.mockClear();
		mockSubscribe.mockClear();
		mockPrompt.mockClear();
	});

	it("picks the one valid result when only one matches the schema", async () => {
		const evaluator = new SchemaEvaluator(outputSchema);

		const results: BranchResult[] = [
			makeBranchResult({
				branchId: "branch-0",
				branchIndex: 0,
				finalContent: "not json",
			}),
			makeBranchResult({
				branchId: "branch-1",
				branchIndex: 1,
				finalContent: JSON.stringify({ name: "Alice", age: 30 }),
				costUsd: 0.05,
			}),
		];

		const result = await evaluator.evaluate("Do something", results);

		expect(result.winnerId).toBe("branch-1");
		expect(result.winnerIndex).toBe(1);
	});

	it("picks the cheapest result when multiple (but not all) match the schema", async () => {
		const evaluator = new SchemaEvaluator(outputSchema);

		const results: BranchResult[] = [
			makeBranchResult({
				branchId: "branch-0",
				branchIndex: 0,
				finalContent: JSON.stringify({ name: "Alice", age: 30 }),
				costUsd: 0.1,
			}),
			makeBranchResult({
				branchId: "branch-1",
				branchIndex: 1,
				finalContent: JSON.stringify({ name: "Bob", age: 25 }),
				costUsd: 0.03,
			}),
			makeBranchResult({
				branchId: "branch-2",
				branchIndex: 2,
				finalContent: "not valid json schema content",
				costUsd: 0.01,
			}),
		];

		const result = await evaluator.evaluate("Do something", results);

		expect(result.winnerId).toBe("branch-1");
		expect(result.winnerIndex).toBe(1);
	});

	it("falls back to LlmJudge when no results match the schema", async () => {
		const evaluator = new SchemaEvaluator(outputSchema);

		const results: BranchResult[] = [
			makeBranchResult({
				branchId: "branch-0",
				branchIndex: 0,
				finalContent: "not json",
			}),
			makeBranchResult({
				branchId: "branch-1",
				branchIndex: 1,
				finalContent: JSON.stringify({ unrelated: true }),
			}),
		];

		setAgentResponse(
			JSON.stringify({
				winnerId: "branch-0",
				winnerIndex: 0,
				reasoning: "LLM fallback selected branch-0",
			}),
		);

		const result = await evaluator.evaluate("Do something", results);

		// The LLM judge was called (mockPrompt was invoked)
		expect(mockPrompt).toHaveBeenCalledOnce();
		expect(result.reasoning).toBe("LLM fallback selected branch-0");
	});

	it("falls back to LlmJudge when all results match the schema", async () => {
		const evaluator = new SchemaEvaluator(outputSchema);

		const results: BranchResult[] = [
			makeBranchResult({
				branchId: "branch-0",
				branchIndex: 0,
				finalContent: JSON.stringify({ name: "Alice", age: 30 }),
			}),
			makeBranchResult({
				branchId: "branch-1",
				branchIndex: 1,
				finalContent: JSON.stringify({ name: "Bob", age: 25 }),
			}),
		];

		setAgentResponse(
			JSON.stringify({
				winnerId: "branch-1",
				winnerIndex: 1,
				reasoning: "LLM judge prefers branch-1",
			}),
		);

		const result = await evaluator.evaluate("Do something", results);

		expect(mockPrompt).toHaveBeenCalledOnce();
		expect(result.winnerId).toBe("branch-1");
	});
});

// ---------------------------------------------------------------------------
// 9. CustomEvaluator — uses custom prompt
// ---------------------------------------------------------------------------

describe("CustomEvaluator", () => {
	beforeEach(() => {
		capturedSubscribeCallback = null;
		mockSetModel.mockClear();
		mockSetSystemPrompt.mockClear();
		mockSubscribe.mockClear();
		mockPrompt.mockClear();
	});

	it("uses the custom prompt in the agent call", async () => {
		const customPrompt = "Evaluate based on conciseness above all else";
		const evaluator = new CustomEvaluator(customPrompt);

		const results: BranchResult[] = [
			makeBranchResult({ branchId: "branch-0", branchIndex: 0 }),
		];

		setAgentResponse(
			JSON.stringify({
				winnerId: "branch-0",
				winnerIndex: 0,
				reasoning: "Most concise",
			}),
		);

		await evaluator.evaluate("Do something", results);

		// The custom prompt should appear in the prompt call argument
		const promptCallArg: string = mockPrompt.mock.calls[0][0];
		expect(promptCallArg).toContain(customPrompt);
	});

	it("returns a valid EvaluationResult from the agent response", async () => {
		const evaluator = new CustomEvaluator("My custom evaluation criteria");

		const results: BranchResult[] = [
			makeBranchResult({
				branchId: "branch-0",
				branchIndex: 0,
				finalContent: "Short answer",
			}),
			makeBranchResult({
				branchId: "branch-1",
				branchIndex: 1,
				finalContent: "Long detailed answer",
			}),
		];

		setAgentResponse(
			JSON.stringify({
				winnerId: "branch-0",
				winnerIndex: 0,
				reasoning: "Concise is better",
				scores: { "branch-0": 0.9, "branch-1": 0.5 },
			}),
		);

		const result = await evaluator.evaluate("Do something", results);

		expect(result.winnerId).toBe("branch-0");
		expect(result.winnerIndex).toBe(0);
		expect(result.reasoning).toBe("Concise is better");
	});

	it("falls back to first result on malformed agent response", async () => {
		const evaluator = new CustomEvaluator("Rate quality");

		const results: BranchResult[] = [
			makeBranchResult({ branchId: "branch-0", branchIndex: 0 }),
			makeBranchResult({ branchId: "branch-1", branchIndex: 1 }),
		];

		setAgentResponse("oops not json");

		const result = await evaluator.evaluate("Do something", results);

		expect(result.winnerId).toBe("branch-0");
		expect(result.winnerIndex).toBe(0);
	});
});
