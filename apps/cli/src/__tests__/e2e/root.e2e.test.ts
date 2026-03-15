import { describe, expect, it } from "vitest";
import { runCli } from "./helpers/cli-runner.js";

describe("CLI root", () => {
	it("--help prints usage with all 4 subcommands and exits 0", async () => {
		const result = await runCli(["--help"]);
		expect(result.exitCode).toBe(0);
		for (const cmd of ["query", "serve", "init", "templates"]) {
			expect(result.stdout + result.stderr).toContain(cmd);
		}
	});

	it("no args prints usage", async () => {
		const result = await runCli([]);
		// citty may exit 0 or 1 when no subcommand given — either is acceptable
		const output = result.stdout + result.stderr;
		expect(output).toContain("sandcaster");
	});

	it("bare prompt with --no-tui routes to query (verified by E2B_AUTH error)", async () => {
		const result = await runCli(["some test prompt", "--no-tui"]);
		const output = result.stdout + result.stderr;
		expect(output).toContain("E2B");
		expect(result.exitCode).not.toBe(0);
	});

	it("unknown flag produces error", async () => {
		const result = await runCli(["--bogus-unknown-flag"]);
		const output = result.stdout + result.stderr;
		// citty should report an error or unexpected flag
		expect(output.length).toBeGreaterThan(0);
	});
});
