import type {
	QueryRequest,
	SandcasterConfig,
	SandcasterEvent,
} from "../schemas.js";
import { createEvaluator } from "./evaluator.js";
import type { BranchResult as BranchResultBase, Evaluator } from "./types.js";

/** Internal branch result with properly typed events */
type BranchResult = Omit<BranchResultBase, "events"> & {
	events: SandcasterEvent[];
};

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

/** Build per-branch config, stripping branching to prevent recursion */
function buildBranchConfig(
	parentConfig: SandcasterConfig | undefined,
	branchIndex: number,
): { config: SandcasterConfig; requestOverrides: Partial<QueryRequest> } {
	const base: SandcasterConfig = { ...parentConfig };
	delete base.branching;

	const overrides = parentConfig?.branching?.branches?.[branchIndex];
	const requestOverrides: Partial<QueryRequest> = {};

	if (overrides) {
		if (overrides.model) base.model = overrides.model;
		if (overrides.provider) {
			requestOverrides.provider =
				overrides.provider as QueryRequest["provider"];
		}
		if (overrides.sandboxProvider) {
			requestOverrides.sandboxProvider =
				overrides.sandboxProvider as QueryRequest["sandboxProvider"];
		}
	}

	return { config: base, requestOverrides };
}

// ---------------------------------------------------------------------------
// Branch execution with progress reporting
// ---------------------------------------------------------------------------

interface ProgressReport {
	branchId: string;
	branchIndex: number;
	status: "running" | "completed" | "error";
	numTurns?: number;
	costUsd?: number;
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
	onProgress: (report: ProgressReport) => void,
): Promise<BranchResult> {
	const branchPrompt = buildBranchPrompt(prompt, contextEvents);
	const { config: branchConfig, requestOverrides } = buildBranchConfig(
		parentConfig,
		branchIndex,
	);

	if (remainingTimeout !== undefined) {
		branchConfig.timeout = Math.max(1, Math.floor(remainingTimeout));
	}

	// Strip branching from request too (recursive guard)
	const {
		branching: _strip,
		timeout: _parentTimeout,
		...cleanRequest
	} = parentRequest;
	const branchRequest: QueryRequest = {
		...cleanRequest,
		...requestOverrides,
		prompt: branchPrompt,
		// Use remaining timeout (if computed) so branches don't exceed the parent budget
		...(remainingTimeout !== undefined
			? { timeout: Math.max(1, Math.floor(remainingTimeout)) }
			: {}),
	};

	const events: SandcasterEvent[] = [];
	let finalContent = "";
	let costUsd: number | undefined;
	let numTurns: number | undefined;
	let turnCount = 0;
	let sawError = false;

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

			// Track turns at tool_result boundaries (not per-token assistant deltas)
			if (event.type === "tool_result") {
				turnCount++;
				onProgress({
					branchId,
					branchIndex,
					status: "running",
					numTurns: turnCount,
					costUsd,
				});
			}

			if (event.type === "error") {
				sawError = true;
				finalContent = event.content;
			}

			if (event.type === "result") {
				finalContent = event.content;
				costUsd = event.costUsd;
				numTurns = event.numTurns;
			}
		}

		// Aborted or error-emitting branches must not return "success"
		if (signal.aborted) {
			return {
				branchId,
				branchIndex,
				events,
				finalContent: finalContent || "Branch aborted",
				costUsd,
				numTurns,
				status: "error",
			};
		}

		return {
			branchId,
			branchIndex,
			events,
			finalContent,
			costUsd,
			numTurns,
			status: sawError ? "error" : "success",
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
	} = options;

	// Resolve evaluator: explicit option takes precedence, then config-based creation
	const evaluator: Evaluator | undefined =
		options.evaluator ??
		(config?.branching?.evaluator
			? createEvaluator(
					config.branching.evaluator,
					request.outputFormat as Record<string, unknown> | undefined,
				)
			: undefined);

	const startTime = Date.now();
	const originalTimeoutSecs = request.timeout ?? config?.timeout;

	// --- Always-branch trigger: skip initial run, directly create N branches ---
	if (config?.branching?.trigger === "always") {
		const branchCount = config.branching.count ?? 3;
		const alternatives = Array.from(
			{ length: branchCount },
			() => request.prompt,
		);
		return yield* runBranchingPath(
			alternatives,
			[], // no context events
			config,
			request,
			evaluator,
			runAgent,
			parentSignal,
			originalTimeoutSecs,
			startTime,
		);
	}

	// Run the initial agent
	const initialGen = runAgent({ request, config, requestId });

	const contextEvents: SandcasterEvent[] = [];
	let branchRequestEvent:
		| Extract<SandcasterEvent, { type: "branch_request" }>
		| undefined;
	let confidenceTriggered = false;
	let confidenceTriggerAlternatives: string[] | undefined;

	// Stream the initial run, watching for a branch_request or confidence_report event
	for await (const event of initialGen) {
		if (parentSignal?.aborted) {
			await initialGen.return(undefined);
			return;
		}

		if (event.type === "branch_request") {
			branchRequestEvent = event;
			break;
		}

		// Always yield confidence_report events to the consumer
		if (event.type === "confidence_report") {
			yield event;

			// Confidence trigger: only fire once (one-shot) — break immediately to start branching
			if (
				!confidenceTriggered &&
				config?.branching?.trigger === "confidence" &&
				event.level < (config.branching.confidenceThreshold ?? 0.5)
			) {
				confidenceTriggered = true;
				const branchCount = config.branching.count ?? 3;
				confidenceTriggerAlternatives = Array.from(
					{ length: branchCount },
					(_, i) =>
						`Try a different approach: ${request.prompt}. Previous approach had low confidence because: ${event.reason}. Attempt #${i + 1}`,
				);
				break;
			}
			continue;
		}

		// Capture context events for potential mid-run branching (skip streaming deltas)
		if (
			(event.type === "assistant" && event.subtype === "complete") ||
			event.type === "tool_use" ||
			event.type === "tool_result"
		) {
			contextEvents.push(event);
		}

		yield event;
	}

	// Confidence trigger fired: abort the initial run and start branching
	if (confidenceTriggerAlternatives) {
		await initialGen.return(undefined);

		return yield* runBranchingPath(
			confidenceTriggerAlternatives,
			contextEvents,
			config,
			request,
			evaluator,
			runAgent,
			parentSignal,
			originalTimeoutSecs,
			startTime,
		);
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

	// --- Explicit branch_request trigger ---
	return yield* runBranchingPath(
		branchRequestEvent.alternatives,
		contextEvents,
		config,
		request,
		evaluator,
		runAgent,
		parentSignal,
		originalTimeoutSecs,
		startTime,
	);
}

