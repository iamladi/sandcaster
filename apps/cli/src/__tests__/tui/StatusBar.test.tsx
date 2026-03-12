import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { StatusBar } from "../../tui/StatusBar.js";

describe("StatusBar", () => {
	it("shows running status", () => {
		const { lastFrame } = render(<StatusBar status="running" />);
		expect(lastFrame()).toContain("Running");
	});

	it("shows completed status", () => {
		const { lastFrame } = render(<StatusBar status="completed" />);
		expect(lastFrame()).toContain("Completed");
	});

	it("shows error status", () => {
		const { lastFrame } = render(<StatusBar status="error" />);
		expect(lastFrame()).toContain("Error");
	});

	it("shows idle status", () => {
		const { lastFrame } = render(<StatusBar status="idle" />);
		expect(lastFrame()).toContain("Idle");
	});

	it("shows model when provided with completed status", () => {
		const { lastFrame } = render(
			<StatusBar status="completed" model="claude-sonnet-4-6" />,
		);
		expect(lastFrame()).toContain("claude-sonnet-4-6");
	});

	it("shows turns count when provided", () => {
		const { lastFrame } = render(<StatusBar status="running" numTurns={3} />);
		expect(lastFrame()).toContain("3 turns");
	});

	it("shows cost when provided", () => {
		const { lastFrame } = render(
			<StatusBar status="completed" costUsd={0.0042} />,
		);
		expect(lastFrame()).toContain("$0.0042");
	});

	it("shows duration when provided", () => {
		const { lastFrame } = render(
			<StatusBar status="completed" durationSecs={12.5} />,
		);
		expect(lastFrame()).toContain("12.5s");
	});

	it("shows all stats in completed status", () => {
		const { lastFrame } = render(
			<StatusBar
				status="completed"
				model="claude-sonnet-4-6"
				numTurns={5}
				costUsd={0.0123}
				durationSecs={30.2}
			/>,
		);
		const frame = lastFrame() ?? "";
		expect(frame).toContain("Completed");
		expect(frame).toContain("claude-sonnet-4-6");
		expect(frame).toContain("5 turns");
		expect(frame).toContain("$0.0123");
		expect(frame).toContain("30.2s");
	});

	it("shows error status without optional stats", () => {
		const { lastFrame } = render(
			<StatusBar status="error" model="claude-sonnet-4-6" numTurns={2} />,
		);
		const frame = lastFrame() ?? "";
		expect(frame).toContain("Error");
		expect(frame).toContain("claude-sonnet-4-6");
		expect(frame).toContain("2 turns");
	});
});
