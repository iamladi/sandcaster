import type { SandcasterEvent, SessionCommand } from "../schemas.js";
import { compactHistory } from "./conversation.js";
import type { ActiveSession, LlmSummarizer } from "./types.js";

const VALID_COMMANDS = ["status", "files", "clear", "compact"] as const;

/**
 * Parse a slash-command from a prompt string.
 * Returns the command object or null if not a valid command.
 */
export function parseSessionCommand(prompt: string): SessionCommand | null {
	if (!prompt.startsWith("/")) return null;

	// Extract the command token (everything between the slash and the first space)
	const rest = prompt.slice(1);
	const spaceIndex = rest.indexOf(" ");
	const token = spaceIndex === -1 ? rest : rest.slice(0, spaceIndex);

	if (token === "") return null;

	for (const cmd of VALID_COMMANDS) {
		if (token === cmd) {
			return { type: cmd };
		}
	}

	return null;
}

/**
 * Execute a session command and yield result events.
 */
export async function* executeCommand(
	session: ActiveSession,
	command: SessionCommand,
	deps?: { summarizer?: LlmSummarizer },
): AsyncGenerator<SandcasterEvent> {
	switch (command.type) {
		case "status": {
			yield {
				type: "session_command_result",
				command: "status",
				content: `Session ${session.session.id} | Status: ${session.session.status} | Turns: ${session.session.totalTurns} | Cost: $${session.session.totalCostUsd.toFixed(4)}`,
				data: {
					id: session.session.id,
					status: session.session.status,
					totalTurns: session.session.totalTurns,
					totalCostUsd: session.session.totalCostUsd,
					historyLength: session.history.length,
					createdAt: session.session.createdAt,
					lastActivityAt: session.session.lastActivityAt,
				},
			};
			break;
		}

		case "files": {
			if (!session.instance) {
				yield {
					type: "error",
					content: "No sandbox instance available for /files",
				};
				break;
			}
			const cmd = `find ${session.instance.workDir} -type f -maxdepth 5 | head -200`;
			const result = await session.instance.commands.run(cmd);
			const files = result.stdout.trim().split("\n").filter(Boolean);
			const truncated = files.length >= 200;
			yield {
				type: "session_command_result",
				command: "files",
				content: truncated
					? `${files.length}+ files (truncated):\n${files.join("\n")}`
					: `${files.length} files:\n${files.join("\n")}`,
				data: { files, truncated },
			};
			break;
		}

		case "clear": {
			session.history.splice(0, session.history.length);
			session.conversationSummary = undefined;
			yield {
				type: "session_command_result",
				command: "clear",
				content: "Conversation history cleared",
			};
			break;
		}

		case "compact": {
			if (!deps?.summarizer) {
				yield {
					type: "error",
					content: "No summarizer configured for /compact",
				};
				return;
			}
			if (session.history.length === 0) {
				yield {
					type: "session_command_result",
					command: "compact",
					content: "Nothing to compact — history is empty",
				};
				return;
			}
			const compactResult = await compactHistory(
				session.history,
				deps.summarizer,
			);
			if (compactResult.ok) {
				session.conversationSummary = compactResult.history[0].content;
				yield {
					type: "session_command_result",
					command: "compact",
					content: `History compacted to summary (${session.conversationSummary.length} chars)`,
				};
			} else {
				yield {
					type: "error",
					content: `Compact failed: ${compactResult.error}`,
				};
			}
			break;
		}
	}
}
