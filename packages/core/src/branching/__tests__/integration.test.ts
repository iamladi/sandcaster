import { describe, expect, it } from "vitest";
import type { SandcasterEvent } from "../../schemas.js";
import {
	type BranchRunOptions,
	runBranchedAgent,
} from "../branch-orchestrator.js";
import type { Evaluator } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/** Extract events of a given type */
function eventsOfType<T extends SandcasterEvent["type"]>(
	events: SandcasterEvent[],
	type: T,
): Extract<SandcasterEvent, { type: T }>[] {
	return events.filter((e) => e.type === type) as Extract<
		SandcasterEvent,
		{ type: T }
	>[];
}

// ---------------------------------------------------------------------------
// Shared fake agent factories
// ---------------------------------------------------------------------------

/** A runAgent that emits assistant + result events */
function _makeBranchAgent(
	content: string,
	costUsd = 0.01,
): BranchRunOptions["runAgent"] {
	return async function* () {
		yield { type: "assistant", content: `Working on: ${content}` };
		yield { type: "result", content, costUsd, numTurns: 2 };
	};
}

// ---------------------------------------------------------------------------
// 1. Explicit branch_request lifecycle
// ---------------------------------------------------------------------------

describe("explicit branching: full lifecycle", () => {
	it("initial run → branch_request → parallel branches → evaluation → winner", async () => {
		// Deterministic evaluator that always picks the second branch
		const evaluator: Evaluator = {
			evaluate: async (_prompt, results) => {
				const winner = results[1] ?? results[0];
				return {
					winnerId: winner.branchId,
					winnerIndex: winner.branchIndex,
					reasoning: "second branch chosen",
				};
			},
		};

		let callCount = 0;
		const runAgent: BranchRunOptions["runAgent"] = async function* (_opts) {
			callCount++;
			if (callCount === 1) {
				// Initial run: emits assistant content, then requests branching
				yield { type: "assistant", content: "I need to branch" };
				yield {
					type: "branch_request",
					alternatives: ["approach A", "approach B"],
					reason: "two viable paths",
				};
			} else {
				// Branch runs
				const label = callCount === 2 ? "A" : "B";
				yield {
					type: "assistant",
					content: `Branch ${label} output`,
				};
				yield {
					type: "result",
					content: `Branch ${label} result`,
					costUsd: 0.01,
					numTurns: 1,
				};
			}
		};

		const events = await collectEvents(
			runBranchedAgent({
				request: { prompt: "solve the problem" },
				runAgent,
				evaluator,
				config: { branching: { staggerDelayMs: 0 } },
			}),
		);

		// 1. Initial run assistant event is yielded before branching starts
		const assistantEvents = eventsOfType(events, "assistant");
		expect(assistantEvents[0].content).toBe("I need to branch");

		// 2. Two branch_start events emitted
		const starts = eventsOfType(events, "branch_start");
		expect(starts).toHaveLength(2);
		expect(starts[0].totalBranches).toBe(2);
		expect(starts[1].totalBranches).toBe(2);
		expect(starts[0].prompt).toBe("approach A");
		expect(starts[1].prompt).toBe("approach B");

		// 3. Two branch_complete events emitted
		const completes = eventsOfType(events, "branch_complete");
		expect(completes).toHaveLength(2);
		expect(completes.every((c) => c.status === "success")).toBe(true);

		// 4. branch_selected emitted with second branch as winner
		const selected = eventsOfType(events, "branch_selected");
		expect(selected).toHaveLength(1);
		expect(selected[0].branchIndex).toBe(1);
		expect(selected[0].reason).toBe("second branch chosen");

		// 5. branch_summary emitted as final event
		const summaries = eventsOfType(events, "branch_summary");
		expect(summaries).toHaveLength(1);
		expect(summaries[0].totalBranches).toBe(2);
		expect(summaries[0].successCount).toBe(2);
		expect(summaries[0].winnerId).toBeDefined();

		// 6. Event ordering: branch_start → branch_selected → branch_summary
		const types = events.map((e) => e.type);
		const firstStartIdx = types.indexOf("branch_start");
		const selectedIdx = types.indexOf("branch_selected");
		const summaryIdx = types.indexOf("branch_summary");
		expect(firstStartIdx).toBeGreaterThanOrEqual(0);
		expect(selectedIdx).toBeGreaterThan(firstStartIdx);
		expect(summaryIdx).toBeGreaterThan(selectedIdx);
	});

	it("winning branch events are replayed after branch_selected", async () => {
		const evaluator: Evaluator = {
			evaluate: async (_prompt, results) => ({
				winnerId: results[0].branchId,
				winnerIndex: results[0].branchIndex,
				reasoning: "first branch wins",
			}),
		};

		let callCount = 0;
		const runAgent: BranchRunOptions["runAgent"] = async function* () {
			callCount++;
			if (callCount === 1) {
				yield {
					type: "branch_request",
					alternatives: ["path X", "path Y"],
				};
			} else if (callCount === 2) {
				yield { type: "assistant", content: "Winner output" };
				yield {
					type: "result",
					content: "Winner result",
					costUsd: 0.01,
					numTurns: 1,
				};
			} else {
				yield {
					type: "result",
					content: "Loser result",
					costUsd: 0.01,
					numTurns: 1,
				};
			}
		};

		const events = await collectEvents(
			runBranchedAgent({
				request: { prompt: "hello" },
				runAgent,
				evaluator,
				config: { branching: { staggerDelayMs: 0 } },
			}),
		);

		// After branch_selected, winner's events should appear
		const types = events.map((e) => e.type);
		const selectedIdx = types.indexOf("branch_selected");
		const summaryIdx = types.indexOf("branch_summary");

		// Events between selected and summary include winning branch's events
		const betweenEvents = events.slice(selectedIdx + 1, summaryIdx);
		const assistantBetween = betweenEvents.filter(
			(e) => e.type === "assistant",
		);
		expect(assistantBetween.length).toBeGreaterThan(0);
		expect(
			(assistantBetween[0] as Extract<SandcasterEvent, { type: "assistant" }>)
				.content,
		).toBe("Winner output");
	});
});

