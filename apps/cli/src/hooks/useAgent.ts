import type { SandcasterEvent } from "@sandcaster/core";
import { useEffect, useReducer } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResultInfo {
	content: string;
	costUsd?: number;
	numTurns?: number;
	durationSecs?: number;
	model?: string;
}

export interface AgentState {
	status: "idle" | "running" | "completed" | "error";
	events: SandcasterEvent[];
	completedTurns: SandcasterEvent[][];
	currentTurn: SandcasterEvent[];
	result: ResultInfo | null;
	error: string | null;
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export const initialAgentState: AgentState = {
	status: "idle",
	events: [],
	completedTurns: [],
	currentTurn: [],
	result: null,
	error: null,
};

// ---------------------------------------------------------------------------
// Pure reducer
// ---------------------------------------------------------------------------

export function reduceAgentState(
	state: AgentState,
	event: SandcasterEvent,
): AgentState {
	// All events go into the events array
	const events = [...state.events, event];

	// Status transitions to running on first event (if still idle)
	const baseStatus = state.status === "idle" ? "running" : state.status;

	if (event.type === "result") {
		// Push remaining currentTurn (including this event) to completedTurns
		const turnWithResult = [...state.currentTurn, event];
		const completedTurns =
			turnWithResult.length > 0
				? [...state.completedTurns, turnWithResult]
				: state.completedTurns;

		const resultInfo: ResultInfo = { content: event.content };
		if (event.costUsd !== undefined) resultInfo.costUsd = event.costUsd;
		if (event.numTurns !== undefined) resultInfo.numTurns = event.numTurns;
		if (event.durationSecs !== undefined)
			resultInfo.durationSecs = event.durationSecs;
		if (event.model !== undefined) resultInfo.model = event.model;

		return {
			...state,
			status: "completed",
			events,
			completedTurns,
			currentTurn: [],
			result: resultInfo,
		};
	}

	if (event.type === "error") {
		return {
			...state,
			status: "error",
			events,
			currentTurn: [...state.currentTurn, event],
			error: event.content,
		};
	}

	if (event.type === "assistant" && event.subtype === "complete") {
		// Complete the current turn — include this event then flush
		const completedTurn = [...state.currentTurn, event];
		return {
			...state,
			status: baseStatus,
			events,
			completedTurns: [...state.completedTurns, completedTurn],
			currentTurn: [],
		};
	}

	// All other events accumulate in currentTurn
	return {
		...state,
		status: baseStatus,
		events,
		currentTurn: [...state.currentTurn, event],
	};
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAgent(
	eventSource: AsyncIterable<SandcasterEvent> | null,
): AgentState {
	const [state, dispatch] = useReducer(reduceAgentState, initialAgentState);

	useEffect(() => {
		if (!eventSource) return;

		let cancelled = false;

		async function consume() {
			try {
				for await (const event of eventSource as AsyncIterable<SandcasterEvent>) {
					if (cancelled) break;
					dispatch(event);
				}
			} catch {
				// Iteration aborted or failed — ignore
			}
		}

		consume();

		return () => {
			cancelled = true;
		};
	}, [eventSource]);

	return state;
}
