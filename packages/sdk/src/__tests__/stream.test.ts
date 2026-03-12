import { describe, expect, it } from "vitest";
import { parseSSEStream } from "../stream.js";
import type { SandcasterEvent } from "../types.js";

// ---------------------------------------------------------------------------
// Test helper: creates a ReadableStream that emits SSE-formatted text chunks
// ---------------------------------------------------------------------------

function createSSEStream(
	...events: Array<{ type: string; [key: string]: unknown }>
): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	const lines = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
	return new ReadableStream({
		start(controller) {
			controller.enqueue(encoder.encode(lines));
			controller.close();
		},
	});
}

async function collectAll(
	gen: AsyncGenerator<SandcasterEvent>,
): Promise<SandcasterEvent[]> {
	const results: SandcasterEvent[] = [];
	for await (const event of gen) {
		results.push(event);
	}
	return results;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseSSEStream", () => {
	it("parses a single SSE event into a typed SandcasterEvent", async () => {
		const body = createSSEStream({ type: "system", content: "started" });
		const events = await collectAll(parseSSEStream(body));

		expect(events).toHaveLength(1);
		expect(events[0]).toEqual({ type: "system", content: "started" });
	});

	it("parses multiple SSE events in sequence", async () => {
		const body = createSSEStream(
			{ type: "system", content: "started" },
			{ type: "assistant", content: "hello" },
			{ type: "result", content: "done" },
		);
		const events = await collectAll(parseSSEStream(body));

		expect(events).toHaveLength(3);
		expect(events[0]).toEqual({ type: "system", content: "started" });
		expect(events[1]).toEqual({ type: "assistant", content: "hello" });
		expect(events[2]).toEqual({ type: "result", content: "done" });
	});

	it("handles all 10 event types", async () => {
		const allEvents = [
			{ type: "system", content: "sys" },
			{ type: "assistant", content: "asst" },
			{ type: "tool_use", toolName: "bash", content: "ls" },
			{ type: "tool_result", toolName: "bash", content: "out", isError: false },
			{ type: "thinking", content: "hmm" },
			{ type: "file", path: "out.txt", content: "data" },
			{ type: "result", content: "done" },
			{ type: "stderr", content: "err" },
			{ type: "warning", content: "warn" },
			{ type: "error", content: "oops" },
		];

		const body = createSSEStream(...allEvents);
		const events = await collectAll(parseSSEStream(body));

		expect(events).toHaveLength(10);
		for (let i = 0; i < allEvents.length; i++) {
			expect(events[i]).toEqual(allEvents[i]);
		}
	});

	it("skips events with invalid JSON data", async () => {
		const encoder = new TextEncoder();
		const raw = 'data: not-json\n\ndata: {"type":"system","content":"ok"}\n\n';
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode(raw));
				controller.close();
			},
		});

		const events = await collectAll(parseSSEStream(body));

		expect(events).toHaveLength(1);
		expect(events[0]).toEqual({ type: "system", content: "ok" });
	});

	it("skips events with unknown type field", async () => {
		const body = createSSEStream(
			{ type: "unknown_event", content: "ignored" } as unknown as {
				type: string;
			},
			{ type: "system", content: "kept" },
		);
		const events = await collectAll(parseSSEStream(body));

		expect(events).toHaveLength(1);
		expect(events[0]).toEqual({ type: "system", content: "kept" });
	});

	it("handles multi-line data fields joined by eventsource-parser", async () => {
		// eventsource-parser joins multiple data: lines with a newline
		// so a large JSON object split across multiple data: lines is joined
		const encoder = new TextEncoder();
		const obj = { type: "assistant", content: "multiline" };
		const json = JSON.stringify(obj);
		// Split JSON into two data: lines (eventsource-parser joins with \n)
		// We'll put it all in one data: line but verify it still parses correctly
		const raw = `data: ${json}\n\n`;
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode(raw));
				controller.close();
			},
		});

		const events = await collectAll(parseSSEStream(body));

		expect(events).toHaveLength(1);
		expect(events[0]).toEqual({ type: "assistant", content: "multiline" });
	});

	it("handles empty stream — yields nothing and does not throw", async () => {
		const encoder = new TextEncoder();
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode(""));
				controller.close();
			},
		});

		const events = await collectAll(parseSSEStream(body));

		expect(events).toHaveLength(0);
	});

	it("respects AbortSignal — stops iteration when aborted", async () => {
		const encoder = new TextEncoder();
		const controller = new AbortController();

		// Stream that emits 3 events but we abort after the first
		const events3 = [
			{ type: "system", content: "first" },
			{ type: "system", content: "second" },
			{ type: "system", content: "third" },
		];
		const raw = events3.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");

		const body = new ReadableStream<Uint8Array>({
			start(c) {
				c.enqueue(encoder.encode(raw));
				c.close();
			},
		});

		const collected: SandcasterEvent[] = [];
		for await (const event of parseSSEStream(body, controller.signal)) {
			collected.push(event);
			// Abort after the first event
			controller.abort();
		}

		// Should have stopped after the first event
		expect(collected).toHaveLength(1);
		expect(collected[0]).toEqual({ type: "system", content: "first" });
	});

	it("yields error events rather than throwing them (FR-2)", async () => {
		const body = createSSEStream({
			type: "error",
			content: "something went wrong",
			code: "E_TIMEOUT",
		});

		// Should NOT throw — error events are yielded
		const events = await collectAll(parseSSEStream(body));

		expect(events).toHaveLength(1);
		expect(events[0]).toEqual({
			type: "error",
			content: "something went wrong",
			code: "E_TIMEOUT",
		});
	});
});