// ---------------------------------------------------------------------------
// Shared branching execution path
// ---------------------------------------------------------------------------

async function* runBranchingPath(
	alternatives: string[],
	contextEvents: SandcasterEvent[],
	config: SandcasterConfig | undefined,
	request: QueryRequest,
	evaluator: Evaluator | undefined,
	runAgent: BranchRunOptions["runAgent"],
	parentSignal: AbortSignal | undefined,
	originalTimeoutSecs: number | undefined,
	startTime: number,
): AsyncGenerator<SandcasterEvent> {
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
		// Fix P1: handle already-aborted signal
		if (parentSignal.aborted) {
			branchAbortController.abort();
		} else {
			parentSignal.addEventListener(
				"abort",
				() => branchAbortController.abort(),
				{ once: true },
			);
		}
	}

	// Generate branch IDs upfront
	const branchIds = alternatives.map((_, i) => generateBranchId(i));

	// Shared progress queue — branches push progress here, orchestrator yields them
	const progressQueue: SandcasterEvent[] = [];

	// Push-based notification: branches signal when new progress is available
	let progressNotify: (() => void) | undefined;
	function waitForProgress(): Promise<void> {
		return new Promise<void>((resolve) => {
			progressNotify = resolve;
		});
	}

	// Emit branch_start events and start branches with stagger
	const branchPromises: Promise<BranchResult>[] = [];

	for (let i = 0; i < alternatives.length; i++) {
		// Fix P1: check abort before starting new branches
		if (branchAbortController.signal.aborted) break;

		const branchId = branchIds[i];
		const alternative = alternatives[i];

		// Stagger: delay before starting the next branch
		if (i > 0 && staggerDelayMs > 0) {
			await new Promise((r) => setTimeout(r, staggerDelayMs));
			// Check abort after stagger wait — must run before branch_start
			// is yielded so we don't emit a start without a matching complete.
			if (branchAbortController.signal.aborted) break;
		}

		yield {
			type: "branch_start",
			branchId,
			branchIndex: i,
			totalBranches,
			prompt: alternative,
		};

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
			(report) => {
				progressQueue.push({
					type: "branch_progress",
					...report,
				});
				progressNotify?.();
			},
		);

		branchPromises.push(branchPromise);
	}

	// Yield progress events while waiting for branches to complete
	const allDone = Promise.allSettled(branchPromises);
	let resolved = false;
	const markResolved = allDone.then(() => {
		resolved = true;
		progressNotify?.();
	});

	while (!resolved) {
		// Yield queued progress events
		while (progressQueue.length > 0) {
			yield progressQueue.shift()!;
		}

		// Wait for either completion or new progress (no polling)
		if (!resolved) {
			await Promise.race([markResolved, waitForProgress()]);
		}
	}

	// Flush remaining progress events
	while (progressQueue.length > 0) {
		yield progressQueue.shift()!;
	}

	const settled = await allDone;

	// Collect results
	const results: BranchResult[] = [];
	let totalCostUsd = 0;

	for (let i = 0; i < settled.length; i++) {
		const outcome = settled[i];
		const branchId = branchIds[i];

		if (outcome.status === "fulfilled") {
			const result = outcome.value;
			results.push(result);

			totalCostUsd += result.costUsd ?? 0;

			yield {
				type: "branch_complete",
				branchId,
				status: result.status,
				costUsd: result.costUsd,
				numTurns: result.numTurns,
				content: result.finalContent || undefined,
			};
		} else {
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
			evaluatorName = evaluator.name;
		} catch (err) {
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

	// Emit terminal result event so consumers (TUI, CLI, API) recognize completion
	yield {
		type: "result",
		content: winnerResult.finalContent,
		costUsd: totalCostUsd,
		numTurns: winnerResult.numTurns,
	};

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
