import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "./helpers/cli-runner.js";
import { createTempDir } from "./helpers/temp-dir.js";

// Track temp dirs for cleanup
const tempDirs: Array<{ cleanup: () => void }> = [];

afterEach(() => {
	for (const td of tempDirs) {
		td.cleanup();
	}
	tempDirs.length = 0;
});

function makeTempDir() {
	const td = createTempDir();
	tempDirs.push(td);
	return td;
}

describe("init command", () => {
	it("init --list prints all 6 starters", async () => {
		const result = await runCli(["init", "--list"]);
		expect(result.exitCode).toBe(0);
		const output = result.stdout;
		for (const slug of [
			"general-assistant",
			"research-brief",
			"document-analyst",
			"support-triage",
			"api-extractor",
			"security-audit",
		]) {
			expect(output).toContain(slug);
		}
	});

	it("init general-assistant <tmpdir> creates sandcaster.json, README.md, .env.example", async () => {
		const { path: tmpDir } = makeTempDir();
		const dest = join(tmpDir, "test-project");

		const result = await runCli(["init", "general-assistant", dest]);
		expect(result.exitCode).toBe(0);

		expect(existsSync(join(dest, "sandcaster.json"))).toBe(true);
		expect(existsSync(join(dest, "README.md"))).toBe(true);
		expect(existsSync(join(dest, ".env.example"))).toBe(true);
	});

	it("sandcaster.json content is valid and matches starter config", async () => {
		const { path: tmpDir } = makeTempDir();
		const dest = join(tmpDir, "test-project");

		await runCli(["init", "general-assistant", dest]);

		const content = readFileSync(join(dest, "sandcaster.json"), "utf-8");
		const config = JSON.parse(content);
		expect(config).toHaveProperty("systemPrompt");
		expect(config).toHaveProperty("model", "sonnet");
		expect(config).toHaveProperty("maxTurns", 15);
	});

	it("init general-assistant my-project creates in custom directory name", async () => {
		const { path: tmpDir } = makeTempDir();
		const dest = join(tmpDir, "my-custom-project");

		const result = await runCli(["init", "general-assistant", dest]);
		expect(result.exitCode).toBe(0);
		expect(existsSync(join(dest, "sandcaster.json"))).toBe(true);
	});

	it("init competitive-analysis resolves alias to research-brief", async () => {
		const { path: tmpDir } = makeTempDir();
		const dest = join(tmpDir, "aliased");

		const result = await runCli(["init", "competitive-analysis", dest]);
		expect(result.exitCode).toBe(0);

		const content = readFileSync(join(dest, "sandcaster.json"), "utf-8");
		const config = JSON.parse(content);
		// research-brief has maxTurns: 20
		expect(config).toHaveProperty("maxTurns", 20);
	});

	it("init security-audit creates extra .claude/skills/ files", async () => {
		const { path: tmpDir } = makeTempDir();
		const dest = join(tmpDir, "security");

		const result = await runCli(["init", "security-audit", dest]);
		expect(result.exitCode).toBe(0);
		expect(existsSync(join(dest, ".claude/skills/owasp-top-10/SKILL.md"))).toBe(
			true,
		);
	});

	it("init bogus-name exits 1 with error", async () => {
		const result = await runCli(["init", "bogus-nonexistent-starter"]);
		expect(result.exitCode).toBe(1);
		const output = result.stdout + result.stderr;
		expect(output).toContain("Unknown starter");
	});

	it("init with no starter exits 1", async () => {
		const result = await runCli(["init"]);
		expect(result.exitCode).toBe(1);
	});

	it("double init without --force fails", async () => {
		const { path: tmpDir } = makeTempDir();
		const dest = join(tmpDir, "double");

		await runCli(["init", "general-assistant", dest]);
		const result = await runCli(["init", "general-assistant", dest]);
		expect(result.exitCode).toBe(1);
		const output = result.stdout + result.stderr;
		expect(output).toContain("--force");
	});

	it("double init with --force succeeds", async () => {
		const { path: tmpDir } = makeTempDir();
		const dest = join(tmpDir, "double-force");

		await runCli(["init", "general-assistant", dest]);
		const result = await runCli(["init", "general-assistant", dest, "--force"]);
		expect(result.exitCode).toBe(0);
	});

	it("with ANTHROPIC_API_KEY in env, .env is created", async () => {
		const { path: tmpDir } = makeTempDir();
		const dest = join(tmpDir, "env-detect");

		const result = await runCli(["init", "general-assistant", dest], {
			env: { ANTHROPIC_API_KEY: "sk-ant-test-key" },
		});
		expect(result.exitCode).toBe(0);
		expect(existsSync(join(dest, ".env"))).toBe(true);

		const envContent = readFileSync(join(dest, ".env"), "utf-8");
		expect(envContent).toContain("ANTHROPIC_API_KEY=sk-ant-test-key");
	});

	it("without provider env vars, no .env is created", async () => {
		const { path: tmpDir } = makeTempDir();
		const dest = join(tmpDir, "no-env");

		const result = await runCli(["init", "general-assistant", dest]);
		expect(result.exitCode).toBe(0);
		expect(existsSync(join(dest, ".env"))).toBe(false);
	});
});
