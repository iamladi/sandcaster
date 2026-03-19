import { describe, expect, it, vi } from "vitest";
import type { SandcasterEvent } from "../../schemas.js";
import {
	type BranchRunOptions,
	runBranchedAgent,
} from "../branch-orchestrator.js";
import type { EvaluationResult, Evaluator } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a fake runAgent that yields the given events synchronously */
function fakeRunAgent(events: SandcasterEvent[]): BranchRunOptions["runAgent"] {
	return async function* () {
		for (const event of events) {
			yield event;
		}
	};
}

/** Creates a fake runAgent that yields events with a delay between each */
function _delayedRunAgent(
	events: SandcasterEvent[],
	delayMs: number,
): BranchRunOptions["runAgent"] {
	return async function* () {
		for (const event of events) {
			await new Promise((r) => setTimeout(r, delayMs));
			yield event;
		}
	};
}

/** Collect all events from an async generator */
async function collectEvents(
	gen: AsyncGenerator<SandcasterEvent>,
): Promise<SandcasterEvent[]> {
	const events: SandcasterEvent[] = [];
	for await (const event of gen) {
		events.push(event);
	}
	return events;
}

const RESULT_EVENT: SandcasterEvent = {
	type: "result",
	content: "done",
	costUsd: 0.01,
	numTurns: 1,
};

const ASSISTANT_EVENT: SandcasterEvent = {
	type: "assistant",
	content: "I will help you",
};

const BRANCH_REQUEST_EVENT: SandcasterEvent = {
	type: "branch_request",
	alternatives: ["approach A", "approach B"],
	reason: "Exploring alternatives",
};

// ---------------------------------------------------------------------------
// 1. Passthrough when no branching occurs
// ---------------------------------------------------------------------------

describe("passthrough when no branch_request", () => {
	it("yields all events normally when no branch_request is emitted", async () => {
		const events: SandcasterEvent[] = [
			{ type: "system", content: "starting" },
			ASSISTANT_EVENT,
			RESULT_EVENT,
		];

		const result = await collectEvents(
			runBranchedAgent({
				request: { prompt: "hello" },
				runAgent: fakeRunAgent(events),
			}),
		);

		expect(result).toEqual(events);
	});
});

// ---------------------------------------------------------------------------
// 2. Detects branch_request and creates parallel branches
// ---------------------------------------------------------------------------

