import type { SandcasterEvent } from "@sandcaster/core";
import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { AgentStream } from "../../tui/AgentStream.js";

vi.mock("ink", async (importOriginal) => {
	const actual = await importOriginal<typeof import("ink")>();
	return {
		...actual,
		useStdoutDimensions: () => [80, 24],
	};
});

describe("AgentStream", () => {
	it("renders assistant text content via assistantText prop", () => {
		const { lastFrame } = render(
			<AgentStream events={[]} assistantText="Hello, world!" />,
		);
		expect(lastFrame()).toContain("Hello, world!");
	});

	it("renders assistantText prop through markdown when provided", () => {
		const { lastFrame } = render(
			<AgentStream events={[]} assistantText="Hello world" />,
		);
		expect(lastFrame()).toContain("Hello world");
	});

	it("extracts assistant/complete content for completed turns", () => {
		const events: SandcasterEvent[] = [
			{ type: "assistant", subtype: "complete", content: "Completed response" },
		];
		const { lastFrame } = render(<AgentStream events={events} />);
		expect(lastFrame()).toContain("Completed response");
	});

	it("does not render assistant delta events as separate lines", () => {
		const events: SandcasterEvent[] = [
			{ type: "assistant", subtype: "delta", content: "delta chunk" },
		];
		const { lastFrame } = render(<AgentStream events={events} />);
		// Without assistantText or a complete event, delta events should not render
		expect(lastFrame()).not.toContain("delta chunk");
	});

	it("renders non-assistant events alongside markdown text", () => {
		const events: SandcasterEvent[] = [
			{ type: "tool_use", toolName: "bash", content: '{"cmd":"ls"}' },
		];
		const { lastFrame } = render(
			<AgentStream events={events} assistantText="Hello world" />,
		);
		const frame = lastFrame() ?? "";
		expect(frame).toContain("[tool: bash]");
		expect(frame).toContain("Hello world");
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

	it("renders hint text below error message when hint is present", () => {
		const events: SandcasterEvent[] = [
			{
				type: "error",
				content: "Sandbox template 'bad' not found.",
				code: "TEMPLATE_NOT_FOUND",
				hint: "Run: bun run scripts/create-template.ts",
			},
		];
		const { lastFrame } = render(<AgentStream events={events} />);
		const frame = lastFrame() ?? "";
		expect(frame).toContain("Sandbox template 'bad' not found.");
		expect(frame).toContain("Run: bun run scripts/create-template.ts");
	});

	it("renders error without hint when hint is absent", () => {
		const events: SandcasterEvent[] = [
			{ type: "error", content: "Unknown error", code: "SANDBOX_ERROR" },
		];
		const { lastFrame } = render(<AgentStream events={events} />);
		const frame = lastFrame() ?? "";
		expect(frame).toContain("Unknown error");
	});

	it("renders multiple events in order", () => {
		const events: SandcasterEvent[] = [
			{ type: "system", content: "First" },
			{ type: "system", content: "Second" },
		];
		const { lastFrame } = render(<AgentStream events={events} />);
		const frame = lastFrame() ?? "";
		expect(frame).toContain("First");
		expect(frame).toContain("Second");
		expect(frame.indexOf("First")).toBeLessThan(frame.indexOf("Second"));
	});
});
