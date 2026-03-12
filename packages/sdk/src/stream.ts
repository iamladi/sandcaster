import { EventSourceParserStream } from "eventsource-parser/stream";
import type { SandcasterEvent, SandcasterEventType } from "./types.js";

// ---------------------------------------------------------------------------
// Known event types for validation
// ---------------------------------------------------------------------------

const KNOWN_EVENT_TYPES = new Set<SandcasterEventType>([
	"system",
	"assistant",
	"tool_use",
	"tool_result",
	"thinking",
	"file",
	"result",
	"stderr",
	"warning",
	"error",
]);

function isKnownEventType(type: unknown): type is SandcasterEventType {
	return (
		typeof type === "string" &&
		KNOWN_EVENT_TYPES.has(type as SandcasterEventType)
	);
}

// ---------------------------------------------------------------------------
// parseSSEStream
// ---------------------------------------------------------------------------

export async function* parseSSEStream(
	body: ReadableStream<Uint8Array>,
	signal?: AbortSignal,
): AsyncGenerator<SandcasterEvent> {
	const reader = body
		.pipeThrough(new TextDecoderStream() as TransformStream<Uint8Array, string>)
		.pipeThrough(new EventSourceParserStream())
		.getReader();

	try {
		while (true) {
			if (signal?.aborted) {
				break;
			}

			const { done, value } = await reader.read();

			if (done) {
				break;
			}

			if (signal?.aborted) {
				break;
			}

			let parsed: unknown;
			try {
				parsed = JSON.parse(value.data);
			} catch {
				// Skip messages with invalid JSON
				continue;
			}

			if (
				parsed !== null &&
				typeof parsed === "object" &&
				isKnownEventType((parsed as Record<string, unknown>).type)
			) {
				yield parsed as SandcasterEvent;
			}
		}
	} finally {
		reader.releaseLock();
	}
}
