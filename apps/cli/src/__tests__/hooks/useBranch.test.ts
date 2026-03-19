import type { SandcasterEvent } from "@sandcaster/core";
import { describe, expect, it } from "vitest";
import {
	type BranchState,
	initialBranchState,
	reduceBranchState,
} from "../../hooks/useBranch.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function applyEvents(events: SandcasterEvent[]): BranchState {
	let state = initialBranchState;
	for (const event of events) {
		state = reduceBranchState(state, event);
	}
	return state;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("reduceBranchState", () => {
	describe("initial state", () => {
		it("has idle status", () => {
			expect(initialBranchState.status).toBe("idle");
		});

		it("has empty branches map", () => {
			expect(initialBranchState.branches.size).toBe(0);
		});

		it("has null winner", () => {
			expect(initialBranchState.winner).toBeNull();
		});

		it("has null summary", () => {
			expect(initialBranchState.summary).toBeNull();
		});
	});

	describe("branch_start event", () => {
		it("adds branch to the map", () => {
			const state = applyEvents([
				{
					type: "branch_start",
					branchId: "b1",
					branchIndex: 0,
					totalBranches: 3,
					prompt: "try approach A",
				},
			]);
			expect(state.branches.has("b1")).toBe(true);
		});

		it("sets status to branching", () => {
			const state = applyEvents([
				{
					type: "branch_start",
					branchId: "b1",
					branchIndex: 0,
					totalBranches: 3,
					prompt: "try approach A",
				},
			]);
			expect(state.status).toBe("branching");
		});

		it("stores branch data correctly", () => {
			const state = applyEvents([
				{
					type: "branch_start",
					branchId: "b1",
					branchIndex: 0,
					totalBranches: 3,
					prompt: "try approach A",
				},
			]);
			const branch = state.branches.get("b1");
			expect(branch).toMatchObject({
				branchId: "b1",
				branchIndex: 0,
				totalBranches: 3,
				prompt: "try approach A",
				status: "running",
			});
		});

		it("stores multiple branches", () => {
			const state = applyEvents([
				{
					type: "branch_start",
					branchId: "b1",
					branchIndex: 0,
					totalBranches: 2,
					prompt: "approach A",
				},
				{
					type: "branch_start",
					branchId: "b2",
					branchIndex: 1,
					totalBranches: 2,
					prompt: "approach B",
				},
			]);
			expect(state.branches.size).toBe(2);
			expect(state.branches.has("b1")).toBe(true);
			expect(state.branches.has("b2")).toBe(true);
		});
	});

	describe("branch_progress event", () => {
		it("updates branch status", () => {
			const state = applyEvents([
				{
					type: "branch_start",
					branchId: "b1",
					branchIndex: 0,
					totalBranches: 2,
					prompt: "try A",
				},
				{
					type: "branch_progress",
					branchId: "b1",
					branchIndex: 0,
					status: "completed",
				},
			]);
			expect(state.branches.get("b1")?.status).toBe("completed");
		});

		it("updates numTurns on progress event", () => {
			const state = applyEvents([
				{
					type: "branch_start",
					branchId: "b1",
					branchIndex: 0,
					totalBranches: 1,
					prompt: "try A",
				},
				{
					type: "branch_progress",
					branchId: "b1",
					branchIndex: 0,
					status: "running",
					numTurns: 4,
				},
			]);
			expect(state.branches.get("b1")?.numTurns).toBe(4);
		});

		it("updates costUsd on progress event", () => {
			const state = applyEvents([
				{
					type: "branch_start",
					branchId: "b1",
					branchIndex: 0,
					totalBranches: 1,
					prompt: "try A",
				},
				{
					type: "branch_progress",
					branchId: "b1",
					branchIndex: 0,
					status: "running",
					costUsd: 0.02,
				},
			]);
			expect(state.branches.get("b1")?.costUsd).toBe(0.02);
		});
	});

	describe("branch_complete event", () => {
		it("updates branch status to completed on success", () => {
			const state = applyEvents([
				{
					type: "branch_start",
					branchId: "b1",
					branchIndex: 0,
					totalBranches: 1,
					prompt: "try A",
				},
				{
					type: "branch_complete",
					branchId: "b1",
					status: "success",
					costUsd: 0.05,
					numTurns: 3,
				},
			]);
			const branch = state.branches.get("b1");
			expect(branch?.status).toBe("completed");
			expect(branch?.costUsd).toBe(0.05);
			expect(branch?.numTurns).toBe(3);
		});

		it("updates branch status to error on failure", () => {
			const state = applyEvents([
				{
					type: "branch_start",
					branchId: "b1",
					branchIndex: 0,
					totalBranches: 1,
					prompt: "try A",
				},
				{
					type: "branch_complete",
					branchId: "b1",
					status: "error",
				},
			]);
			expect(state.branches.get("b1")?.status).toBe("error");
		});
	});

	describe("branch_selected event", () => {
		it("sets the winner", () => {
			const state = applyEvents([
				{
					type: "branch_start",
					branchId: "b1",
					branchIndex: 0,
					totalBranches: 2,
					prompt: "try A",
				},
				{
					type: "branch_start",
					branchId: "b2",
					branchIndex: 1,
					totalBranches: 2,
					prompt: "try B",
				},
				{
					type: "branch_selected",
					branchId: "b2",
					branchIndex: 1,
					reason: "better output quality",
				},
			]);
			expect(state.winner).toMatchObject({
				branchId: "b2",
				branchIndex: 1,
				reason: "better output quality",
			});
		});

		it("stores scores when provided", () => {
			const state = applyEvents([
				{
					type: "branch_start",
					branchId: "b1",
					branchIndex: 0,
					totalBranches: 1,
					prompt: "try A",
				},
				{
					type: "branch_selected",
					branchId: "b1",
					branchIndex: 0,
					reason: "highest score",
					scores: { b1: 0.92, b2: 0.71 },
				},
			]);
			expect(state.winner?.scores).toEqual({ b1: 0.92, b2: 0.71 });
		});

		it("includes totalBranches from existing branch data", () => {
			const state = applyEvents([
				{
					type: "branch_start",
					branchId: "b1",
					branchIndex: 0,
					totalBranches: 3,
					prompt: "try A",
				},
				{
					type: "branch_selected",
					branchId: "b1",
					branchIndex: 0,
					reason: "best",
				},
			]);
			expect(state.winner?.totalBranches).toBe(3);
		});
	});

	describe("branch_summary event", () => {
		it("sets summary data", () => {
			const state = applyEvents([
				{
					type: "branch_summary",
					totalBranches: 3,
					successCount: 2,
					totalCostUsd: 0.19,
					evaluator: "llm-judge",
					winnerId: "b2",
				},
			]);
			expect(state.summary).toMatchObject({
				totalBranches: 3,
				successCount: 2,
				totalCostUsd: 0.19,
				evaluator: "llm-judge",
				winnerId: "b2",
			});
		});

		it("transitions status to completed", () => {
			const state = applyEvents([
				{
					type: "branch_summary",
					totalBranches: 1,
					successCount: 1,
					totalCostUsd: 0.05,
					evaluator: "rule-based",
				},
			]);
			expect(state.status).toBe("completed");
		});
	});

	describe("unrelated events", () => {
		it("returns state unchanged for non-branch events", () => {
			const state = applyEvents([
				{ type: "system", content: "started" },
				{ type: "assistant", subtype: "delta", content: "hello" },
			]);
			expect(state.status).toBe("idle");
			expect(state.branches.size).toBe(0);
		});
	});
});
