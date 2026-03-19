import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { BranchSummary } from "../../tui/BranchSummary.js";

const defaultBranches = [
	{
		branchId: "b1",
		branchIndex: 0,
		status: "success" as const,
		numTurns: 6,
		costUsd: 0.02,
	},
	{
		branchId: "b2",
		branchIndex: 1,
		status: "success" as const,
		numTurns: 3,
		costUsd: 0.05,
	},
	{
		branchId: "b3",
		branchIndex: 2,
		status: "error" as const,
		numTurns: 4,
		costUsd: 0.12,
	},
];

describe("BranchSummary", () => {
	it("shows winner check icon and label", () => {
		const { lastFrame } = render(
			<BranchSummary
				winner={{
					branchId: "b2",
					branchIndex: 1,
					totalBranches: 3,
					reason: "better quality",
				}}
				branches={defaultBranches}
				totalCostUsd={0.19}
				evaluator="llm-judge"
			/>,
		);
		const frame = lastFrame() ?? "";
		expect(frame).toContain("✓");
		expect(frame).toContain("Winner");
	});

	it("shows winner branch index/total", () => {
		const { lastFrame } = render(
			<BranchSummary
				winner={{
					branchId: "b2",
					branchIndex: 1,
					totalBranches: 3,
					reason: "better quality",
				}}
				branches={defaultBranches}
				totalCostUsd={0.19}
				evaluator="llm-judge"
			/>,
		);
		expect(lastFrame()).toContain("Branch 2/3");
	});

	it("shows winner reason text", () => {
		const { lastFrame } = render(
			<BranchSummary
				winner={{
					branchId: "b2",
					branchIndex: 1,
					totalBranches: 3,
					reason: "better output quality",
				}}
				branches={defaultBranches}
				totalCostUsd={0.19}
				evaluator="llm-judge"
			/>,
		);
		expect(lastFrame()).toContain("better output quality");
	});

	it("shows score when available", () => {
		const { lastFrame } = render(
			<BranchSummary
				winner={{
					branchId: "b2",
					branchIndex: 1,
					totalBranches: 3,
					reason: "highest score",
					scores: { b2: 0.92 },
				}}
				branches={defaultBranches}
				totalCostUsd={0.19}
				evaluator="llm-judge"
			/>,
		);
		expect(lastFrame()).toContain("0.92");
	});

	it("shows loser branches as one-liners", () => {
		const { lastFrame } = render(
			<BranchSummary
				winner={{
					branchId: "b2",
					branchIndex: 1,
					totalBranches: 3,
					reason: "best",
				}}
				branches={defaultBranches}
				totalCostUsd={0.19}
				evaluator="llm-judge"
			/>,
		);
		const frame = lastFrame() ?? "";
		expect(frame).toContain("Branch 1");
		expect(frame).toContain("Branch 3");
	});

	it("shows turn counts for loser branches", () => {
		const { lastFrame } = render(
			<BranchSummary
				winner={{
					branchId: "b2",
					branchIndex: 1,
					totalBranches: 3,
					reason: "best",
				}}
				branches={defaultBranches}
				totalCostUsd={0.19}
				evaluator="llm-judge"
			/>,
		);
		const frame = lastFrame() ?? "";
		expect(frame).toContain("6 turns");
	});

	it("shows total cost in summary line", () => {
		const { lastFrame } = render(
			<BranchSummary
				winner={{
					branchId: "b2",
					branchIndex: 1,
					totalBranches: 3,
					reason: "best",
				}}
				branches={defaultBranches}
				totalCostUsd={0.19}
				evaluator="llm-judge"
			/>,
		);
		expect(lastFrame()).toContain("$0.19");
	});

	it("shows evaluator in summary line", () => {
		const { lastFrame } = render(
			<BranchSummary
				winner={{
					branchId: "b2",
					branchIndex: 1,
					totalBranches: 3,
					reason: "best",
				}}
				branches={defaultBranches}
				totalCostUsd={0.19}
				evaluator="llm-judge"
			/>,
		);
		expect(lastFrame()).toContain("llm-judge");
	});

	it("renders gracefully with null winner", () => {
		const { lastFrame } = render(
			<BranchSummary
				winner={null}
				branches={defaultBranches}
				totalCostUsd={0.19}
				evaluator="rule-based"
			/>,
		);
		const frame = lastFrame() ?? "";
		expect(frame).toContain("rule-based");
	});

	it("shows branch count in summary line", () => {
		const { lastFrame } = render(
			<BranchSummary
				winner={{
					branchId: "b2",
					branchIndex: 1,
					totalBranches: 3,
					reason: "best",
				}}
				branches={defaultBranches}
				totalCostUsd={0.19}
				evaluator="llm-judge"
			/>,
		);
		expect(lastFrame()).toContain("3 branches");
	});
});
