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
