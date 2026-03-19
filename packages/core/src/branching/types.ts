import * as z from "zod";

// ---------------------------------------------------------------------------
// BranchConfigSchema — branching configuration (used in SandcasterConfig + QueryRequest)
// ---------------------------------------------------------------------------

export const BranchConfigSchema = z.object({
	enabled: z.boolean().optional(),
	count: z.int().gte(1).lte(5).optional(),
	maxBranches: z.int().gte(1).lte(10).optional(),
	trigger: z.enum(["explicit", "confidence", "always"]).optional(),
	confidenceThreshold: z.number().gte(0).lte(1).optional(),
	staggerDelayMs: z.int().gte(0).optional(),
	evaluator: z
		.object({
			type: z.enum(["llm-judge", "schema", "custom"]),
			prompt: z.string().optional(),
			model: z.string().optional(),
		})
		.optional(),
	branches: z
		.array(
			z.object({
				provider: z.string().optional(),
				model: z.string().optional(),
				sandboxProvider: z.string().optional(),
			}),
		)
		.optional(),
});

export type BranchConfig = z.infer<typeof BranchConfigSchema>;

// ---------------------------------------------------------------------------
// BranchResultSchema — result from a single branch execution
// ---------------------------------------------------------------------------

export const BranchResultSchema = z.object({
	branchId: z.string(),
	branchIndex: z.number(),
	events: z.array(z.unknown()),
	finalContent: z.string(),
	costUsd: z.number().optional(),
	numTurns: z.number().optional(),
	status: z.enum(["success", "error"]),
});

export type BranchResult = z.infer<typeof BranchResultSchema>;

// ---------------------------------------------------------------------------
// EvaluationResultSchema — result from evaluator
// ---------------------------------------------------------------------------

export const EvaluationResultSchema = z.object({
	winnerId: z.string(),
	winnerIndex: z.number(),
	reasoning: z.string(),
	scores: z.record(z.string(), z.number()).optional(),
});

export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;

// ---------------------------------------------------------------------------
// BranchOverride — per-branch provider/model/sandboxProvider override
// ---------------------------------------------------------------------------

export interface BranchOverride {
	provider?: string;
	model?: string;
	sandboxProvider?: string;
}

// ---------------------------------------------------------------------------
// Evaluator — interface for branch result evaluation
// ---------------------------------------------------------------------------

export interface Evaluator {
	evaluate(
		originalPrompt: string,
		results: BranchResult[],
	): Promise<EvaluationResult>;
}