// ---------------------------------------------------------------------------
// 2. Always-branch trigger
// ---------------------------------------------------------------------------

describe("always-branch: full lifecycle", () => {
	it("config enables always-branch → parallel branches immediately → winner", async () => {
		const callCount: number[] = [];

		const runAgent: BranchRunOptions["runAgent"] = async function* (opts) {
			callCount.push(1);
			yield { type: "assistant", content: `branch: ${opts.request.prompt}` };
			yield { type: "result", content: "done", costUsd: 0.02, numTurns: 1 };
		};

		const events = await collectEvents(
			runBranchedAgent({
				request: { prompt: "always branch task" },
				runAgent,
				config: {
					branching: {
						trigger: "always",
						count: 3,
						staggerDelayMs: 0,
					},
				},
			}),
		);

		// No initial run: all 3 calls are branch runs
		expect(callCount).toHaveLength(3);

		// 3 branch_start events
		const starts = eventsOfType(events, "branch_start");
		expect(starts).toHaveLength(3);
		expect(starts[0].totalBranches).toBe(3);

		// 3 branch_complete events, all success
		const completes = eventsOfType(events, "branch_complete");
		expect(completes).toHaveLength(3);
		expect(completes.every((c) => c.status === "success")).toBe(true);

		// 1 branch_selected
		const selected = eventsOfType(events, "branch_selected");
		expect(selected).toHaveLength(1);

		// 1 branch_summary
		const summaries = eventsOfType(events, "branch_summary");
		expect(summaries).toHaveLength(1);
		expect(summaries[0].totalBranches).toBe(3);
		expect(summaries[0].successCount).toBe(3);
	});

	it("all branches use the original prompt", async () => {
		const capturedPrompts: string[] = [];

		const runAgent: BranchRunOptions["runAgent"] = async function* (opts) {
			capturedPrompts.push(opts.request.prompt);
			yield { type: "result", content: "done", costUsd: 0.01, numTurns: 1 };
		};

		await collectEvents(
			runBranchedAgent({
				request: { prompt: "original task" },
				runAgent,
				config: {
					branching: {
						trigger: "always",
						count: 2,
						staggerDelayMs: 0,
					},
				},
			}),
		);

		expect(capturedPrompts).toHaveLength(2);
		for (const p of capturedPrompts) {
			expect(p).toContain("original task");
		}
	});

	it("branch_summary totalCostUsd is sum of all branch costs", async () => {
		const runAgent: BranchRunOptions["runAgent"] = async function* () {
			yield { type: "result", content: "done", costUsd: 0.05, numTurns: 1 };
		};

		const events = await collectEvents(
			runBranchedAgent({
				request: { prompt: "cost test" },
				runAgent,
				config: {
					branching: {
						trigger: "always",
						count: 3,
						staggerDelayMs: 0,
					},
				},
			}),
		);

		const summaries = eventsOfType(events, "branch_summary");
		expect(summaries[0].totalCostUsd).toBeCloseTo(0.15);
	});
});

