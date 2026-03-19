import { Box, Text } from "ink";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BranchProgressProps {
	branches: Array<{
		branchId: string;
		branchIndex: number;
		totalBranches: number;
		status: "running" | "completed" | "error";
		numTurns?: number;
		costUsd?: number;
		prompt: string;
	}>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BAR_WIDTH = 10;

function progressBar(numTurns: number | undefined): string {
	const turns = numTurns ?? 0;
	// Scale: 10 turns = full bar
	const filled = Math.min(turns, BAR_WIDTH);
	const empty = BAR_WIDTH - filled;
	return "█".repeat(filled) + "░".repeat(empty);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BranchProgress({
	branches,
}: BranchProgressProps): React.ReactElement {
	return (
		<Box flexDirection="column">
			{branches.map((branch) => (
				<BranchLine key={branch.branchId} branch={branch} />
			))}
		</Box>
	);
}

function BranchLine({
	branch,
}: {
	branch: BranchProgressProps["branches"][number];
}): React.ReactElement {
	const icon =
		branch.status === "running"
			? "⟳"
			: branch.status === "completed"
				? "✓"
				: "✗";

	const label = `Branch ${branch.branchIndex + 1}/${branch.totalBranches}`;

	const color =
		branch.status === "completed"
			? "green"
			: branch.status === "error"
				? "red"
				: "yellow";

	if (branch.status === "error") {
		return (
			<Text color={color}>
				{icon} {label}
				{"  (error)"}
			</Text>
		);
	}

	const bar = progressBar(branch.numTurns);
	const parts: string[] = [`${icon} ${label}`, bar];

	if (branch.numTurns !== undefined) {
		parts.push(`${branch.numTurns} turns`);
	}
	if (branch.costUsd !== undefined) {
		parts.push(`$${branch.costUsd}`);
	}

	return <Text color={color}>{parts.join("  ")}</Text>;
}
