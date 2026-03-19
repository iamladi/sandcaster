import type { AgentEvent } from "@mariozechner/pi-agent-core";
import { Agent } from "@mariozechner/pi-agent-core";
import { autoDetectModel, resolveModel } from "../runner/model-aliases.js";
import type { BranchResult, EvaluationResult, Evaluator } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the final text response from an agent by subscribing to agent_end events.
 * Returns the last assistant text content found.
 */
async function runAgentAndGetText(
	agent: Agent,
	userMessage: string,
): Promise<string> {
	let responseText = "";

	agent.subscribe((event: AgentEvent) => {
		if (event.type === "agent_end") {
			// Walk messages in reverse to find the last assistant message
			const messages = [...event.messages].reverse();
			for (const msg of messages) {
				if (
					"role" in msg &&
					msg.role === "assistant" &&
					"content" in msg &&
					Array.isArray(msg.content)
				) {
					for (const part of msg.content) {
						if (
							typeof part === "object" &&
							part !== null &&
							"type" in part &&
							part.type === "text" &&
							"text" in part &&
							typeof part.text === "string"
						) {
							responseText = part.text;
							return;
						}
					}
				}
			}
		}
	});

	await agent.prompt(userMessage);
	return responseText;
}

/**
 * Parse an agent response as JSON EvaluationResult.
 * Returns null if parsing fails or required fields are missing.
 */
