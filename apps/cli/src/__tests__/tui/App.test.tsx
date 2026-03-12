import type { SandcasterEvent } from "@sandcaster/core";
import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { App } from "../../tui/App.js";

vi.mock("ink", async (importOriginal) => {
	const actual = await importOriginal<typeof import("ink")>();
	return {
		...actual,
		useStdout: () => ({ stdout: { columns: 80, rows: 24 } }),
		useApp: () => ({ exit: vi.fn() }),
	};
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function* makeEventSource(
	events: SandcasterEvent[],
	delayMs = 0,
): AsyncGenerator<SandcasterEvent> {
	for (const event of events) {
		if (delayMs > 0) {
			await new Promise((resolve) => setTimeout(resolve, delayMs));
		}
		yield event;
	}
}

function waitFor(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("App", () => {
	it("renders assistant content from completed turn", async () => {
		const events: SandcasterEvent[] = [
			{ type: "assistant", subtype: "delta", content: "Hello from agent" },
			{
				type: "assistant",
				subtype: "complete",
				content: "Hello from agent",
			},
			{ type: "result", content: "done" },
		];
		const { lastFrame } = render(<App eventSource={makeEventSource(events)} />);
		await waitFor(50);
		expect(lastFrame()).toContain("Hello from agent");
	});

	it("calls onExit(0) on result event", async () => {
		const onExit = vi.fn();
		const events: SandcasterEvent[] = [
			{ type: "assistant", subtype: "delta", content: "output" },
			{ type: "assistant", subtype: "complete", content: "output" },
			{
				type: "result",
				content: "done",
				costUsd: 0.01,
				numTurns: 2,
				durationSecs: 5.0,
				model: "claude-sonnet-4-6",
			},
		];
		render(<App eventSource={makeEventSource(events)} onExit={onExit} />);
		await waitFor(50);
		expect(onExit).toHaveBeenCalledWith(0);
	});

	it("calls onExit(1) on error event", async () => {
		const onExit = vi.fn();
		const events: SandcasterEvent[] = [
			{ type: "error", content: "Agent failed" },
		];
		render(<App eventSource={makeEventSource(events)} onExit={onExit} />);
		await waitFor(50);
		expect(onExit).toHaveBeenCalledWith(1);
	});

	it("shows StatusBar with result info after completion", async () => {
		const events: SandcasterEvent[] = [
			{
				type: "result",
				content: "done",
				costUsd: 0.0042,
				numTurns: 3,
				durationSecs: 12.5,
				model: "claude-sonnet-4-6",
			},
		];
		const { lastFrame } = render(<App eventSource={makeEventSource(events)} />);
		await waitFor(50);
		const frame = lastFrame() ?? "";
		expect(frame).toContain("Completed");
		expect(frame).toContain("claude-sonnet-4-6");
		expect(frame).toContain("3 turns");
	});
});
