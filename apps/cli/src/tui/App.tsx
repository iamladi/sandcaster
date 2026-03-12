import type { SandcasterEvent } from "@sandcaster/core";
import { Box, Static, useApp } from "ink";
import { useEffect } from "react";
import { useAgent } from "../hooks/useAgent.js";
import { AgentStream } from "./AgentStream.js";
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
	const state = useAgent(eventSource);

	useEffect(() => {
		if (state.status === "completed" || state.status === "error") {
			const code = state.status === "completed" ? 0 : 1;
			onExit?.(code);
			exit();
		}
	}, [state.status, onExit, exit]);

	const statusBarProps = {
		status: state.status,
		model: state.result?.model,
		numTurns: state.result?.numTurns,
		costUsd: state.result?.costUsd,
		durationSecs: state.result?.durationSecs,
	};

	return (
		<Box flexDirection="column">
			<Static items={state.completedTurns}>
				{(turn, index) => <AgentStream key={index} events={turn} />}
			</Static>
			<AgentStream
				events={state.currentTurn}
				assistantText={state.assistantText}
			/>
			<StatusBar {...statusBarProps} />
		</Box>
	);
}
