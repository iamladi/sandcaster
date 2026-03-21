import type { SandcasterEvent } from "@sandcaster/core";
import { describe, expect, test } from "vitest";
import { eventToTextStream } from "../event-bridge.js";

async function* fromArray<T>(items: T[]): AsyncGenerator<T> {
	for (const item of items) yield item;
}

async function collect(iterable: AsyncIterable<string>): Promise<string[]> {
	const results: string[] = [];
	for await (const chunk of iterable) {
		results.push(chunk);
	}
	return results;
}

describe("eventToTextStream", () => {
	test("yields text from assistant delta events", async () => {
		const events: SandcasterEvent[] = [
			{ type: "assistant", subtype: "delta", content: "Hello" },
			{ type: "assistant", subtype: "delta", content: ", world" },
		];

		const chunks = await collect(eventToTextStream(fromArray(events)));

		expect(chunks).toEqual(["Hello", ", world"]);
	});

	test("stops on error event and yields error message", async () => {
		const events: SandcasterEvent[] = [
			{ type: "assistant", subtype: "delta", content: "partial" },
			{ type: "error", content: "Something went wrong" },
			{ type: "assistant", subtype: "delta", content: "never reached" },
		];

		const chunks = await collect(eventToTextStream(fromArray(events)));

		expect(chunks).toEqual(["partial", "\n\n⚠️ Error: Something went wrong"]);
	});

	test("stops on result event without yielding anything for it", async () => {
		const events: SandcasterEvent[] = [
			{ type: "assistant", subtype: "delta", content: "done" },
			{
				type: "result",
				content: "final",
				costUsd: 0.01,
				numTurns: 3,
				durationSecs: 5,
			},
			{ type: "assistant", subtype: "delta", content: "never reached" },
		];

		const chunks = await collect(eventToTextStream(fromArray(events)));

		expect(chunks).toEqual(["done"]);
	});

	test("skips non-assistant events (tool_use, thinking, file, system, etc.)", async () => {
		const events: SandcasterEvent[] = [
			{ type: "system", content: "system message" },
			{ type: "assistant", subtype: "delta", content: "hello" },
			{ type: "tool_use", toolName: "bash", content: "ls -la" },
			{ type: "assistant", subtype: "delta", content: " world" },
			{
				type: "tool_result",
				toolName: "bash",
				content: "file.txt",
				isError: false,
			},
			{ type: "thinking", subtype: "delta", content: "thinking..." },
			{ type: "file", path: "output.txt", content: "data" },
			{ type: "warning", content: "a warning" },
			{ type: "stderr", content: "error output" },
		];

		const chunks = await collect(eventToTextStream(fromArray(events)));

		expect(chunks).toEqual(["hello", " world"]);
	});

	test("handles empty stream", async () => {
		const chunks = await collect(eventToTextStream(fromArray([])));

		expect(chunks).toEqual([]);
	});

	test("handles multiple assistant deltas followed by result", async () => {
		const events: SandcasterEvent[] = [
			{ type: "assistant", subtype: "delta", content: "chunk1" },
			{ type: "assistant", subtype: "delta", content: "chunk2" },
			{ type: "assistant", subtype: "delta", content: "chunk3" },
			{ type: "result", content: "done", costUsd: 0.05 },
		];

		const chunks = await collect(eventToTextStream(fromArray(events)));

		expect(chunks).toEqual(["chunk1", "chunk2", "chunk3"]);
	});

	test("does not yield assistant complete events (only deltas are yielded)", async () => {
		const events: SandcasterEvent[] = [
			{ type: "assistant", subtype: "delta", content: "streamed" },
			{ type: "assistant", subtype: "complete", content: "full text" },
			{ type: "assistant", subtype: "delta", content: " more" },
		];

		const chunks = await collect(eventToTextStream(fromArray(events)));

		expect(chunks).toEqual(["streamed", " more"]);
	});
});
