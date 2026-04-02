import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	type MockInstance,
	vi,
} from "vitest";

// loadConfig is imported fresh per test group via module reset
// We use vi.resetModules() to clear the module-level cache between tests.

const CONFIG_FILE = "sandcaster.json";

function writeConfig(dir: string, content: unknown): void {
	writeFileSync(join(dir, CONFIG_FILE), JSON.stringify(content), "utf-8");
}

function writeRaw(dir: string, raw: string): void {
	writeFileSync(join(dir, CONFIG_FILE), raw, "utf-8");
}

describe("loadConfig", () => {
	let tmpDir: string;
	let warnSpy: MockInstance;
	let errorSpy: MockInstance;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "sandcaster-config-test-"));
		warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		// Reset module to clear the module-level cache between tests
		vi.resetModules();
	});

	afterEach(() => {
		warnSpy.mockRestore();
		errorSpy.mockRestore();
		rmSync(tmpDir, { recursive: true, force: true });
	});

	async function getLoadConfig() {
		const mod = await import("../config.js");
		return mod.loadConfig;
	}

	// -------------------------------------------------------------------------
	// Existence / missing file
	// -------------------------------------------------------------------------

	it("returns null when config file does not exist", async () => {
		const loadConfig = await getLoadConfig();
		const result = loadConfig(tmpDir);
		expect(result).toBeNull();
		expect(warnSpy).not.toHaveBeenCalled();
		expect(errorSpy).not.toHaveBeenCalled();
	});

	// -------------------------------------------------------------------------
	// Happy path
	// -------------------------------------------------------------------------

	it("loads and parses a valid config", async () => {
		writeConfig(tmpDir, { model: "claude-opus-4-5", maxTurns: 5 });
		const loadConfig = await getLoadConfig();
		const result = loadConfig(tmpDir);
		expect(result).toEqual({ model: "claude-opus-4-5", maxTurns: 5 });
	});

	// -------------------------------------------------------------------------
	// mtime caching
	// -------------------------------------------------------------------------

	it("returns cached config on second call when mtime is unchanged", async () => {
		writeConfig(tmpDir, { model: "claude-sonnet-4-5" });
		const loadConfig = await getLoadConfig();

		const first = loadConfig(tmpDir);
		const second = loadConfig(tmpDir);

		expect(second).toBe(first); // same object reference = cache hit
	});

	it("re-reads config when mtime changes", async () => {
		writeConfig(tmpDir, { model: "claude-sonnet-4-5" });
		const loadConfig = await getLoadConfig();

		const first = loadConfig(tmpDir);
		expect(first?.model).toBe("claude-sonnet-4-5");

		// Wait a tick then overwrite so the mtime changes
		// On some filesystems mtime resolution is 1s — use a future mtime hack
		const newContent = { model: "claude-opus-4-5" };
		writeFileSync(
			join(tmpDir, CONFIG_FILE),
			JSON.stringify(newContent),
			"utf-8",
		);

		// Force mtime to be different by bumping it manually
		const { utimesSync } = await import("node:fs");
		const futureMs = Date.now() + 2000;
		utimesSync(join(tmpDir, CONFIG_FILE), futureMs / 1000, futureMs / 1000);

		const second = loadConfig(tmpDir);
		expect(second?.model).toBe("claude-opus-4-5");
		expect(second).not.toBe(first);
	});

	// -------------------------------------------------------------------------
	// Unknown field stripping
	// -------------------------------------------------------------------------

	it("strips unknown fields and logs a warning for each", async () => {
		writeConfig(tmpDir, {
			model: "claude-sonnet-4-5",
			unknownField: "value",
			anotherUnknown: 42,
		});
		const loadConfig = await getLoadConfig();
		const result = loadConfig(tmpDir);

		expect(result).toEqual({ model: "claude-sonnet-4-5" });
		expect(warnSpy).toHaveBeenCalledTimes(2);
		expect(
			warnSpy.mock.calls.some((args) =>
				String(args[0]).includes("unknownField"),
			),
		).toBe(true);
		expect(
			warnSpy.mock.calls.some((args) =>
				String(args[0]).includes("anotherUnknown"),
			),
		).toBe(true);
	});

	// -------------------------------------------------------------------------
	// Invalid JSON
	// -------------------------------------------------------------------------

	it("returns null and logs error for invalid JSON", async () => {
		writeRaw(tmpDir, "{ not valid json }}}");
		const loadConfig = await getLoadConfig();
		const result = loadConfig(tmpDir);

		expect(result).toBeNull();
		expect(errorSpy).toHaveBeenCalledTimes(1);
	});

	// -------------------------------------------------------------------------
	// Non-object JSON
	// -------------------------------------------------------------------------

	it("returns null and logs error when file contains a JSON array", async () => {
		writeRaw(tmpDir, "[1, 2, 3]");
		const loadConfig = await getLoadConfig();
		const result = loadConfig(tmpDir);

		expect(result).toBeNull();
		expect(errorSpy).toHaveBeenCalledTimes(1);
	});

	it("returns null and logs error when file contains a JSON string", async () => {
		writeRaw(tmpDir, '"just a string"');
		const loadConfig = await getLoadConfig();
		const result = loadConfig(tmpDir);

		expect(result).toBeNull();
		expect(errorSpy).toHaveBeenCalledTimes(1);
	});

	// -------------------------------------------------------------------------
	// Partial tolerance — invalid field values stripped
	// -------------------------------------------------------------------------

	it("keeps valid fields and strips invalid-typed fields with warning", async () => {
		writeConfig(tmpDir, {
			model: "claude-sonnet-4-5",
			maxTurns: "not-a-number", // should be stripped — Zod validation fails
		});
		const loadConfig = await getLoadConfig();
		const result = loadConfig(tmpDir);

		// model should be kept, maxTurns should be stripped
		expect(result?.model).toBe("claude-sonnet-4-5");
		expect(result?.maxTurns).toBeUndefined();
		// A warning should have been emitted for maxTurns with the reason
		expect(warnSpy).toHaveBeenCalledTimes(1);
		const warnMsg = String(warnSpy.mock.calls[0][0]);
		expect(warnMsg).toContain("maxTurns");
		expect(warnMsg).toContain("invalid");
		// Verify the "why" is included (Zod error reason)
		expect(warnMsg).toMatch(/\(.+\)/); // parenthesized reason
	});

	// -------------------------------------------------------------------------
	// Nested object partial tolerance
	// -------------------------------------------------------------------------

	it("strips invalid nested sub-field but preserves valid siblings in composite", async () => {
		writeConfig(tmpDir, {
			composite: {
				maxSandboxes: 0, // invalid: gte(1)
				allowedProviders: ["e2b"], // valid
			},
		});
		const loadConfig = await getLoadConfig();
		const result = loadConfig(tmpDir);

		// allowedProviders should be preserved, maxSandboxes stripped (gets default)
		expect(result?.composite?.allowedProviders).toEqual(["e2b"]);
		expect(result?.composite?.maxSandboxes).toBe(3); // default
		expect(warnSpy).toHaveBeenCalled();
		const warnMsg = warnSpy.mock.calls
			.map((args) => String(args[0]))
			.join("\n");
		expect(warnMsg).toContain("maxSandboxes");
	});

	it("recursively preserves valid grandchild fields when a sibling grandchild is invalid", async () => {
		writeConfig(tmpDir, {
			branching: {
				enabled: true,
				count: 3,
				evaluator: { type: "llm-judge", prompt: 123 },
			},
		});
		const loadConfig = await getLoadConfig();
		const result = loadConfig(tmpDir);

		// branching top-level siblings preserved
		expect(result?.branching?.enabled).toBe(true);
		expect(result?.branching?.count).toBe(3);

		// evaluator.type preserved, evaluator.prompt stripped
		expect(result?.branching?.evaluator?.type).toBe("llm-judge");
		expect(result?.branching?.evaluator?.prompt).toBeUndefined();

		// A warning should have been emitted for the invalid nested field
		expect(warnSpy).toHaveBeenCalled();
		const allWarnings = warnSpy.mock.calls
			.map((args) => String(args[0]))
			.join("\n");
		expect(allWarnings).toContain("prompt");
	});

	it("preserves entire composite when all sub-fields are valid", async () => {
		writeConfig(tmpDir, {
			composite: {
				maxSandboxes: 5,
				allowedProviders: ["e2b"],
			},
		});
		const loadConfig = await getLoadConfig();
		const result = loadConfig(tmpDir);

		expect(result?.composite?.maxSandboxes).toBe(5);
		expect(result?.composite?.allowedProviders).toEqual(["e2b"]);
		expect(warnSpy).not.toHaveBeenCalled();
	});

	// -------------------------------------------------------------------------
	// Cache cleared when file is deleted
	// -------------------------------------------------------------------------

	it("clears cache and returns null when file is deleted after being cached", async () => {
		writeConfig(tmpDir, { model: "claude-sonnet-4-5" });
		const loadConfig = await getLoadConfig();

		// Prime the cache
		const first = loadConfig(tmpDir);
		expect(first).not.toBeNull();

		// Delete the file
		rmSync(join(tmpDir, CONFIG_FILE));

		// Should return null and not the stale cached value
		const second = loadConfig(tmpDir);
		expect(second).toBeNull();
	});
});