// ---------------------------------------------------------------------------
// 3. Confidence-triggered branching
// ---------------------------------------------------------------------------

describe("confidence-triggered: full lifecycle", () => {
	it("confidence below threshold → auto-branch → winner", async () => {
		let callCount = 0;

		const runAgent: BranchRunOptions["runAgent"] = async function* () {
			callCount++;
			if (callCount === 1) {
				// Initial run emits a low-confidence report, then a result
				yield {
					type: "confidence_report",
					level: 0.2,
					reason: "uncertain about the approach",
				};
				yield {
					type: "result",
					content: "initial result",
					costUsd: 0.01,
					numTurns: 1,
				};
			} else {
				yield {
					type: "result",
					content: `branch ${callCount} result`,
					costUsd: 0.01,
					numTurns: 1,
				};
			}
		};

		const events = await collectEvents(
			runBranchedAgent({
				request: { prompt: "uncertain task" },
				runAgent,
				config: {
					branching: {
						trigger: "confidence",
						confidenceThreshold: 0.5,
						count: 2,
						staggerDelayMs: 0,
					},
				},
			}),
		);

		// confidence_report was yielded to consumer
		const reports = eventsOfType(events, "confidence_report");
		expect(reports).toHaveLength(1);
		expect(reports[0].level).toBe(0.2);

		// Branching triggered: 2 branch_start events
		const starts = eventsOfType(events, "branch_start");
		expect(starts).toHaveLength(2);

		// Winner selected
		const selected = eventsOfType(events, "branch_selected");
		expect(selected).toHaveLength(1);

		// Summary present
		const summaries = eventsOfType(events, "branch_summary");
		expect(summaries).toHaveLength(1);
		expect(summaries[0].totalBranches).toBe(2);
		expect(summaries[0].successCount).toBe(2);

		// Total call count: 1 initial + 2 branches = 3
		expect(callCount).toBe(3);
	});

	it("confidence above threshold → no branching, normal completion", async () => {
		let callCount = 0;

		const runAgent: BranchRunOptions["runAgent"] = async function* () {
			callCount++;
			yield {
				type: "confidence_report",
				level: 0.9,
				reason: "very confident",
			};
			yield { type: "result", content: "done", costUsd: 0.01, numTurns: 1 };
		};

		const events = await collectEvents(
			runBranchedAgent({
				request: { prompt: "confident task" },
				runAgent,
				config: {
					branching: {
						trigger: "confidence",
						confidenceThreshold: 0.5,
						staggerDelayMs: 0,
					},
				},
			}),
		);

		// No branching
		expect(eventsOfType(events, "branch_start")).toHaveLength(0);
		expect(eventsOfType(events, "branch_selected")).toHaveLength(0);
		expect(eventsOfType(events, "branch_summary")).toHaveLength(0);

		// Confidence report still yielded
		const reports = eventsOfType(events, "confidence_report");
		expect(reports).toHaveLength(1);

		// Only 1 call total
		expect(callCount).toBe(1);
	});

	it("branch prompts include the confidence reason", async () => {
		const capturedPrompts: string[] = [];
		let callCount = 0;

		const runAgent: BranchRunOptions["runAgent"] = async function* (opts) {
			callCount++;
			if (callCount === 1) {
				yield {
					type: "confidence_report",
					level: 0.1,
					reason: "ambiguous requirements",
				};
				yield {
					type: "result",
					content: "initial",
					costUsd: 0.01,
					numTurns: 1,
				};
			} else {
				capturedPrompts.push(opts.request.prompt);
				yield {
					type: "result",
					content: "branch done",
					costUsd: 0.01,
					numTurns: 1,
				};
			}
		};

		await collectEvents(
			runBranchedAgent({
				request: { prompt: "my task" },
				runAgent,
				config: {
					branching: {
						trigger: "confidence",
						confidenceThreshold: 0.5,
						count: 2,
						staggerDelayMs: 0,
					},
				},
			}),
		);

		expect(capturedPrompts).toHaveLength(2);
		for (const p of capturedPrompts) {
			expect(p).toContain("my task");
			expect(p).toContain("ambiguous requirements");
		}
	});
});

// ---------------------------------------------------------------------------
// 4. Event stream integrity
// ---------------------------------------------------------------------------