function parseEvaluationResult(text: string): EvaluationResult | null {
	try {
		const parsed = JSON.parse(text);
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			typeof parsed.winnerId === "string" &&
			typeof parsed.winnerIndex === "number" &&
			typeof parsed.reasoning === "string"
		) {
			return parsed as EvaluationResult;
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Fallback EvaluationResult that picks the first branch result.
 */
function fallbackResult(results: BranchResult[]): EvaluationResult {
	const first = results[0];
	return {
		winnerId: first.branchId,
		winnerIndex: first.branchIndex,
		reasoning: "Fallback: selected first result due to evaluation failure",
	};
}

/**
 * Build a summary of all branch results for inclusion in judge prompts.
 */
function buildBranchSummary(results: BranchResult[]): string {
	return results
		.map(
			(r) =>
				`Branch ID: ${r.branchId}\nBranch Index: ${r.branchIndex}\nContent:\n${r.finalContent}`,
		)
		.join("\n\n---\n\n");
}

/**
 * Create a configured judge agent, run it on the user message, and parse the result.
 */
async function runJudge(
	systemPrompt: string,
	userMessage: string,
	results: BranchResult[],
	model?: string,
): Promise<EvaluationResult> {
	const agent = new Agent();
	agent.setModel(model ? resolveModel(model) : autoDetectModel(process.env));
	agent.setSystemPrompt(systemPrompt);

	const responseText = await runAgentAndGetText(agent, userMessage);
	const parsed = parseEvaluationResult(responseText);
	return parsed ?? fallbackResult(results);
}

// ---------------------------------------------------------------------------
// LlmJudgeEvaluator
// ---------------------------------------------------------------------------

export class LlmJudgeEvaluator implements Evaluator {
	readonly name = "llm-judge";

	constructor(private model?: string) {}

	async evaluate(
		originalPrompt: string,
		results: BranchResult[],
	): Promise<EvaluationResult> {
		const branchSummary = buildBranchSummary(results);

		return runJudge(
			"You are an impartial judge evaluating AI agent responses. " +
				"Your task is to select the best response from multiple branches. " +
				"Respond ONLY with a JSON object with these fields: " +
				'{ "winnerId": string, "winnerIndex": number, "reasoning": string, "scores": Record<string, number> }',
			`Original prompt: ${originalPrompt}\n\n` +
				`Branch results:\n\n${branchSummary}\n\n` +
				"Select the best branch and respond with JSON: " +
				'{ "winnerId": "<branchId>", "winnerIndex": <number>, "reasoning": "<why>", "scores": { "<branchId>": <0-1>, ... } }',
			results,
			this.model,
		);
	}
}

// ---------------------------------------------------------------------------
// SchemaEvaluator
// ---------------------------------------------------------------------------

/**
 * Validate a parsed object against a simple JSON schema by checking
 * that all required top-level keys are present.
 */
function validateAgainstSchema(
	parsed: unknown,
	schema: Record<string, unknown>,
): boolean {
	if (typeof parsed !== "object" || parsed === null) {
		return false;
	}

	const required = schema.required;
	if (!Array.isArray(required)) {
		// No required fields — any object is valid
		return true;
	}

	const obj = parsed as Record<string, unknown>;
	for (const key of required) {
		if (!(key in obj)) {
			return false;
		}
	}
	return true;
}

export class SchemaEvaluator implements Evaluator {
	readonly name = "schema";

	constructor(
		private outputSchema: Record<string, unknown>,
		private fallbackModel?: string,
	) {}

	async evaluate(
		originalPrompt: string,
		results: BranchResult[],
	): Promise<EvaluationResult> {
		const validResults: BranchResult[] = [];

		for (const result of results) {
			try {
				const parsed = JSON.parse(result.finalContent);
				if (validateAgainstSchema(parsed, this.outputSchema)) {
					validResults.push(result);
				}
			} catch {
				// Not valid JSON — skip
			}
		}

		const totalCount = results.length;
		const validCount = validResults.length;

		// Exactly one valid result: return it directly
		if (validCount === 1) {
			const winner = validResults[0];
			return {
				winnerId: winner.branchId,
				winnerIndex: winner.branchIndex,
				reasoning: "Only result that matched the output schema",
			};
		}

		// Multiple valid results: pick the one with the lowest costUsd
		if (validCount > 1 && validCount < totalCount) {
			const sorted = [...validResults].sort(
				(a, b) => (a.costUsd ?? 0) - (b.costUsd ?? 0),
			);
			const winner = sorted[0];
			return {
				winnerId: winner.branchId,
				winnerIndex: winner.branchIndex,
				reasoning:
					"Selected valid result with lowest cost among schema-matching branches",
			};
		}

		// None valid OR all valid: fall back to LlmJudge
		const llmJudge = new LlmJudgeEvaluator(this.fallbackModel);
		return llmJudge.evaluate(originalPrompt, results);
	}
}

// ---------------------------------------------------------------------------
// CustomEvaluator
// ---------------------------------------------------------------------------

export class CustomEvaluator implements Evaluator {
	readonly name = "custom";

	constructor(
		private customPrompt: string,
		private model?: string,
	) {}

	async evaluate(
		originalPrompt: string,
		results: BranchResult[],
	): Promise<EvaluationResult> {
		const branchSummary = buildBranchSummary(results);

		return runJudge(
			"You are an evaluator for AI agent responses. " +
				"Respond ONLY with a JSON object with these fields: " +
				'{ "winnerId": string, "winnerIndex": number, "reasoning": string, "scores": Record<string, number> }',
			`${this.customPrompt}\n\n` +
				`Original prompt: ${originalPrompt}\n\n` +
				`Branch results:\n\n${branchSummary}\n\n` +
				"Select the best branch and respond with JSON: " +
				'{ "winnerId": "<branchId>", "winnerIndex": <number>, "reasoning": "<why>", "scores": { "<branchId>": <0-1>, ... } }',
			results,
			this.model,
		);
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface EvaluatorConfig {
	type: "llm-judge" | "schema" | "custom";
	prompt?: string;
	model?: string;
}

export function createEvaluator(
	config: EvaluatorConfig,
	outputSchema?: Record<string, unknown>,
): Evaluator {
	switch (config.type) {
		case "llm-judge":
			return new LlmJudgeEvaluator(config.model);
		case "schema":
			if (!outputSchema) {
				throw new Error("SchemaEvaluator requires outputSchema");
			}
			return new SchemaEvaluator(outputSchema, config.model);
		case "custom":
			if (!config.prompt) {
				throw new Error("CustomEvaluator requires a prompt");
			}
			return new CustomEvaluator(config.prompt, config.model);
	}
}
