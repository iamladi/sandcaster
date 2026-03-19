import { describe, expect, it } from "vitest";
import { createBranchTools } from "../../runner/sandbox-tools.js";

describe("branch tool", () => {
	function setup() {
		const emitted: Record<string, unknown>[] = [];
		const emit = (event: Record<string, unknown>) => {
			emitted.push(event);
		};
		const { tools, shouldAbort } = createBranchTools({ emit });
		const branchTool = tools.find((t) => t.name === "branch")!;
		return { branchTool, emitted, tools, shouldAbort };
	}

	it("exists and has correct metadata", () => {
		const { branchTool } = setup();
		expect(branchTool).toBeDefined();
		expect(branchTool.name).toBe("branch");
		expect(branchTool.description.length).toBeGreaterThan(0);
	});

	it("emits a branch_request event with alternatives and reason", async () => {
		const { branchTool, emitted } = setup();

		await branchTool.execute("call-1", {
			alternatives: ["Try approach A", "Try approach B"],
			reason: "Multiple viable strategies",
		});

		expect(emitted).toHaveLength(1);
		expect(emitted[0]).toMatchObject({
			type: "branch_request",
			alternatives: ["Try approach A", "Try approach B"],
			reason: "Multiple viable strategies",
		});
	});

	it("emits branch_request without reason when not provided", async () => {
		const { branchTool, emitted } = setup();

		await branchTool.execute("call-2", {
			alternatives: ["A", "B"],
		});

		expect(emitted[0]).toMatchObject({
			type: "branch_request",
			alternatives: ["A", "B"],
		});
		expect(emitted[0]).not.toHaveProperty("reason");
	});

	it("returns a termination message", async () => {
		const { branchTool } = setup();

		const result = await branchTool.execute("call-3", {
			alternatives: ["A", "B"],
		});

		expect(result.content[0]).toMatchObject({
			type: "text",
			text: expect.stringContaining("branch"),
		});
	});

	it("sets the abort flag after execution", async () => {
		const { branchTool, shouldAbort } = setup();

		expect(shouldAbort()).toBe(false);

		await branchTool.execute("call-4", {
			alternatives: ["A", "B"],
		});

		expect(shouldAbort()).toBe(true);
	});

	it("abort flag stays true after multiple calls", async () => {
		const { branchTool, shouldAbort } = setup();

		await branchTool.execute("call-5", {
			alternatives: ["A"],
		});
		await branchTool.execute("call-6", {
			alternatives: ["B"],
		});

		expect(shouldAbort()).toBe(true);
	});
});

describe("report_confidence tool", () => {
	function setup() {
		const emitted: Record<string, unknown>[] = [];
		const emit = (event: Record<string, unknown>) => {
			emitted.push(event);
		};
		const { tools, shouldAbort } = createBranchTools({ emit });
		const confidenceTool = tools.find((t) => t.name === "report_confidence")!;
		return { confidenceTool, emitted, tools, shouldAbort };
	}

	it("exists and has correct metadata", () => {
		const { confidenceTool } = setup();
		expect(confidenceTool).toBeDefined();
		expect(confidenceTool.name).toBe("report_confidence");
	});

	it("emits a confidence_report event", async () => {
		const { confidenceTool, emitted } = setup();

		await confidenceTool.execute("call-5", {
			level: 0.3,
			reason: "Uncertain about the approach",
		});

		expect(emitted).toHaveLength(1);
		expect(emitted[0]).toMatchObject({
			type: "confidence_report",
			level: 0.3,
			reason: "Uncertain about the approach",
		});
	});

	it("returns a confirmation message with the level", async () => {
		const { confidenceTool } = setup();

		const result = await confidenceTool.execute("call-6", {
			level: 0.8,
			reason: "Fairly confident",
		});

		expect(result.content[0]).toMatchObject({
			type: "text",
			text: expect.stringContaining("0.8"),
		});
	});

	it("does not set the abort flag", async () => {
		const { confidenceTool, shouldAbort } = setup();

		await confidenceTool.execute("call-7", {
			level: 0.2,
			reason: "Low confidence",
		});

		expect(shouldAbort()).toBe(false);
	});
});
