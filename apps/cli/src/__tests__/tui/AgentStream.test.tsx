import type { SandcasterEvent } from "@sandcaster/core";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { AgentStream } from "../../tui/AgentStream.js";

describe("AgentStream", () => {
	it("renders assistant text content", () => {
		const events: SandcasterEvent[] = [
			{ type: "assistant", subtype: "delta", content: "Hello, world!" },
		];
		const { lastFrame } = render(<AgentStream events={events} />);
		expect(lastFrame()).toContain("Hello, world!");
	});

	it("renders tool use name", () => {
		const events: SandcasterEvent[] = [
			{ type: "tool_use", toolName: "bash", content: '{"cmd":"ls"}' },
		];
		const { lastFrame } = render(<AgentStream events={events} />);
		expect(lastFrame()).toContain("[tool: bash]");
	});

	it("renders error in red", () => {
		const events: SandcasterEvent[] = [
			{ type: "error", content: "Something went wrong" },
		];
		const { lastFrame } = render(<AgentStream events={events} />);
		expect(lastFrame()).toContain("Something went wrong");
	});

	it("renders thinking indicator", () => {
		const events: SandcasterEvent[] = [
			{ type: "thinking", subtype: "delta", content: "internal reasoning" },
		];
		const { lastFrame } = render(<AgentStream events={events} />);
		expect(lastFrame()).toContain("[thinking...]");
	});

	it("renders file path", () => {
		const events: SandcasterEvent[] = [
			{ type: "file", path: "src/main.ts", content: "file content here" },
		];
		const { lastFrame } = render(<AgentStream events={events} />);
		expect(lastFrame()).toContain("[file: src/main.ts]");
	});

	it("renders tool result content truncated to 200 chars", () => {
		const longContent = "x".repeat(300);
		const events: SandcasterEvent[] = [
			{
				type: "tool_result",
				toolName: "bash",
				content: longContent,
				isError: false,
			},
		];
		const { lastFrame } = render(<AgentStream events={events} />);
		const frame = lastFrame() ?? "";
		// Should render 200 x's total (split across lines due to terminal wrapping)
		// and not render the 201st x
		const xCount = (frame.match(/x/g) ?? []).length;
		expect(xCount).toBe(200);
	});

	it("renders system event content", () => {
		const events: SandcasterEvent[] = [
			{ type: "system", content: "Sandbox started" },
		];
		const { lastFrame } = render(<AgentStream events={events} />);
		expect(lastFrame()).toContain("Sandbox started");
	});

	it("renders warning event content in yellow", () => {
		const events: SandcasterEvent[] = [
			{ type: "warning", content: "Rate limit approaching" },
		];
		const { lastFrame } = render(<AgentStream events={events} />);
		expect(lastFrame()).toContain("Rate limit approaching");
	});

	it("renders stderr event content", () => {
		const events: SandcasterEvent[] = [
			{ type: "stderr", content: "stderr output here" },
		];
		const { lastFrame } = render(<AgentStream events={events} />);
		expect(lastFrame()).toContain("stderr output here");
	});

	it("renders multiple events in order", () => {
		const events: SandcasterEvent[] = [
			{ type: "assistant", subtype: "delta", content: "First" },
			{ type: "assistant", subtype: "delta", content: "Second" },
		];
		const { lastFrame } = render(<AgentStream events={events} />);
		const frame = lastFrame() ?? "";
		expect(frame).toContain("First");
		expect(frame).toContain("Second");
		expect(frame.indexOf("First")).toBeLessThan(frame.indexOf("Second"));
	});
});
