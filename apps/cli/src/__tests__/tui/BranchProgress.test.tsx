import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { BranchProgress } from "../../tui/BranchProgress.js";

describe("BranchProgress", () => {
	it("renders running branch with spinning icon", () => {
		const { lastFrame } = render(
			<BranchProgress
				branches={[
					{
						branchId: "b1",
						branchIndex: 0,
						totalBranches: 3,
						status: "running",
						prompt: "try approach A",
					},
				]}
			/>,
		);
		expect(lastFrame()).toContain("⟳");
	});

	it("renders completed branch with check icon", () => {
		const { lastFrame } = render(
			<BranchProgress
				branches={[
					{
						branchId: "b1",
						branchIndex: 0,
						totalBranches: 3,
						status: "completed",
						prompt: "try approach A",
					},
				]}
			/>,
		);
		expect(lastFrame()).toContain("✓");
	});

	it("renders error branch with cross icon", () => {
		const { lastFrame } = render(
			<BranchProgress
				branches={[
					{
						branchId: "b1",
						branchIndex: 0,
						totalBranches: 3,
						status: "error",
						prompt: "try approach A",
					},
				]}
			/>,
		);
		expect(lastFrame()).toContain("✗");
	});

	it("renders branch label with index and total", () => {
		const { lastFrame } = render(
			<BranchProgress
				branches={[
					{
						branchId: "b1",
						branchIndex: 1,
						totalBranches: 3,
						status: "running",
						prompt: "try approach B",
					},
				]}
			/>,
		);
		expect(lastFrame()).toContain("Branch 2/3");
	});

	it("renders turn count when provided", () => {
		const { lastFrame } = render(
			<BranchProgress
				branches={[
					{
						branchId: "b1",
						branchIndex: 0,
						totalBranches: 2,
						status: "running",
						numTurns: 4,
						prompt: "try approach A",
					},
				]}
			/>,
		);
		expect(lastFrame()).toContain("4 turns");
	});

	it("renders cost when provided", () => {
		const { lastFrame } = render(
			<BranchProgress
				branches={[
					{
						branchId: "b1",
						branchIndex: 0,
						totalBranches: 2,
						status: "completed",
						costUsd: 0.02,
						prompt: "try approach A",
					},
				]}
			/>,
		);
		expect(lastFrame()).toContain("$0.02");
	});

	it("renders multiple branches", () => {
		const { lastFrame } = render(
			<BranchProgress
				branches={[
					{
						branchId: "b1",
						branchIndex: 0,
						totalBranches: 2,
						status: "completed",
						numTurns: 3,
						costUsd: 0.05,
						prompt: "approach A",
					},
					{
						branchId: "b2",
						branchIndex: 1,
						totalBranches: 2,
						status: "running",
						prompt: "approach B",
					},
				]}
			/>,
		);
		const frame = lastFrame() ?? "";
		expect(frame).toContain("Branch 1/2");
		expect(frame).toContain("Branch 2/2");
		expect(frame).toContain("✓");
		expect(frame).toContain("⟳");
	});

	it("renders progress bar characters", () => {
		const { lastFrame } = render(
			<BranchProgress
				branches={[
					{
						branchId: "b1",
						branchIndex: 0,
						totalBranches: 1,
						status: "running",
						numTurns: 5,
						prompt: "try A",
					},
				]}
			/>,
		);
		const frame = lastFrame() ?? "";
		// Should have at least one filled or empty block character
		expect(frame.includes("█") || frame.includes("░")).toBe(true);
	});

	it("shows error label for error status branches", () => {
		const { lastFrame } = render(
			<BranchProgress
				branches={[
					{
						branchId: "b1",
						branchIndex: 2,
						totalBranches: 3,
						status: "error",
						prompt: "try approach C",
					},
				]}
			/>,
		);
		expect(lastFrame()).toContain("error");
	});

	it("renders nothing when branches array is empty", () => {
		const { lastFrame } = render(<BranchProgress branches={[]} />);
		// Should render without crashing; frame may be empty or minimal
		expect(lastFrame()).toBeDefined();
	});
});
