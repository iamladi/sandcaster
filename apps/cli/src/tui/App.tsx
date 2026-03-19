import type { SandcasterEvent } from "@sandcaster/core";
import { Box, Static, useApp } from "ink";
import { useEffect, useReducer } from "react";
import { initialAgentState, reduceAgentState } from "../hooks/useAgent.js";
import { initialBranchState, reduceBranchState } from "../hooks/useBranch.js";
import { AgentStream } from "./AgentStream.js";
import { BranchProgress } from "./BranchProgress.js";
import { BranchSummary } from "./BranchSummary.js";
import { StatusBar } from "./StatusBar.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AppProps {
	eventSource: AsyncIterable<SandcasterEvent>;
	onExit?: (code: number) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function App({ eventSource, onExit }: AppProps): React.ReactElement {
	const { exit } = useApp();
	const [agentState, dispatchAgent] = useReducer(
		reduceAgentState,
		initialAgentState,
	);
	const [branchState, dispatchBranch] = useReducer(
		reduceBranchState,
		initialBranchState,
	);

	// Single consumer: dispatch each event to both reducers
	useEffect(() => {
		if (!eventSource) return;

		let cancelled = false;

		async function consume() {
			try {
				for await (const event of eventSource as AsyncIterable<SandcasterEvent>) {
					if (cancelled) break;
					dispatchAgent(event);
					dispatchBranch(event);
				}
			} catch (err) {
				if (!cancelled) {
					dispatchAgent({
						type: "error",
						content: err instanceof Error ? err.message : "Stream error",
					});
				}
			}
		}

		consume();

		return () => {
			cancelled = true;
		};
	}, [eventSource]);

	useEffect(() => {
		if (agentState.status === "completed" || agentState.status === "error") {
			const code = agentState.status === "completed" ? 0 : 1;
			onExit?.(code);
			exit();
		}
	}, [agentState.status, onExit, exit]);

	const statusBarProps = {
		status: agentState.status,
		model: agentState.result?.model,
		numTurns: agentState.result?.numTurns,
		costUsd: agentState.result?.costUsd,
		durationSecs: agentState.result?.durationSecs,
		branchCount:
			branchState.status !== "idle" ? branchState.branches.size : undefined,
		totalBranchCostUsd: branchState.summary?.totalCostUsd,
	};

	// Build branch progress list (for active branching)
	const branchProgressList =
		branchState.status === "branching"
			? Array.from(branchState.branches.values())
			: [];

	// Build branch summary data (for completed branching)
	const showBranchSummary = branchState.status === "completed";

	return (
		<Box flexDirection="column">
			<Static items={agentState.completedTurns}>
				{(turn, index) => <AgentStream key={index} events={turn} />}
			</Static>
			<AgentStream
				events={agentState.currentTurn}
				assistantText={agentState.assistantText}
			/>
			{branchProgressList.length > 0 && (
				<BranchProgress branches={branchProgressList} />
			)}
			{showBranchSummary && branchState.summary && (
				<BranchSummary
					winner={branchState.winner}
					branches={Array.from(branchState.branches.values()).map((b) => ({
						branchId: b.branchId,
						branchIndex: b.branchIndex,
						status: b.status === "error" ? "error" : "success",
						numTurns: b.numTurns,
						costUsd: b.costUsd,
					}))}
					totalCostUsd={branchState.summary.totalCostUsd}
					evaluator={branchState.summary.evaluator}
				/>
			)}
			<StatusBar {...statusBarProps} />
		</Box>
	);
}
