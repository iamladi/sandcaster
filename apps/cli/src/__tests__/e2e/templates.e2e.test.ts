import { describe, expect, it } from "vitest";
import { runCli } from "./helpers/cli-runner.js";

const ALL_SLUGS = [
	"general-assistant",
	"research-brief",
	"document-analyst",
	"support-triage",
	"api-extractor",
	"security-audit",
];

describe("templates command", () => {
	it("lists all starters with slugs", async () => {
		const result = await runCli(["templates"]);
		expect(result.exitCode).toBe(0);
		for (const slug of ALL_SLUGS) {
			expect(result.stdout).toContain(slug);
		}
	});

	it("shows detail for research-brief", async () => {
		const result = await runCli(["templates", "research-brief"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("research-brief");
		expect(result.stdout).toContain("Research Brief");
		expect(result.stdout).toContain("sonnet");
		expect(result.stdout).toContain("20");
		expect(result.stdout).toContain("competitive-analysis");
	});

	it("--json flag on detail outputs valid JSON with model and maxTurns", async () => {
		const result = await runCli(["templates", "research-brief", "--json"]);
		expect(result.exitCode).toBe(0);
		const parsed = JSON.parse(result.stdout);
		expect(parsed.model).toBe("sonnet");
		expect(parsed.maxTurns).toBe(20);
	});

	it("--json flag on list outputs valid JSON array of 6 templates", async () => {
		const result = await runCli(["templates", "--json"]);
		expect(result.exitCode).toBe(0);
		const parsed = JSON.parse(result.stdout);
		expect(Array.isArray(parsed)).toBe(true);
		expect(parsed).toHaveLength(6);
		for (const item of parsed) {
			expect(item).toHaveProperty("slug");
			expect(item).toHaveProperty("title");
			expect(item).toHaveProperty("description");
			expect(item).toHaveProperty("aliases");
			expect(item).toHaveProperty("configJson");
		}
	});

	it("unknown template name exits 1 and mentions the name", async () => {
		const result = await runCli(["templates", "unknown-name"]);
		expect(result.exitCode).toBe(1);
		expect(result.stdout).toContain("unknown-name");
	});

	it("query -T general-assistant routes correctly (fails at API/E2B level, not template resolution)", async () => {
		const result = await runCli([
			"query",
			"-T",
			"general-assistant",
			"hello",
			"--no-tui",
		]);
		expect(result.exitCode).toBe(1);
		const output = result.stdout + result.stderr;
		// Must NOT fail at template resolution or command routing
		expect(output).not.toMatch(/unknown command/i);
		expect(output).not.toMatch(/template.*not found/i);
		// Must fail at API/sandbox level
		expect(output).toMatch(/E2B|api.key|API_KEY|sandbox/i);
	});

	it("shorthand -T general-assistant routes to query (fails at API/E2B level, not template resolution)", async () => {
		const result = await runCli([
			"-T",
			"general-assistant",
			"hello",
			"--no-tui",
		]);
		expect(result.exitCode).toBe(1);
		const output = result.stdout + result.stderr;
		// Must NOT fail at template resolution or command routing
		expect(output).not.toMatch(/unknown command/i);
		expect(output).not.toMatch(/template.*not found/i);
		// Must fail at API/sandbox level
		expect(output).toMatch(/E2B|api.key|API_KEY|sandbox/i);
	});
});
