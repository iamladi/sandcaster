import type { SandcasterEvent } from "@sandcaster/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BranchEntry {
	branchId: string;
	branchIndex: number;
	totalBranches: number;
	status: "running" | "completed" | "error";
	numTurns?: number;
	costUsd?: number;
	prompt: string;
}

export interface BranchState {
	status: "idle" | "branching" | "completed";
	branches: Map<string, BranchEntry>;
	winner: {
		branchId: string;
		branchIndex: number;
		totalBranches: number;
		reason: string;
		scores?: Record<string, number>;
	} | null;
	summary: {
		totalBranches: number;
		successCount: number;
		totalCostUsd: number;
		evaluator: string;
		winnerId?: string;
	} | null;
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export const initialBranchState: BranchState = {
	status: "idle",
	branches: new Map(),
	winner: null,
	summary: null,
};

// ---------------------------------------------------------------------------
// Pure reducer
// ---------------------------------------------------------------------------

export function reduceBranchState(
	state: BranchState,
	event: SandcasterEvent,
): BranchState {
	if (event.type === "branch_start") {
		const branches = new Map(state.branches);
		branches.set(event.branchId, {
			branchId: event.branchId,
			branchIndex: event.branchIndex,
			totalBranches: event.totalBranches,
			status: "running",
			prompt: event.prompt,
		});
		return { ...state, status: "branching", branches };
	}

	if (event.type === "branch_progress") {
		const existing = state.branches.get(event.branchId);
		if (!existing) return state;
		const branches = new Map(state.branches);
		branches.set(event.branchId, {
			...existing,
			status: event.status,
			...(event.numTurns !== undefined ? { numTurns: event.numTurns } : {}),
			...(event.costUsd !== undefined ? { costUsd: event.costUsd } : {}),
		});
		return { ...state, branches };
	}

	if (event.type === "branch_complete") {
		const existing = state.branches.get(event.branchId);
		if (!existing) return state;
		const branches = new Map(state.branches);
		const completedStatus: "completed" | "error" =
			event.status === "success" ? "completed" : "error";
		branches.set(event.branchId, {
			...existing,
			status: completedStatus,
			...(event.costUsd !== undefined ? { costUsd: event.costUsd } : {}),
			...(event.numTurns !== undefined ? { numTurns: event.numTurns } : {}),
		});
		return { ...state, branches };
	}

	if (event.type === "branch_selected") {
		// Look up totalBranches from existing branch data
		const existing = state.branches.get(event.branchId);
		const totalBranches = existing?.totalBranches ?? 0;
		const winner = {
			branchId: event.branchId,
			branchIndex: event.branchIndex,
			totalBranches,
			reason: event.reason,
			...(event.scores !== undefined ? { scores: event.scores } : {}),
		};
		return { ...state, winner };
	}

	if (event.type === "branch_summary") {
		const summary = {
			totalBranches: event.totalBranches,
			successCount: event.successCount,
			totalCostUsd: event.totalCostUsd,
			evaluator: event.evaluator,
			...(event.winnerId !== undefined ? { winnerId: event.winnerId } : {}),
		};
		return { ...state, status: "completed", summary };
	}

	return state;
}
