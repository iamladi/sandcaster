import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
import { createRunStore } from "../store.js";

describe("createRunStore", () => {
	let tmpDir: string;
	let warnSpy: MockInstance;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "sandcaster-store-test-"));
		warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		warnSpy.mockRestore();
		rmSync(tmpDir, { recursive: true, force: true });
	});

	// -------------------------------------------------------------------------
	// create
	// -------------------------------------------------------------------------

	it("creates a run with correct initial state", () => {
		const store = createRunStore({ path: join(tmpDir, "runs.jsonl") });
		const before = new Date().toISOString();
		const run = store.create("run-1", "do something", "claude-sonnet-4-6");
		const after = new Date().toISOString();

		expect(run.id).toBe("run-1");
		expect(run.prompt).toBe("do something");
		expect(run.model).toBe("claude-sonnet-4-6");
		expect(run.status).toBe("running");
		expect(run.filesCount).toBe(0);
		expect(run.startedAt >= before).toBe(true);
		expect(run.startedAt <= after).toBe(true);
		expect(run.costUsd).toBeUndefined();
		expect(run.numTurns).toBeUndefined();
		expect(run.durationSecs).toBeUndefined();
		expect(run.error).toBeUndefined();
		expect(run.feedback).toBeUndefined();
		expect(run.feedbackUser).toBeUndefined();
	});

	it("creates a run with filesCount when provided", () => {
		const store = createRunStore({ path: join(tmpDir, "runs.jsonl") });
		const run = store.create("run-2", "upload files", null, 3);
		expect(run.filesCount).toBe(3);
	});

	it("creates a run with null model", () => {
		const store = createRunStore({ path: join(tmpDir, "runs.jsonl") });
		const run = store.create("run-null-model", "test", null);
		expect(run.model).toBeUndefined();
	});

	it("truncates prompt to 100 chars", () => {
		const store = createRunStore({ path: join(tmpDir, "runs.jsonl") });
		const longPrompt = "a".repeat(200);
		const run = store.create("run-trunc", longPrompt, null);
		expect(run.prompt).toBe("a".repeat(100));
		expect(run.prompt.length).toBe(100);
	});

	// -------------------------------------------------------------------------
	// complete
	// -------------------------------------------------------------------------

	it("completes a run with cost, turns, and duration", () => {
		const store = createRunStore({ path: join(tmpDir, "runs.jsonl") });
		store.create("run-c", "do work", "gpt-4");
		store.complete("run-c", {
			costUsd: 0.05,
			numTurns: 3,
			durationSecs: 12.5,
		});

		const runs = store.list();
		expect(runs[0].status).toBe("completed");
		expect(runs[0].costUsd).toBe(0.05);
		expect(runs[0].numTurns).toBe(3);
		expect(runs[0].durationSecs).toBe(12.5);
	});

	it("complete can update model", () => {
		const store = createRunStore({ path: join(tmpDir, "runs.jsonl") });
		store.create("run-model", "test", null);
		store.complete("run-model", { model: "claude-opus-4-5" });

		const runs = store.list();
		expect(runs[0].model).toBe("claude-opus-4-5");
	});

	it("warns on complete with unknown run id", () => {
		const store = createRunStore({ path: join(tmpDir, "runs.jsonl") });
		store.complete("nonexistent-id");
		expect(warnSpy).toHaveBeenCalledOnce();
		expect(warnSpy.mock.calls[0][0]).toContain("nonexistent-id");
	});

	// -------------------------------------------------------------------------
	// fail
	// -------------------------------------------------------------------------

	it("fails a run with error message", () => {
		const store = createRunStore({ path: join(tmpDir, "runs.jsonl") });
		store.create("run-f", "do work", null);
		store.fail("run-f", "Sandbox timed out", 30.0);

		const runs = store.list();
		expect(runs[0].status).toBe("error");
		expect(runs[0].error).toBe("Sandbox timed out");
		expect(runs[0].durationSecs).toBe(30.0);
	});

	it("fails a run without durationSecs", () => {
		const store = createRunStore({ path: join(tmpDir, "runs.jsonl") });
		store.create("run-f2", "do work", null);
		store.fail("run-f2", "Out of memory");

		const runs = store.list();
		expect(runs[0].status).toBe("error");
		expect(runs[0].durationSecs).toBeUndefined();
	});

	it("warns on fail with unknown run id", () => {
		const store = createRunStore({ path: join(tmpDir, "runs.jsonl") });
		store.fail("nonexistent-id", "some error");
		expect(warnSpy).toHaveBeenCalledOnce();
		expect(warnSpy.mock.calls[0][0]).toContain("nonexistent-id");
	});

	// -------------------------------------------------------------------------
	// addFeedback
	// -------------------------------------------------------------------------

	it("adds feedback to a run", () => {
		const store = createRunStore({ path: join(tmpDir, "runs.jsonl") });
		store.create("run-fb", "do work", null);
		store.addFeedback("run-fb", "looks great", "alice");

		const runs = store.list();
		expect(runs[0].feedback).toBe("looks great");
		expect(runs[0].feedbackUser).toBe("alice");
	});

	it("warns on addFeedback with unknown run id", () => {
		const store = createRunStore({ path: join(tmpDir, "runs.jsonl") });
		store.addFeedback("nonexistent-id", "feedback", "bob");
		expect(warnSpy).toHaveBeenCalledOnce();
		expect(warnSpy.mock.calls[0][0]).toContain("nonexistent-id");
	});

	// -------------------------------------------------------------------------
	// list
	// -------------------------------------------------------------------------

	it("lists runs newest-first", () => {
		const store = createRunStore({ path: join(tmpDir, "runs.jsonl") });
		store.create("run-a", "first", null);
		store.create("run-b", "second", null);
		store.create("run-c", "third", null);

		const runs = store.list();
		expect(runs[0].id).toBe("run-c");
		expect(runs[1].id).toBe("run-b");
		expect(runs[2].id).toBe("run-a");
	});

	it("lists with default limit of 50", () => {
		const store = createRunStore({ path: join(tmpDir, "runs.jsonl") });
		for (let i = 0; i < 60; i++) {
			store.create(`run-${i}`, "prompt", null);
		}
		const runs = store.list();
		expect(runs.length).toBe(50);
	});

	it("lists with custom limit", () => {
		const store = createRunStore({ path: join(tmpDir, "runs.jsonl") });
		store.create("run-1", "first", null);
		store.create("run-2", "second", null);
		store.create("run-3", "third", null);

		const runs = store.list(2);
		expect(runs.length).toBe(2);
		expect(runs[0].id).toBe("run-3");
		expect(runs[1].id).toBe("run-2");
	});

	it("returns plain objects (not references to internal state)", () => {
		const store = createRunStore({ path: join(tmpDir, "runs.jsonl") });
		store.create("run-ref", "test", null);

		const [run1] = store.list();
		// Mutate the returned object
		(run1 as Record<string, unknown>).prompt = "mutated";

		// Internal state should be unaffected
		const [run2] = store.list();
		expect(run2.prompt).toBe("test");
	});

	// -------------------------------------------------------------------------
	// eviction
	// -------------------------------------------------------------------------

	it("evicts oldest completed entry when at max capacity", () => {
		const store = createRunStore({
			path: join(tmpDir, "runs.jsonl"),
			maxEntries: 3,
		});
		store.create("run-a", "first", null);
		store.complete("run-a");
		store.create("run-b", "second", null);
		store.create("run-c", "third", null);
		store.create("run-d", "fourth", null); // evicts run-a (completed)

		const runs = store.list(10);
		const ids = runs.map((r) => r.id);
		expect(ids).not.toContain("run-a");
		expect(ids).toContain("run-b");
		expect(ids).toContain("run-c");
		expect(ids).toContain("run-d");
		expect(runs.length).toBe(3);
	});

	it("skips running entries during eviction and evicts next completed one", () => {
		const store = createRunStore({
			path: join(tmpDir, "runs.jsonl"),
			maxEntries: 3,
		});
		store.create("run-a", "first", null); // still running
		store.create("run-b", "second", null);
		store.complete("run-b");
		store.create("run-c", "third", null);
		store.create("run-d", "fourth", null); // should evict run-b (completed), not run-a (running)

		const runs = store.list(10);
		const ids = runs.map((r) => r.id);
		expect(ids).toContain("run-a"); // running — protected
		expect(ids).not.toContain("run-b"); // completed — evicted
		expect(ids).toContain("run-c");
		expect(ids).toContain("run-d");
	});

	it("preserves complete/fail calls for still-running entries after eviction of others", () => {
		const store = createRunStore({
			path: join(tmpDir, "runs.jsonl"),
			maxEntries: 2,
		});
		store.create("run-a", "first", null);
		store.create("run-b", "second", null);
		store.complete("run-b"); // run-b completed
		store.create("run-c", "third", null); // evicts run-b

		// run-a should still be completable
		store.complete("run-a");
		const runs = store.list(10);
		const runA = runs.find((r) => r.id === "run-a");
		expect(runA?.status).toBe("completed");
	});

	// -------------------------------------------------------------------------
	// JSONL persistence
	// -------------------------------------------------------------------------

	it("persists runs to JSONL file", () => {
		const filePath = join(tmpDir, "runs.jsonl");
		const store = createRunStore({ path: filePath });
		store.create("run-p", "persist me", "model-x", 2);

		expect(existsSync(filePath)).toBe(true);
		const lines = readFileSync(filePath, "utf-8").trim().split("\n");
		expect(lines.length).toBe(1);
		const parsed = JSON.parse(lines[0]);
		expect(parsed.id).toBe("run-p");
		expect(parsed.prompt).toBe("persist me");
		expect(parsed.status).toBe("running");
		expect(parsed.filesCount).toBe(2);
	});

	it("appends updated run to JSONL on complete", () => {
		const filePath = join(tmpDir, "runs.jsonl");
		const store = createRunStore({ path: filePath });
		store.create("run-app", "prompt", null);
		store.complete("run-app", { costUsd: 0.1 });

		const lines = readFileSync(filePath, "utf-8").trim().split("\n");
		expect(lines.length).toBe(2);
		const second = JSON.parse(lines[1]);
		expect(second.status).toBe("completed");
		expect(second.costUsd).toBe(0.1);
	});

	it("creates parent directory for JSONL if needed", () => {
		const filePath = join(tmpDir, "nested", "dir", "runs.jsonl");
		const store = createRunStore({ path: filePath });
		store.create("run-dir", "prompt", null);

		expect(existsSync(filePath)).toBe(true);
	});

	// -------------------------------------------------------------------------
	// JSONL reload
	// -------------------------------------------------------------------------

	it("reloads runs from existing JSONL file", () => {
		const filePath = join(tmpDir, "runs.jsonl");

		// First store instance — write some runs
		const store1 = createRunStore({ path: filePath });
		store1.create("run-reload-a", "first run", "model-a");
		store1.complete("run-reload-a", { costUsd: 0.02 });
		store1.create("run-reload-b", "second run", "model-b");

		// Second store instance — should reload from file
		const store2 = createRunStore({ path: filePath });
		const runs = store2.list(10);
		expect(runs.length).toBe(2);
		const ids = runs.map((r) => r.id);
		expect(ids).toContain("run-reload-a");
		expect(ids).toContain("run-reload-b");
	});

	it("last-write-wins on reload (duplicate IDs)", () => {
		const filePath = join(tmpDir, "runs.jsonl");

		// First store writes initial state
		const store1 = createRunStore({ path: filePath });
		store1.create("run-dup", "original prompt", "model-1");
		store1.complete("run-dup", { costUsd: 0.05, numTurns: 2 });

		// Second store loads and verifies the completed state wins
		const store2 = createRunStore({ path: filePath });
		const runs = store2.list();
		const run = runs.find((r) => r.id === "run-dup");
		expect(run).toBeDefined();
		// The completed state (later line in JSONL) should win
		expect(run?.status).toBe("completed");
		expect(run?.costUsd).toBe(0.05);
	});

	it("handles missing JSONL file gracefully", () => {
		const filePath = join(tmpDir, "does-not-exist.jsonl");
		// Should not throw
		const store = createRunStore({ path: filePath });
		expect(store.list()).toEqual([]);
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it("reloads only the most recent maxEntries runs", () => {
		const filePath = join(tmpDir, "runs.jsonl");

		// Create 5 runs in store1
		const store1 = createRunStore({ path: filePath, maxEntries: 10 });
		for (let i = 1; i <= 5; i++) {
			store1.create(`run-${i}`, `prompt ${i}`, null);
		}

		// Reload with maxEntries=3 — should only keep last 3
		const store2 = createRunStore({ path: filePath, maxEntries: 3 });
		const runs = store2.list(10);
		expect(runs.length).toBe(3);
		const ids = runs.map((r) => r.id);
		expect(ids).toContain("run-5");
		expect(ids).toContain("run-4");
		expect(ids).toContain("run-3");
		expect(ids).not.toContain("run-1");
		expect(ids).not.toContain("run-2");
	});
});
