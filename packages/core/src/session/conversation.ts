import type { ConversationTurn, LlmSummarizer } from "./types.js";

const DEFAULT_MAX_TURNS = 50;

/**
 * Append a turn to history. If length exceeds maxTurns, trim oldest turns
 * while respecting tool call atomicity (never split a tool_use/tool_result pair).
 * Mutates history in place and returns it for chaining.
 */
export function addTurn(
	history: ConversationTurn[],
	turn: ConversationTurn,
	maxTurns: number = DEFAULT_MAX_TURNS,
): ConversationTurn[] {
	history.push(turn);

	while (history.length > maxTurns) {
		const first = history[0];
		const second = history[1];
		// A valid tool call pair is `assistant` (tool_use) followed by `user`
		// (tool_result). Two consecutive isToolCall turns with the wrong roles
		// (e.g. two orphaned assistant tool_use entries left by an abort) must
		// not be removed together — that would consume an unrelated entry and
		// orphan its partner.
		if (
			first?.isToolCall &&
			second?.isToolCall &&
			first.role === "assistant" &&
			second.role === "user"
		) {
			history.splice(0, 2);
		} else {
			history.splice(0, 1);
		}
	}

	return history;
}

/**
 * Compact history via LLM summarization.
 * On success: replaces history contents with a single summary turn.
 * On failure: leaves history unchanged and returns the error.
 */
export async function compactHistory(
	history: ConversationTurn[],
	summarizer: LlmSummarizer,
	model?: string,
): Promise<
	{ ok: true; history: ConversationTurn[] } | { ok: false; error: string }
> {
	try {
		const summary = await summarizer(history, model);
		history.splice(0, history.length, { role: "assistant", content: summary });
		return { ok: true, history };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: message };
	}
}

/**
 * Clear all history. Returns a fresh empty array.
 */
export function clearHistory(): ConversationTurn[] {
	return [];
}

/**
 * Format history for injection into agent config.
 * If conversationSummary is provided, prepends it as a summary block.
 * Returns empty string when there is no content to show.
 */
export function buildAgentContext(
	history: ConversationTurn[],
	conversationSummary?: string,
): string {
	const hasHistory = history.length > 0;
	const hasSummary = Boolean(conversationSummary);

	if (!hasHistory && !hasSummary) {
		return "";
	}

	const formatTurns = (turns: ConversationTurn[]): string =>
		turns
			.map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`)
			.join("\n");

	if (hasSummary) {
		const parts: string[] = [`[Conversation summary]\n${conversationSummary}`];
		if (hasHistory) {
			parts.push(`[Recent conversation]\n${formatTurns(history)}`);
		}
		return parts.join("\n\n");
	}

	return `[Previous conversation]\n${formatTurns(history)}`;
}
