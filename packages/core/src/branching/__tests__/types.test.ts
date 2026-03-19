import { describe, expect, it } from "vitest";
import {
	BranchConfigSchema,
	BranchResultSchema,
	EvaluationResultSchema,
} from "../types.js";

// ---------------------------------------------------------------------------
// BranchConfigSchema
// ---------------------------------------------------------------------------

describe("BranchConfigSchema", () => {
	it("accepts an empty config (all fields optional)", () => {
		const result = BranchConfigSchema.safeParse({});
		expect(result.success).toBe(true);
	});

	it("accepts a full valid config", () => {
		const result = BranchConfigSchema.safeParse({
			enabled: true,
			count: 3,
			maxBranches: 5,
			trigger: "explicit",
			confidenceThreshold: 0.5,
			staggerDelayMs: 200,
			evaluator: {
				type: "llm-judge",
				model: "claude-sonnet-4-5",
			},
			branches: [
				{ provider: "anthropic", model: "haiku", sandboxProvider: "docker" },
				{ model: "sonnet" },
			],
		});
		expect(result.success).toBe(true);
	});

	// --- count ---

	it("accepts count of 1", () => {
		const result = BranchConfigSchema.safeParse({ count: 1 });
		expect(result.success).toBe(true);
	});

	it("accepts count of 5", () => {
		const result = BranchConfigSchema.safeParse({ count: 5 });
		expect(result.success).toBe(true);
	});

	it("rejects count below 1", () => {
		const result = BranchConfigSchema.safeParse({ count: 0 });
		expect(result.success).toBe(false);
	});

	it("rejects count above 5", () => {
		const result = BranchConfigSchema.safeParse({ count: 6 });
		expect(result.success).toBe(false);
	});

	// --- maxBranches ---

	it("accepts maxBranches of 1", () => {
		const result = BranchConfigSchema.safeParse({ maxBranches: 1 });
		expect(result.success).toBe(true);
	});

	it("accepts maxBranches of 10", () => {
		const result = BranchConfigSchema.safeParse({ maxBranches: 10 });
		expect(result.success).toBe(true);
	});

	it("rejects maxBranches below 1", () => {
		const result = BranchConfigSchema.safeParse({ maxBranches: 0 });
		expect(result.success).toBe(false);
	});

	it("rejects maxBranches above 10", () => {
		const result = BranchConfigSchema.safeParse({ maxBranches: 11 });
		expect(result.success).toBe(false);
	});

	// --- trigger ---

	it("accepts all valid trigger values", () => {
		for (const trigger of ["explicit", "confidence", "always"]) {
			const result = BranchConfigSchema.safeParse({ trigger });
			expect(result.success).toBe(true);
		}
	});

	it("rejects invalid trigger value", () => {
		const result = BranchConfigSchema.safeParse({ trigger: "invalid" });
		expect(result.success).toBe(false);
	});

	// --- confidenceThreshold ---

	it("accepts confidenceThreshold at boundaries (0 and 1)", () => {
		expect(
			BranchConfigSchema.safeParse({ confidenceThreshold: 0 }).success,
		).toBe(true);
		expect(
			BranchConfigSchema.safeParse({ confidenceThreshold: 1 }).success,
		).toBe(true);
	});

	it("rejects confidenceThreshold below 0", () => {
		const result = BranchConfigSchema.safeParse({ confidenceThreshold: -0.1 });
		expect(result.success).toBe(false);
	});

	it("rejects confidenceThreshold above 1", () => {
		const result = BranchConfigSchema.safeParse({ confidenceThreshold: 1.1 });
		expect(result.success).toBe(false);
	});

	// --- staggerDelayMs ---

	it("accepts staggerDelayMs of 0", () => {
		const result = BranchConfigSchema.safeParse({ staggerDelayMs: 0 });
		expect(result.success).toBe(true);
	});

	it("rejects negative staggerDelayMs", () => {
		const result = BranchConfigSchema.safeParse({ staggerDelayMs: -1 });
		expect(result.success).toBe(false);
	});

	// --- evaluator ---

	it("accepts all valid evaluator types", () => {
		for (const type of ["llm-judge", "schema", "custom"]) {
			const result = BranchConfigSchema.safeParse({ evaluator: { type } });
			expect(result.success).toBe(true);
		}
	});

	it("rejects invalid evaluator type", () => {
		const result = BranchConfigSchema.safeParse({
			evaluator: { type: "invalid" },
		});
		expect(result.success).toBe(false);
	});

	it("accepts evaluator with custom prompt", () => {
		const result = BranchConfigSchema.safeParse({
			evaluator: { type: "custom", prompt: "Pick the best one" },
		});
		expect(result.success).toBe(true);
	});

	it("accepts evaluator with model override", () => {
		const result = BranchConfigSchema.safeParse({
			evaluator: { type: "llm-judge", model: "haiku" },
		});
		expect(result.success).toBe(true);
	});

	// --- branches array ---

	it("accepts branches with partial overrides", () => {
		const result = BranchConfigSchema.safeParse({
			branches: [
				{ model: "haiku" },
				{ provider: "openrouter", model: "sonnet" },
				{},
			],
		});
		expect(result.success).toBe(true);
	});

	it("accepts empty branches array", () => {
		const result = BranchConfigSchema.safeParse({ branches: [] });
		expect(result.success).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// BranchResultSchema
// ---------------------------------------------------------------------------

describe("BranchResultSchema", () => {
	const validResult = {
		branchId: "branch-abc",
		branchIndex: 0,
		events: [],
		finalContent: "Result content",
		status: "success" as const,
	};

	it("accepts a valid branch result", () => {
		const result = BranchResultSchema.safeParse(validResult);
		expect(result.success).toBe(true);
	});

	it("accepts a result with optional cost and turns", () => {
		const result = BranchResultSchema.safeParse({
			...validResult,
			costUsd: 0.05,
			numTurns: 3,
		});
		expect(result.success).toBe(true);
	});

	it("accepts error status", () => {
		const result = BranchResultSchema.safeParse({
			...validResult,
			status: "error",
		});
		expect(result.success).toBe(true);
	});

	it("rejects invalid status", () => {
		const result = BranchResultSchema.safeParse({
			...validResult,
			status: "pending",
		});
		expect(result.success).toBe(false);
	});

	it("rejects missing branchId", () => {
		const { branchId: _, ...without } = validResult;
		const result = BranchResultSchema.safeParse(without);
		expect(result.success).toBe(false);
	});

	it("rejects missing finalContent", () => {
		const { finalContent: _, ...without } = validResult;
		const result = BranchResultSchema.safeParse(without);
		expect(result.success).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// EvaluationResultSchema
// ---------------------------------------------------------------------------

describe("EvaluationResultSchema", () => {
	const validEval = {
		winnerId: "branch-abc",
		winnerIndex: 0,
		reasoning: "Best quality response with cited sources",
	};

	it("accepts a valid evaluation result", () => {
		const result = EvaluationResultSchema.safeParse(validEval);
		expect(result.success).toBe(true);
	});

	it("accepts with optional scores", () => {
		const result = EvaluationResultSchema.safeParse({
			...validEval,
			scores: { "branch-abc": 0.92, "branch-def": 0.71 },
		});
		expect(result.success).toBe(true);
	});

	it("rejects missing winnerId", () => {
		const { winnerId: _, ...without } = validEval;
		const result = EvaluationResultSchema.safeParse(without);
		expect(result.success).toBe(false);
	});

	it("rejects missing reasoning", () => {
		const { reasoning: _, ...without } = validEval;
		const result = EvaluationResultSchema.safeParse(without);
		expect(result.success).toBe(false);
	});

	it("rejects missing winnerIndex", () => {
		const { winnerIndex: _, ...without } = validEval;
		const result = EvaluationResultSchema.safeParse(without);
		expect(result.success).toBe(false);
	});
});
