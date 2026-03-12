import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "./helpers/cli-runner.js";
import { createTempDir } from "./helpers/temp-dir.js";

const RUNNER_BUNDLE_PATH = resolve(
	import.meta.dirname,
	"../../../../../packages/core/dist/runner/runner.mjs",
);

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

describe("runner bundle integrity", () => {
	it("runner bundle is valid JS", () => {
		const content = readFileSync(RUNNER_BUNDLE_PATH, "utf-8");
		// The bundle exists and is non-empty
		expect(content.length).toBeGreaterThan(0);
		// Must not contain obvious corruption markers
		expect(content).not.toContain("undefined is not a function");
		// Must start with a recognizable JS token (import or a function/variable)
		expect(content.trimStart()).toMatch(/^(import|const|function|var|let)/);
	});

	it("runner bundle contains event-translator (createEventTranslator)", () => {
		const content = readFileSync(RUNNER_BUNDLE_PATH, "utf-8");
		expect(content).toContain("createEventTranslator");
	});

	it("runner bundle contains event-translator characteristic strings", () => {
		const content = readFileSync(RUNNER_BUNDLE_PATH, "utf-8");
		expect(content).toContain("text_delta");
		expect(content).toContain("assistant");
	});

	it("runner bundle reads from /opt/sandcaster/agent_config.json (not /opt/agent_config.json)", () => {
		const content = readFileSync(RUNNER_BUNDLE_PATH, "utf-8");
		expect(content).toContain("/opt/sandcaster/agent_config.json");
		expect(content).not.toContain('"/opt/agent_config.json"');
	});

	it("runner bundle has model resolution (resolveModel)", () => {
		const content = readFileSync(RUNNER_BUNDLE_PATH, "utf-8");
		expect(content).toContain("resolveModel");
	});
});

describe("query command", () => {
	it("without E2B_API_KEY, outputs JSON error with E2B_AUTH and exits 1", async () => {
		const result = await runCli(["query", "hello world", "--no-tui"]);
		expect(result.exitCode).toBe(1);

		// stdout should contain JSONL with error event
		const lines = result.stdout.trim().split("\n").filter(Boolean);
		const events = lines
			.map((line) => {
				try {
					return JSON.parse(line);
				} catch {
					return null;
				}
			})
			.filter(Boolean);

		const errorEvent = events.find(
			(e: { type: string; code?: string }) =>
				e.type === "error" && e.code === "E2B_AUTH",
		);
		expect(errorEvent).toBeDefined();
	});

	it("output is valid JSONL", async () => {
		const result = await runCli(["query", "test prompt", "--no-tui"]);
		const lines = result.stdout.trim().split("\n").filter(Boolean);

		for (const line of lines) {
			expect(() => JSON.parse(line)).not.toThrow();
		}
	});

	it("no prompt exits non-zero", async () => {
		const result = await runCli(["query", "--no-tui"]);
		// citty should error on missing required positional arg
		expect(result.exitCode).not.toBe(0);
	});

	it("--timeout abc exits 1", async () => {
		const result = await runCli([
			"query",
			"hello",
			"--no-tui",
			"--timeout",
			"abc",
		]);
		expect(result.exitCode).toBe(1);
		const output = result.stdout + result.stderr;
		expect(output.toLowerCase()).toContain("invalid");
	});

	it("-f nonexistent.txt exits 1 with file error", async () => {
		const result = await runCli([
			"query",
			"hello",
			"--no-tui",
			"-f",
			"/tmp/sandcaster-e2e-nonexistent-file-12345.txt",
		]);
		expect(result.exitCode).toBe(1);
		const output = result.stdout + result.stderr;
		expect(output.toLowerCase()).toContain("error");
	});

	it("shorthand 'sandcaster prompt --no-tui' reaches query path", async () => {
		const result = await runCli(["some prompt text", "--no-tui"]);
		// Should get E2B_AUTH error, proving it routed through query
		const output = result.stdout + result.stderr;
		expect(output).toContain("E2B");
	});

	it("config file in cwd is loaded without config error", async () => {
		const { path: tmpDir } = makeTempDir();
		// Write a minimal sandcaster.json
		writeFileSync(
			join(tmpDir, "sandcaster.json"),
			JSON.stringify({ model: "sonnet", maxTurns: 5 }),
		);

		const result = await runCli(["query", "hello", "--no-tui"], {
			cwd: tmpDir,
		});
		// Should get E2B_AUTH, not a config parse error
		const output = result.stdout + result.stderr;
		expect(output).toContain("E2B");
		expect(output).not.toContain("config");
	});

	it("with E2B_API_KEY but no LLM key, error is surfaced (not silent success)", async () => {
		// Provide a fake E2B key but no LLM key — sandbox creation will fail,
		// but we verify the error propagates to the output rather than being swallowed.
		const result = await runCli(["query", "hello world", "--no-tui"], {
			env: { E2B_API_KEY: "e2b_fake_test_key" },
		});
		expect(result.exitCode).not.toBe(0);
		const output = result.stdout + result.stderr;
		// Should contain some error output — the fake key should cause a failure
		expect(output.length).toBeGreaterThan(0);
		// Should not emit a success result event
		const lines = output.split("\n").filter(Boolean);
		const events = lines
			.map((line) => {
				try {
					return JSON.parse(line);
				} catch {
					return null;
				}
			})
			.filter(Boolean);
		const successEvent = events.find(
			(e: { type: string; subtype?: string }) =>
				e.type === "result" && e.subtype === "success",
		);
		expect(successEvent).toBeUndefined();
	});
});
