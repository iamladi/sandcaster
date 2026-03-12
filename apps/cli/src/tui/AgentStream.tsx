import type { SandcasterEvent } from "@sandcaster/core";
import { Text } from "ink";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentStreamProps {
	events: SandcasterEvent[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AgentStream({ events }: AgentStreamProps): React.ReactElement {
	return (
		<>
			{events.map((event, index) => (
				<EventLine key={index} event={event} />
			))}
		</>
	);
}

function EventLine({ event }: { event: SandcasterEvent }): React.ReactElement {
	switch (event.type) {
		case "assistant":
			return <Text>{event.content}</Text>;

		case "tool_use":
			return <Text dimColor>{`[tool: ${event.toolName}]`}</Text>;

		case "tool_result": {
			const content =
				event.content.length > 200
					? event.content.slice(0, 200)
					: event.content;
			return <Text dimColor>{content}</Text>;
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
			return <Text color="red">{event.content}</Text>;

		case "result":
			return <Text>{event.content}</Text>;

		default: {
			const _exhaustive: never = event;
			return <Text>{String(_exhaustive)}</Text>;
		}
	}
}