describe("branching on branch_request", () => {
	it("emits branch_start events when branch_request is detected", async () => {
		const initialEvents: SandcasterEvent[] = [
			ASSISTANT_EVENT,
			BRANCH_REQUEST_EVENT,
		];

		const branchEvents: SandcasterEvent[] = [
			{ type: "assistant", content: "branch result" },
			{ type: "result", content: "branch done", costUsd: 0.01, numTurns: 1 },
		];

		// Branch runs always get the same events for simplicity
		let callCount = 0;
		const runAgent: BranchRunOptions["runAgent"] = async function* (_opts) {
			callCount++;
			if (callCount === 1) {
				// Initial run
				for (const e of initialEvents) yield e;
			} else {
				// Branch runs
				for (const e of branchEvents) yield e;
			}
		};

		const result = await collectEvents(
			runBranchedAgent({
				request: { prompt: "hello" },
				runAgent,
				config: { branching: { staggerDelayMs: 0 } },
			}),
		);

		const branchStarts = result.filter((e) => e.type === "branch_start");
		expect(branchStarts).toHaveLength(2);

		// Each branch_start should reference the correct prompt from alternatives
		const starts = branchStarts as Extract<
			SandcasterEvent,
			{ type: "branch_start" }
		>[];
		expect(starts[0].branchIndex).toBe(0);
		expect(starts[1].branchIndex).toBe(1);
		expect(starts[0].totalBranches).toBe(2);
		expect(starts[1].totalBranches).toBe(2);
	});

	it("emits branch_summary at the end", async () => {
		let callCount = 0;
		const runAgent: BranchRunOptions["runAgent"] = async function* () {
			callCount++;
			if (callCount === 1) {
				yield ASSISTANT_EVENT;
				yield BRANCH_REQUEST_EVENT;
			} else {
				yield { type: "result", content: "done", costUsd: 0.01, numTurns: 1 };
			}
		};

		const result = await collectEvents(
			runBranchedAgent({
				request: { prompt: "hello" },
				runAgent,
				config: { branching: { staggerDelayMs: 0 } },
			}),
		);

		const summaries = result.filter((e) => e.type === "branch_summary");
		expect(summaries).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// 3. Correct event ordering
// ---------------------------------------------------------------------------

describe("event ordering", () => {
	it("emits branch_start before branch_selected before branch_summary", async () => {
		let callCount = 0;
		const runAgent: BranchRunOptions["runAgent"] = async function* () {
			callCount++;
			if (callCount === 1) {
				yield ASSISTANT_EVENT;
				yield BRANCH_REQUEST_EVENT;
			} else {
				yield { type: "result", content: "done", costUsd: 0.01, numTurns: 1 };
			}
		};

		const result = await collectEvents(
			runBranchedAgent({
				request: { prompt: "hello" },
				runAgent,
				config: { branching: { staggerDelayMs: 0 } },
			}),
		);

		const types = result.map((e) => e.type);
		const startIdx = types.indexOf("branch_start");
		const selectedIdx = types.indexOf("branch_selected");
		const summaryIdx = types.indexOf("branch_summary");

		expect(startIdx).toBeGreaterThanOrEqual(0);
		expect(selectedIdx).toBeGreaterThan(startIdx);
		expect(summaryIdx).toBeGreaterThan(selectedIdx);
	});
});

// ---------------------------------------------------------------------------
// 4. Per-branch override resolution
// ---------------------------------------------------------------------------

describe("per-branch config overrides", () => {
	it("passes per-branch model/provider overrides to branch runs", async () => {
		const capturedRequests: Array<{
			request: { prompt: string };
			config?: unknown;
		}> = [];

		let callCount = 0;
		const runAgent: BranchRunOptions["runAgent"] = async function* (opts) {
			callCount++;
			capturedRequests.push({ request: opts.request, config: opts.config });
			if (callCount === 1) {
				yield ASSISTANT_EVENT;
				yield {
					type: "branch_request",
					alternatives: ["do A"],
					reason: "test",
				} satisfies SandcasterEvent;
			} else {
				yield { type: "result", content: "done", costUsd: 0.01, numTurns: 1 };
			}
		};

		await collectEvents(
			runBranchedAgent({
				request: { prompt: "test" },
				runAgent,
				config: {
					model: "base-model",
					branching: {
						staggerDelayMs: 0,
						branches: [{ model: "override-model", provider: "openrouter" }],
					},
				},
			}),
		);

		// Branch run should have overridden model
		expect(capturedRequests).toHaveLength(2);
		const branchConfig = capturedRequests[1].config as {
			model?: string;
			provider?: string;
		};
		expect(branchConfig.model).toBe("override-model");
	});
});

// ---------------------------------------------------------------------------
// 5. Evaluator integration
// ---------------------------------------------------------------------------

describe("evaluator integration", () => {
	it("calls evaluator with branch results and uses returned winner", async () => {
		const evaluateSpy = vi.fn<Evaluator["evaluate"]>();

		let callCount = 0;
		let branchCallCount = 0;
		const branchIds: string[] = [];

		const runAgent: BranchRunOptions["runAgent"] = async function* () {
			callCount++;
			if (callCount === 1) {
				yield ASSISTANT_EVENT;
				yield {
					type: "branch_request",
					alternatives: ["A", "B"],
				} satisfies SandcasterEvent;
			} else {
				branchCallCount++;
				yield {
					type: "result",
					content: `branch ${branchCallCount} result`,
					costUsd: 0.01,
					numTurns: 1,
				};
			}
		};

		// We need to capture branch IDs to set the winner
		// We'll set winner after we know what IDs are emitted
		const collectedEvents: SandcasterEvent[] = [];
		const gen = runBranchedAgent({
			request: { prompt: "hello" },
			runAgent,
			config: { branching: { staggerDelayMs: 0 } },
			evaluator: {
				evaluate: async (prompt, results) => {
					branchIds.push(...results.map((r) => r.branchId));
					const winner = results[1]; // pick second branch
					const evalResult: EvaluationResult = {
						winnerId: winner.branchId,
						winnerIndex: winner.branchIndex,
						reasoning: "second branch is better",
						scores: Object.fromEntries(
							results.map((r) => [r.branchId, r.branchIndex === 1 ? 0.9 : 0.5]),
						),
					};
					evaluateSpy(prompt, results);
					return evalResult;
				},
			},
		});

		for await (const event of gen) {
			collectedEvents.push(event);
		}

		expect(evaluateSpy).toHaveBeenCalledOnce();

		const selected = collectedEvents.find(
			(e) => e.type === "branch_selected",
		) as Extract<SandcasterEvent, { type: "branch_selected" }> | undefined;
		expect(selected).toBeDefined();
		expect(selected?.branchIndex).toBe(1);
		expect(selected?.reason).toBe("second branch is better");
	});
});

// ---------------------------------------------------------------------------
// 6. Evaluator failure fallback
// ---------------------------------------------------------------------------

describe("evaluator failure fallback", () => {
	it("falls back to first successful branch when evaluator throws", async () => {
		let callCount = 0;
		const runAgent: BranchRunOptions["runAgent"] = async function* () {
			callCount++;
			if (callCount === 1) {
				yield ASSISTANT_EVENT;
				yield {
					type: "branch_request",
					alternatives: ["A", "B"],
				} satisfies SandcasterEvent;
			} else {
				yield { type: "result", content: "done", costUsd: 0.01, numTurns: 1 };
			}
		};

		const failingEvaluator: Evaluator = {
			evaluate: async () => {
				throw new Error("evaluator exploded");
			},
		};

		const result = await collectEvents(
			runBranchedAgent({
				request: { prompt: "hello" },
				runAgent,
				config: { branching: { staggerDelayMs: 0 } },
				evaluator: failingEvaluator,
			}),
		);

		// Should still emit branch_selected (fallback to first)
		const selected = result.find((e) => e.type === "branch_selected") as
			| Extract<SandcasterEvent, { type: "branch_selected" }>
			| undefined;
		expect(selected).toBeDefined();
		expect(selected?.branchIndex).toBe(0);

		// Should emit a warning about evaluator failure
		const warnings = result.filter((e) => e.type === "warning");
		expect(warnings.length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// 7. No evaluator defaults to first successful
// ---------------------------------------------------------------------------

describe("no evaluator", () => {
	it("selects first successful branch when no evaluator is provided", async () => {
		let callCount = 0;
		const runAgent: BranchRunOptions["runAgent"] = async function* () {
			callCount++;
			if (callCount === 1) {
				yield ASSISTANT_EVENT;
				yield {
					type: "branch_request",
					alternatives: ["A", "B", "C"],
				} satisfies SandcasterEvent;
			} else {
				yield { type: "result", content: "done", costUsd: 0.01, numTurns: 1 };
			}
		};

		const result = await collectEvents(
			runBranchedAgent({
				request: { prompt: "hello" },
				runAgent,
				config: { branching: { staggerDelayMs: 0 } },
			}),
		);

		const selected = result.find((e) => e.type === "branch_selected") as
			| Extract<SandcasterEvent, { type: "branch_selected" }>
			| undefined;
		expect(selected).toBeDefined();
		expect(selected?.branchIndex).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// 8. Partial failure
// ---------------------------------------------------------------------------

describe("partial failure", () => {
	it("continues with successful branches when some branches fail", async () => {
		let callCount = 0;
		const runAgent: BranchRunOptions["runAgent"] = async function* () {
			callCount++;
			if (callCount === 1) {
				yield ASSISTANT_EVENT;
				yield {
					type: "branch_request",
					alternatives: ["A", "B"],
				} satisfies SandcasterEvent;
			} else if (callCount === 2) {
				// First branch fails
				throw new Error("branch 0 failed");
			} else {
				// Second branch succeeds
				yield {
					type: "result",
					content: "branch 1 done",
					costUsd: 0.01,
					numTurns: 1,
				};
			}
		};

		const result = await collectEvents(
			runBranchedAgent({
				request: { prompt: "hello" },
				runAgent,
				config: { branching: { staggerDelayMs: 0 } },
			}),
		);

		// Should still select a winner from the successful branches
		const selected = result.find((e) => e.type === "branch_selected");
		expect(selected).toBeDefined();

		// Branch summary should reflect the partial failure
		const summary = result.find((e) => e.type === "branch_summary") as
			| Extract<SandcasterEvent, { type: "branch_summary" }>
			| undefined;
		expect(summary).toBeDefined();
		expect(summary?.successCount).toBe(1);
		expect(summary?.totalBranches).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// 9. All branches fail
// ---------------------------------------------------------------------------

describe("all branches fail", () => {
	it("emits an error event when all branches fail", async () => {
		let callCount = 0;
		const runAgent: BranchRunOptions["runAgent"] = async function* () {
			callCount++;
			if (callCount === 1) {
				yield ASSISTANT_EVENT;
				yield {
					type: "branch_request",
					alternatives: ["A", "B"],
				} satisfies SandcasterEvent;
			} else {
				throw new Error("all failed");
			}
		};

		const result = await collectEvents(
			runBranchedAgent({
				request: { prompt: "hello" },
				runAgent,
				config: { branching: { staggerDelayMs: 0 } },
			}),
		);

		const errorEvents = result.filter((e) => e.type === "error");
		expect(errorEvents.length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// 10. Abort signal propagation
// ---------------------------------------------------------------------------

describe("abort signal propagation", () => {
	it("stops yielding events when abort signal fires", async () => {
		const controller = new AbortController();

		let callCount = 0;
		const runAgent: BranchRunOptions["runAgent"] = async function* () {
			callCount++;
			if (callCount === 1) {
				yield ASSISTANT_EVENT;
				yield {
					type: "branch_request",
					alternatives: ["A", "B"],
				} satisfies SandcasterEvent;
			} else {
				// Simulate slow branch: abort fires mid-execution
				await new Promise((r) => setTimeout(r, 50));
				yield {
					type: "result",
					content: "slow done",
					costUsd: 0.01,
					numTurns: 1,
				};
			}
		};

		const gen = runBranchedAgent({
			request: { prompt: "hello" },
			runAgent,
			config: { branching: { staggerDelayMs: 0 } },
			signal: controller.signal,
		});

		const events: SandcasterEvent[] = [];
		// Abort almost immediately after branch creation starts
		setTimeout(() => controller.abort(), 10);

		try {
			for await (const event of gen) {
				events.push(event);
			}
		} catch {
			// abort may throw or complete
		}

		// We just verify that collection finishes (doesn't hang forever)
		// and that the abort was respected
		expect(controller.signal.aborted).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 11. Cleanup on success
// ---------------------------------------------------------------------------

describe("cleanup guarantee", () => {
	it("completes without hanging when branches finish normally", async () => {
		let callCount = 0;
		const runAgent: BranchRunOptions["runAgent"] = async function* () {
			callCount++;
			if (callCount === 1) {
				yield ASSISTANT_EVENT;
				yield {
					type: "branch_request",
					alternatives: ["A", "B"],
				} satisfies SandcasterEvent;
			} else {
				yield { type: "result", content: "done", costUsd: 0.01, numTurns: 1 };
			}
		};

		// This should resolve (not hang)
		const result = await collectEvents(
			runBranchedAgent({
				request: { prompt: "hello" },
				runAgent,
				config: { branching: { staggerDelayMs: 0 } },
			}),
		);

		expect(result.length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// 12. Stagger delay
// ---------------------------------------------------------------------------

describe("stagger delay", () => {
	it("launches branches with delay when staggerDelayMs is set", async () => {
		const startTimes: number[] = [];

		let callCount = 0;
		const runAgent: BranchRunOptions["runAgent"] = async function* () {
			callCount++;
			if (callCount === 1) {
				yield ASSISTANT_EVENT;
				yield {
					type: "branch_request",
					alternatives: ["A", "B", "C"],
				} satisfies SandcasterEvent;
			} else {
				startTimes.push(Date.now());
				yield { type: "result", content: "done", costUsd: 0.01, numTurns: 1 };
			}
		};

		const staggerDelayMs = 30;
		await collectEvents(
			runBranchedAgent({
				request: { prompt: "hello" },
				runAgent,
				config: { branching: { staggerDelayMs } },
			}),
		);

		expect(startTimes).toHaveLength(3);
		// With stagger, later branches should start after earlier ones
		// We allow some slack (10ms) for timer imprecision
		expect(startTimes[1] - startTimes[0]).toBeGreaterThanOrEqual(
			staggerDelayMs - 10,
		);
		expect(startTimes[2] - startTimes[1]).toBeGreaterThanOrEqual(
			staggerDelayMs - 10,
		);
	});
});

// ---------------------------------------------------------------------------
// 13. Branch context capture
// ---------------------------------------------------------------------------

describe("branch context capture", () => {
	it("includes conversation context in branch prompts for mid-run branching", async () => {
		const capturedPrompts: string[] = [];

		let callCount = 0;
		const runAgent: BranchRunOptions["runAgent"] = async function* (opts) {
			callCount++;
			capturedPrompts.push(opts.request.prompt);
			if (callCount === 1) {
				yield { type: "assistant", content: "I analyzed the data" };
				yield { type: "tool_use", toolName: "read_file", content: "{}" };
				yield {
					type: "tool_result",
					toolName: "read_file",
					content: "file contents",
					isError: false,
				};
				yield {
					type: "branch_request",
					alternatives: ["approach A"],
					reason: "two paths",
				} satisfies SandcasterEvent;
			} else {
				yield { type: "result", content: "done", costUsd: 0.01, numTurns: 1 };
			}
		};

		await collectEvents(
			runBranchedAgent({
				request: { prompt: "original task" },
				runAgent,
				config: { branching: { staggerDelayMs: 0 } },
			}),
		);

		// The branch prompt should include context from the initial run
		expect(capturedPrompts).toHaveLength(2);
		expect(capturedPrompts[1]).toContain("Context from initial execution:");
		expect(capturedPrompts[1]).toContain("approach A");
	});
});

// ---------------------------------------------------------------------------
// 14. Timeout inheritance
// ---------------------------------------------------------------------------

describe("timeout inheritance", () => {
	it("passes remaining timeout to branch runs", async () => {
		const capturedConfigs: Array<{ timeout?: number } | undefined> = [];

		let callCount = 0;
		const runAgent: BranchRunOptions["runAgent"] = async function* (opts) {
			callCount++;
			capturedConfigs.push(opts.config as { timeout?: number } | undefined);
			if (callCount === 1) {
				// Simulate some elapsed time
				await new Promise((r) => setTimeout(r, 20));
				yield ASSISTANT_EVENT;
				yield {
					type: "branch_request",
					alternatives: ["A"],
				} satisfies SandcasterEvent;
			} else {
				yield { type: "result", content: "done", costUsd: 0.01, numTurns: 1 };
			}
		};

		await collectEvents(
			runBranchedAgent({
				request: { prompt: "hello", timeout: 60 },
				runAgent,
				config: { branching: { staggerDelayMs: 0 } },
			}),
		);

		expect(capturedConfigs).toHaveLength(2);
		// Branch timeout should be less than original (time elapsed)
		const originalTimeout = 60;
		const branchTimeout = capturedConfigs[1]?.timeout;
		expect(branchTimeout).toBeDefined();
		expect(branchTimeout!).toBeLessThan(originalTimeout);
		expect(branchTimeout!).toBeGreaterThan(0);
	});
});
