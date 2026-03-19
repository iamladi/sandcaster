import { Text } from "ink";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StatusBarProps {
	model?: string;
	numTurns?: number;
	costUsd?: number;
	durationSecs?: number;
	status: "idle" | "running" | "completed" | "error";
	branchCount?: number;
	totalBranchCostUsd?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StatusBar({
	model,
	numTurns,
	costUsd,
	durationSecs,
	status,
	branchCount,
	totalBranchCostUsd,
}: StatusBarProps): React.ReactElement {
	const parts: string[] = [];

	// Status indicator
	if (status === "running") {
		parts.push("⟳ Running");
	} else if (status === "completed") {
		parts.push("✓ Completed");
	} else if (status === "error") {
		parts.push("✗ Error");
	} else {
		parts.push("○ Idle");
	}

	// Optional stats
	if (model !== undefined) {
		parts.push(model);
	}
	if (numTurns !== undefined) {
		parts.push(`${numTurns} turns`);
	}
	if (costUsd !== undefined) {
		parts.push(`$${costUsd}`);
	}
	if (durationSecs !== undefined) {
		parts.push(`${durationSecs}s`);
	}

	// Branch stats (shown when branching is active)
	if (branchCount !== undefined) {
		parts.push(`${branchCount} branches`);
	}
	if (totalBranchCostUsd !== undefined) {
		parts.push(`$${totalBranchCostUsd} total`);
	}

	const text = parts.join(" · ");

	const color =
		status === "completed"
			? "green"
			: status === "error"
				? "red"
				: status === "running"
					? "yellow"
					: undefined;

	return (
		<Text color={color} dimColor={status === "idle"}>
			{text}
		</Text>
	);
}
