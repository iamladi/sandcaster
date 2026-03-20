import type { SandcasterEvent } from "@sandcaster/core";

export async function* eventToTextStream(
	events: AsyncGenerator<SandcasterEvent>,
): AsyncIterable<string> {
	for await (const event of events) {
		if (event.type === "assistant" && event.subtype === "delta") {
			yield event.content;
		} else if (event.type === "error") {
			yield `\n\n⚠️ Error: ${event.content}`;
			return;
		} else if (event.type === "result") {
			return;
		}
		// all other event types are skipped
	}
}
