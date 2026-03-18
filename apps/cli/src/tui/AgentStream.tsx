import type { SandcasterEvent } from "@sandcaster/core";
import { Box, Text } from "ink";
import { useMemo } from "react";
import { MarkdownText } from "./MarkdownText.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentStreamProps {
	events: SandcasterEvent[];
	assistantText?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AgentStream({
	events,
	assistantText,
}: AgentStreamProps): React.ReactElement {
	const { assistantContent, isStreaming, nonAssistantEvents } = useMemo(() => {
		let content = assistantText ?? "";
		const streaming = !!assistantText;

		if (!streaming) {
			// For completed turns: extract from complete event
			const completeEvent = events.find(
				(e) => e.type === "assistant" && e.subtype === "complete",
			);
			if (completeEvent && completeEvent.type === "assistant") {
				content = completeEvent.content;
			}
		}

		const other = events.filter((e) => e.type !== "assistant");
		return {
			assistantContent: content,
			isStreaming: streaming,
			nonAssistantEvents: other,
		};
	}, [events, assistantText]);

	return (
		<Box flexDirection="column">
			{nonAssistantEvents.map((event, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: events are append-only from stream
				<EventLine key={index} event={event} />
			))}
			{assistantContent && (
				<MarkdownText content={assistantContent} streaming={isStreaming} />
			)}
		</Box>
	);
}

function EventLine({ event }: { event: SandcasterEvent }): React.ReactElement {
	switch (event.type) {
		case "assistant":
			return <Text>{event.content}</Text>;

		case "tool_use":
			return (
				<Text dimColor>
					{event.sandbox ? `[${event.sandbox}] ` : ""}[tool: {event.toolName}]
				</Text>
			);

		case "tool_result": {
			const content =
				event.content.length > 200
					? event.content.slice(0, 200)
					: event.content;
			return (
				<Text dimColor>
					{event.sandbox ? `[${event.sandbox}] ` : ""}
					{content}
				</Text>
			);
		}

		case "thinking":
			return (
				<Text dimColor italic>
					[thinking...]
				</Text>
			);

		case "file":
			return <Text>{`[file: ${event.path}]`}</Text>;

		case "warning":
			return <Text color="yellow">{event.content}</Text>;

		case "system":
		case "stderr":
			return <Text dimColor>{event.content}</Text>;

		case "error":
			return (
				<Box flexDirection="column">
					<Text color="red">{event.content}</Text>
					{event.hint && (
						<Text dimColor color="yellow">
							{event.hint}
						</Text>
					)}
				</Box>
			);

		case "result":
			return <Text>{event.content}</Text>;

		case "session_created":
		case "session_expired":
		case "session_command_result":
			return <Text dimColor>{event.content}</Text>;

		default: {
			const _exhaustive: never = event;
			return <Text>{String(_exhaustive)}</Text>;
		}
	}
}
