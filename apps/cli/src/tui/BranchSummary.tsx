import { Box, Text } from "ink";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BranchSummaryProps {
	winner: {
		branchId: string;
		branchIndex: number;
		totalBranches: number;
		reason: string;
		scores?: Record<string, number>;
	} | null;
	branches: Array<{
		branchId: string;
		branchIndex: number;
		status: "success" | "error";
		numTurns?: number;
		costUsd?: number;
	}>;
	totalCostUsd: number;
	evaluator: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BranchSummary({
	winner,
	branches,
	totalCostUsd,
	evaluator,
}: BranchSummaryProps): React.ReactElement {
	const losers = winner
		? branches.filter((b) => b.branchId !== winner.branchId)
		: branches;

	const branchCount = branches.length;

	return (
		<Box flexDirection="column">
			{winner ? (
				<WinnerLine winner={winner} />
			) : (
				<Text color="yellow">No winner selected</Text>
			)}
			{losers.map((branch) => (
				<LoserLine key={branch.branchId} branch={branch} />
			))}
			<SummaryLine
				branchCount={branchCount}
				totalCostUsd={totalCostUsd}
				evaluator={evaluator}
			/>
		</Box>
	);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function WinnerLine({
	winner,
}: {
	winner: NonNullable<BranchSummaryProps["winner"]>;
}): React.ReactElement {
	const scoreText =
		winner.scores?.[winner.branchId] !== undefined
			? ` (score: ${winner.scores[winner.branchId]})`
			: "";

	return (
		<Text color="green">
			{"✓ Winner: "}
			{`Branch ${winner.branchIndex + 1}/${winner.totalBranches}${scoreText}`}
			{` — "${winner.reason}"`}
		</Text>
	);
}

function LoserLine({
	branch,
}: {
	branch: BranchSummaryProps["branches"][number];
}): React.ReactElement {
	const parts: string[] = [`Branch ${branch.branchIndex + 1}`];

	if (branch.numTurns !== undefined) {
		parts.push(`${branch.numTurns} turns`);
	}
	if (branch.costUsd !== undefined) {
		parts.push(`$${branch.costUsd}`);
	}

	return (
		<Text dimColor>
			{"  ○ "}
			{parts.join(" · ")}
		</Text>
	);
}

function SummaryLine({
	branchCount,
	totalCostUsd,
	evaluator,
}: {
	branchCount: number;
	totalCostUsd: number;
	evaluator: string;
}): React.ReactElement {
	return (
		<Text dimColor>
			{`  Summary: ${branchCount} branches · $${totalCostUsd} total · evaluator: ${evaluator}`}
		</Text>
	);
}
