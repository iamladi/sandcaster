import type {
	QueryRequest,
	SandcasterConfig,
	SandcasterEvent,
} from "../schemas.js";
import type { BranchResult, Evaluator } from "./types.js";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface BranchRunOptions {
	request: QueryRequest;
	config?: SandcasterConfig;
	requestId?: string;
	signal?: AbortSignal;
	/** DI: the function that runs an agent in a sandbox */
	runAgent: (options: {
		request: QueryRequest;
		config?: SandcasterConfig;
		requestId?: string;
	}) => AsyncGenerator<SandcasterEvent>;
	/** DI: evaluator for selecting the winning branch */
	evaluator?: Evaluator;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateBranchId(index: number): string {
	return `branch-${index}-${crypto.randomUUID().slice(0, 8)}`;
}

/** Extract conversation context events from initial run (assistant, tool_use, tool_result) */
function buildContextSummary(contextEvents: SandcasterEvent[]): string {
	const parts: string[] = [];
	for (const event of contextEvents) {
		if (event.type === "assistant") {
			parts.push(`Assistant: ${event.content}`);
		} else if (event.type === "tool_use") {
			parts.push(`Tool call (${event.toolName}): ${event.content}`);
		} else if (event.type === "tool_result") {
			parts.push(`Tool result (${event.toolName}): ${event.content}`);
		}
	}
	return parts.join("\n");
}

/** Build branch prompt with context from initial run */
function buildBranchPrompt(
	alternativePrompt: string,
	contextEvents: SandcasterEvent[],
): string {
	const summary = buildContextSummary(contextEvents);
	if (summary) {
		return `Context from initial execution:\n${summary}\n\nYour task: ${alternativePrompt}`;
	}
	return alternativePrompt;
}

/** Merge parent config with per-branch overrides, without branching_enabled */
function buildBranchConfig(
	parentConfig: SandcasterConfig | undefined,
	branchIndex: number,
): SandcasterConfig {
	const base: SandcasterConfig = { ...parentConfig };

	// Strip branching from branch configs to prevent recursive branching
	delete base.branching;

	const overrides = parentConfig?.branching?.branches?.[branchIndex];

	if (overrides) {
		if (overrides.model) base.model = overrides.model;
		if (overrides.provider) {
			// provider is on QueryRequest not SandcasterConfig, but we'll type-cast here
			// as the spec says to merge provider override
			(base as Record<string, unknown>).provider = overrides.provider;
		}
		if (overrides.sandboxProvider) {
			(base as Record<string, unknown>).sandboxProvider =
				overrides.sandboxProvider;
		}
	}

	return base;
}

// ---------------------------------------------------------------------------
// Branch execution
// ---------------------------------------------------------------------------

interface BranchExecution {
	branchId: string;
	branchIndex: number;
	controller: AbortController;
	promise: Promise<BranchResult>;
	events: SandcasterEvent[];
}

async function runSingleBranch(
	branchId: string,
	branchIndex: number,
	prompt: string,
	parentConfig: SandcasterConfig | undefined,
	parentRequest: QueryRequest,
	contextEvents: SandcasterEvent[],
	runAgent: BranchRunOptions["runAgent"],
	remainingTimeout: number | undefined,
	signal: AbortSignal,
): Promise<BranchResult> {
	const branchPrompt = buildBranchPrompt(prompt, contextEvents);
	const branchConfig = buildBranchConfig(parentConfig, branchIndex);

	if (remainingTimeout !== undefined) {
		branchConfig.timeout = Math.max(1, Math.floor(remainingTimeout));
	}

	const branchRequest: QueryRequest = {
		...parentRequest,
		prompt: branchPrompt,
	};

	const events: SandcasterEvent[] = [];
	let finalContent = "";
	let costUsd: number | undefined;
	let numTurns: number | undefined;

	try {
		const gen = runAgent({
			request: branchRequest,
			config: branchConfig,
		});

		for await (const event of gen) {
			if (signal.aborted) {
				await gen.return(undefined);
				break;
			}
			events.push(event);
			if (event.type === "result") {
				finalContent = event.content;
				costUsd = event.costUsd;
				numTurns = event.numTurns;
			}
		}

		return {
			branchId,
			branchIndex,
			events,
			finalContent,
			costUsd,
			numTurns,
			status: "success",
		};
	} catch (err) {
		return {
			branchId,
			branchIndex,
			events,
			finalContent: err instanceof Error ? err.message : String(err),
			status: "error",
		};
	}
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export async function* runBranchedAgent(
	options: BranchRunOptions,
): AsyncGenerator<SandcasterEvent> {
	const {
		request,
		config,
		requestId,
		signal: parentSignal,
		runAgent,
		evaluator,
	} = options;

	const startTime = Date.now();
	const originalTimeoutSecs = request.timeout ?? config?.timeout;

	// Run the initial agent
	const initialGen = runAgent({ request, config, requestId });

	const contextEvents: SandcasterEvent[] = [];
	let branchRequestEvent:
		| Extract<SandcasterEvent, { type: "branch_request" }>
		| undefined;

	// Stream the initial run, watching for a branch_request event
	for await (const event of initialGen) {
		if (parentSignal?.aborted) {
			await initialGen.return(undefined);
			return;
		}

		if (event.type === "branch_request") {
			branchRequestEvent = event;
			// Stop yielding initial events — we'll branch now
			break;
		}

		// Capture context events for potential mid-run branching
		if (
			event.type === "assistant" ||
			event.type === "tool_use" ||
			event.type === "tool_result"
		) {
			contextEvents.push(event);
		}

		yield event;
	}

	// No branching occurred: drain any remaining events from initial gen
	if (!branchRequestEvent) {
		for await (const event of initialGen) {
			if (parentSignal?.aborted) {
				await initialGen.return(undefined);
				return;
			}
			yield event;
		}
		return;
	}

	// --- Branching path ---

	const alternatives = branchRequestEvent.alternatives;
	const totalBranches = alternatives.length;
	const staggerDelayMs = config?.branching?.staggerDelayMs ?? 200;

	// Calculate remaining timeout
	let remainingTimeout: number | undefined;
	if (originalTimeoutSecs !== undefined) {
		const elapsedSecs = (Date.now() - startTime) / 1000;
		remainingTimeout = originalTimeoutSecs - elapsedSecs;
	}

	// Create a combined abort controller for all branches
	const branchAbortController = new AbortController();
	if (parentSignal) {
		parentSignal.addEventListener(
			"abort",
			() => branchAbortController.abort(),
			{
				once: true,
			},
		);
	}

	// Generate branch IDs upfront
	const branchIds = alternatives.map((_, i) => generateBranchId(i));

	// Emit branch_start events and start branches with stagger
	const branchPromises: Promise<BranchResult>[] = [];

	for (let i = 0; i < alternatives.length; i++) {
		const branchId = branchIds[i];
		const alternative = alternatives[i];

		yield {
			type: "branch_start",
			branchId,
			branchIndex: i,
			totalBranches,
			prompt: alternative,
		};

		// Stagger: delay before starting the next branch
		if (i > 0 && staggerDelayMs > 0) {
			await new Promise((r) => setTimeout(r, staggerDelayMs));
		}

		const branchPromise = runSingleBranch(
			branchId,
			i,
			alternative,
			config,
			request,
			contextEvents,
			runAgent,
			remainingTimeout,
			branchAbortController.signal,
		);

		branchPromises.push(branchPromise);
	}

	// Wait for all branches to complete
	const settled = await Promise.allSettled(branchPromises);

	// Collect results
	const results: BranchResult[] = [];
	let totalCostUsd = 0;

	for (let i = 0; i < settled.length; i++) {
		const outcome = settled[i];
		const branchId = branchIds[i];

		if (outcome.status === "fulfilled") {
			const result = outcome.value;
			results.push(result);

			const costUsd = result.costUsd ?? 0;
			totalCostUsd += costUsd;

			yield {
				type: "branch_complete",
				branchId,
				status: result.status,
				costUsd: result.costUsd,
				numTurns: result.numTurns,
				content: result.finalContent || undefined,
			};
		} else {
			// Promise itself rejected (shouldn't happen since runSingleBranch catches)
			results.push({
				branchId,
				branchIndex: i,
				events: [],
				finalContent: String(outcome.reason),
				status: "error",
			});

			yield {
				type: "branch_complete",
				branchId,
				status: "error",
				content: String(outcome.reason),
			};
		}
	}

	const successfulResults = results.filter((r) => r.status === "success");
	const successCount = successfulResults.length;

	// All branches failed
	if (successCount === 0) {
		yield {
			type: "error",
			content: "All branches failed to complete successfully",
			code: "BRANCH_ALL_FAILED",
		};

		yield {
			type: "branch_summary",
			totalBranches,
			successCount: 0,
			totalCostUsd,
			evaluator: "none",
		};
		return;
	}

	// Select winner
	let winnerResult: BranchResult = successfulResults[0];
	let selectionReason = "first successful branch";
	let scores: Record<string, number> | undefined;
	let evaluatorName = "none";

	if (evaluator && successfulResults.length > 0) {
		try {
			const evalResult = await evaluator.evaluate(
				request.prompt,
				successfulResults,
			);

			// Find the winner from eval result
			const found = successfulResults.find(
				(r) =>
					r.branchId === evalResult.winnerId ||
					r.branchIndex === evalResult.winnerIndex,
			);
			if (found) {
				winnerResult = found;
			}
			selectionReason = evalResult.reasoning;
			scores = evalResult.scores;
			evaluatorName = "evaluator";
		} catch (err) {
			// Evaluator failed: fallback to first successful branch
			yield {
				type: "warning",
				content: `Evaluator failed: ${err instanceof Error ? err.message : String(err)}. Falling back to first successful branch.`,
			};
		}
	}

	// Emit branch_selected
	yield {
		type: "branch_selected",
		branchId: winnerResult.branchId,
		branchIndex: winnerResult.branchIndex,
		reason: selectionReason,
		scores,
	};

	// Yield winning branch's events
	for (const event of winnerResult.events) {
		yield event;
	}

	// Emit branch_summary
	yield {
		type: "branch_summary",
		totalBranches,
		successCount,
		totalCostUsd,
		evaluator: evaluatorName,
		winnerId: winnerResult.branchId,
	};
}