describe("event stream integrity", () => {
	it("branch_start events are in correct index order", async () => {
		let callCount = 0;

		const runAgent: BranchRunOptions["runAgent"] = async function* () {
			callCount++;
			if (callCount === 1) {
				yield {
					type: "branch_request",
					alternatives: ["A", "B", "C"],
				};
			} else {
				yield { type: "result", content: "done", costUsd: 0.01, numTurns: 1 };
			}
		};

		const events = await collectEvents(
			runBranchedAgent({
				request: { prompt: "hello" },
				runAgent,
				config: { branching: { staggerDelayMs: 0 } },
			}),
		);

		const starts = eventsOfType(events, "branch_start");
		expect(starts).toHaveLength(3);
		expect(starts[0].branchIndex).toBe(0);
		expect(starts[1].branchIndex).toBe(1);
		expect(starts[2].branchIndex).toBe(2);
	});

	it("all branch_start events precede branch_complete events in stream", async () => {
		let callCount = 0;

		const runAgent: BranchRunOptions["runAgent"] = async function* () {
			callCount++;
			if (callCount === 1) {
				yield {
					type: "branch_request",
					alternatives: ["A", "B"],
				};
			} else {
				yield { type: "result", content: "done", costUsd: 0.01, numTurns: 1 };
			}
		};

		const events = await collectEvents(
			runBranchedAgent({
				request: { prompt: "hello" },
				runAgent,
				config: { branching: { staggerDelayMs: 0 } },
			}),
		);

		const types = events.map((e) => e.type);
		const lastStartIdx = types.lastIndexOf("branch_start");
		const firstCompleteIdx = types.indexOf("branch_complete");

		// All branch_starts happen before branch_completes
		expect(lastStartIdx).toBeGreaterThanOrEqual(0);
		expect(firstCompleteIdx).toBeGreaterThan(lastStartIdx);
	});

	it("branch_summary is always the last event in a branched run", async () => {
		let callCount = 0;

		const runAgent: BranchRunOptions["runAgent"] = async function* () {
			callCount++;
			if (callCount === 1) {
				yield {
					type: "branch_request",
					alternatives: ["A", "B"],
				};
			} else {
				yield { type: "assistant", content: "working" };
				yield { type: "result", content: "done", costUsd: 0.01, numTurns: 1 };
			}
		};

		const events = await collectEvents(
			runBranchedAgent({
				request: { prompt: "hello" },
				runAgent,
				config: { branching: { staggerDelayMs: 0 } },
			}),
		);

		const lastEvent = events[events.length - 1];
		expect(lastEvent.type).toBe("branch_summary");
	});

	it("branch_summary contains correct winnerId matching branch_selected branchId", async () => {
		const evaluator: Evaluator = {
			evaluate: async (_prompt, results) => ({
				winnerId: results[0].branchId,
				winnerIndex: results[0].branchIndex,
				reasoning: "first wins",
			}),
		};

		let callCount = 0;

		const runAgent: BranchRunOptions["runAgent"] = async function* () {
			callCount++;
			if (callCount === 1) {
				yield {
					type: "branch_request",
					alternatives: ["A", "B"],
				};
			} else {
				yield { type: "result", content: "done", costUsd: 0.01, numTurns: 1 };
			}
		};

		const events = await collectEvents(
			runBranchedAgent({
				request: { prompt: "hello" },
				runAgent,
				evaluator,
				config: { branching: { staggerDelayMs: 0 } },
			}),
		);

		const selected = eventsOfType(events, "branch_selected")[0];
		const summary = eventsOfType(events, "branch_summary")[0];

		expect(selected).toBeDefined();
		expect(summary).toBeDefined();
		expect(summary.winnerId).toBe(selected.branchId);
	});

	it("no spurious branch events when no branching occurs", async () => {
		const runAgent: BranchRunOptions["runAgent"] = async function* () {
			yield { type: "assistant", content: "no branch needed" };
			yield { type: "result", content: "done", costUsd: 0.01, numTurns: 1 };
		};

		const events = await collectEvents(
			runBranchedAgent({
				request: { prompt: "simple task" },
				runAgent,
				config: { branching: { staggerDelayMs: 0 } },
			}),
		);

		expect(eventsOfType(events, "branch_start")).toHaveLength(0);
		expect(eventsOfType(events, "branch_complete")).toHaveLength(0);
		expect(eventsOfType(events, "branch_selected")).toHaveLength(0);
		expect(eventsOfType(events, "branch_summary")).toHaveLength(0);
	});
});
