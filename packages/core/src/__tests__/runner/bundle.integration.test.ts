import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const CORE_ROOT = resolve(import.meta.dirname, "..", "..", "..");
const BUNDLE_PATH = resolve(CORE_ROOT, "dist", "runner", "runner.mjs");
const VITE_CONFIG = resolve(CORE_ROOT, "vite.config.runner.ts");

describe("runner bundle", () => {
	beforeAll(() => {
		// Build the runner bundle via Vite
		execSync(`bunx vite build --config ${VITE_CONFIG}`, {
			cwd: CORE_ROOT,
			stdio: "pipe",
		});
	});

	it("produces a runner.mjs file", () => {
		expect(existsSync(BUNDLE_PATH)).toBe(true);
	});

	it("produces valid ESM (uses import syntax)", () => {
		const content = readFileSync(BUNDLE_PATH, "utf-8");
		// Runner is an entry-point script — should use ESM import syntax
		expect(content).toMatch(/^import\s/m);
	});

	it("does not inline pi-mono packages (they are externalized)", () => {
		const content = readFileSync(BUNDLE_PATH, "utf-8");
		// Externalized imports should appear as import statements, not inlined code
		expect(content).toMatch(/@mariozechner\/pi-agent-core/);
	});

	it("does not inline node builtins", () => {
		const content = readFileSync(BUNDLE_PATH, "utf-8");
		// Should not contain inlined node modules — they stay as imports
		expect(content).not.toMatch(/require\("fs"\)/);
		expect(content).not.toMatch(/require\("child_process"\)/);
	});

	it("is not minified (aids debugging)", () => {
		const content = readFileSync(BUNDLE_PATH, "utf-8");
		// Non-minified code should have newlines and readable structure
		const lines = content.split("\n");
		expect(lines.length).toBeGreaterThan(5);
	});
});
