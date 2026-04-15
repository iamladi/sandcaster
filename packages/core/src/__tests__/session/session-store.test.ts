import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
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
import type { SessionRecord } from "../../schemas.js";
import { createSessionStore } from "../../session/session-store.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
	return {
		id: "sess_test-1",
		status: "active",
		sandboxProvider: "e2b",
		sandboxId: "sandbox-abc",
		createdAt: new Date().toISOString(),
		lastActivityAt: new Date().toISOString(),
		runsCount: 0,
		totalCostUsd: 0,
		totalTurns: 0,
		...overrides,
	};
}

describe("createSessionStore", () => {
	let tmpDir: string;
	let warnSpy: MockInstance;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "sandcaster-session-store-test-"));
		warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		warnSpy.mockRestore();
		rmSync(tmpDir, { recursive: true, force: true });
	});

	// -------------------------------------------------------------------------
	// create
	// -------------------------------------------------------------------------

	it("creates a session record and persists to JSONL", () => {
		const filePath = join(tmpDir, "sessions.jsonl");
		const store = createSessionStore({ path: filePath });
		const record = makeRecord({ id: "sess_create-1" });

		store.create(record);

		// In-memory: retrievable
		expect(store.get("sess_create-1")).toEqual(record);

		// Persisted: JSONL file exists and contains the record
		expect(existsSync(filePath)).toBe(true);
		const lines = readFileSync(filePath, "utf-8").trim().split("\n");
		expect(lines.length).toBe(1);
		const parsed = JSON.parse(lines[0]);
		expect(parsed.id).toBe("sess_create-1");
		expect(parsed.status).toBe("active");
	});

	// -------------------------------------------------------------------------
	// get
	// -------------------------------------------------------------------------

	it("returns undefined for an unknown ID", () => {
		const store = createSessionStore({ path: join(tmpDir, "sessions.jsonl") });
		expect(store.get("nonexistent-id")).toBeUndefined();
	});

	it("retrieves an existing session by ID", () => {
		const store = createSessionStore({ path: join(tmpDir, "sessions.jsonl") });
		const record = makeRecord({ id: "sess_get-1" });
		store.create(record);
		expect(store.get("sess_get-1")).toEqual(record);
	});

	// -------------------------------------------------------------------------
	// get disk fallback (evicted sessions)
	// -------------------------------------------------------------------------

	it("retrieves an evicted session by scanning the JSONL file", () => {
		const filePath = join(tmpDir, "sessions.jsonl");
		// maxEntries=1, one expired record gets evicted when a second is added
		const store = createSessionStore({ path: filePath, maxEntries: 1 });

		const evictable = makeRecord({ id: "sess_evict-1", status: "expired" });
		store.create(evictable);

		const newRecord = makeRecord({ id: "sess_new-1", status: "active" });
		store.create(newRecord); // evicts sess_evict-1

		// Not in memory anymore
		expect(store.get("sess_evict-1")).toBeUndefined();

		// Disk fallback: a new store with higher maxEntries can reload it
		const store2 = createSessionStore({ path: filePath, maxEntries: 100 });
		expect(store2.get("sess_evict-1")).toBeDefined();
	});

	// -------------------------------------------------------------------------
	// update
	// -------------------------------------------------------------------------

	it("merges updates into existing record and appends to JSONL", () => {
		const filePath = join(tmpDir, "sessions.jsonl");
		const store = createSessionStore({ path: filePath });
		const record = makeRecord({ id: "sess_update-1", status: "active" });
		store.create(record);

		const before = new Date().toISOString();
		store.update("sess_update-1", { status: "ended", totalTurns: 5 });
		const after = new Date().toISOString();

		const updated = store.get("sess_update-1");
		expect(updated).toBeDefined();
		expect(updated?.status).toBe("ended");
		expect(updated?.totalTurns).toBe(5);
		// lastActivityAt should be updated
		const lastActivity = updated!.lastActivityAt;
		expect(lastActivity >= before).toBe(true);
		expect(lastActivity <= after).toBe(true);

		// JSONL should now have 2 lines (create + update)
		const lines = readFileSync(filePath, "utf-8").trim().split("\n");
		expect(lines.length).toBe(2);
		const second = JSON.parse(lines[1]);
		expect(second.status).toBe("ended");
		expect(second.totalTurns).toBe(5);
	});

	// -------------------------------------------------------------------------
	// list
	// -------------------------------------------------------------------------

	it("lists sessions newest-first", () => {
		const store = createSessionStore({ path: join(tmpDir, "sessions.jsonl") });
		store.create(makeRecord({ id: "sess_a" }));
		store.create(makeRecord({ id: "sess_b" }));
		store.create(makeRecord({ id: "sess_c" }));

		const records = store.list();
		expect(records[0].id).toBe("sess_c");
		expect(records[1].id).toBe("sess_b");
		expect(records[2].id).toBe("sess_a");
	});

	it("lists with default limit of 50", () => {
		const store = createSessionStore({ path: join(tmpDir, "sessions.jsonl") });
		for (let i = 0; i < 60; i++) {
			store.create(makeRecord({ id: `sess_list-${i}` }));
		}
		expect(store.list().length).toBe(50);
	});

	it("lists with custom limit", () => {
		const store = createSessionStore({ path: join(tmpDir, "sessions.jsonl") });
		store.create(makeRecord({ id: "sess_x1" }));
		store.create(makeRecord({ id: "sess_x2" }));
		store.create(makeRecord({ id: "sess_x3" }));

		const records = store.list(2);
		expect(records.length).toBe(2);
		expect(records[0].id).toBe("sess_x3");
		expect(records[1].id).toBe("sess_x2");
	});

	it("returns copies not references", () => {
		const store = createSessionStore({ path: join(tmpDir, "sessions.jsonl") });
		store.create(makeRecord({ id: "sess_ref" }));

		const [rec1] = store.list();
		(rec1 as Record<string, unknown>).name = "mutated";

		const [rec2] = store.list();
		expect(rec2.name).toBeUndefined();
	});

	// -------------------------------------------------------------------------
	// delete
	// -------------------------------------------------------------------------

	it("removes a session from memory, get returns undefined after delete", () => {
		const store = createSessionStore({ path: join(tmpDir, "sessions.jsonl") });
		store.create(makeRecord({ id: "sess_del-1" }));
		store.delete("sess_del-1");
		expect(store.get("sess_del-1")).toBeUndefined();
	});

	it("does not remove from JSONL (append-only)", () => {
		const filePath = join(tmpDir, "sessions.jsonl");
		const store = createSessionStore({ path: filePath });
		store.create(makeRecord({ id: "sess_del-append" }));
		store.delete("sess_del-append");

		// JSONL still has the record
		const content = readFileSync(filePath, "utf-8").trim();
		expect(content).toContain("sess_del-append");
	});

	// -------------------------------------------------------------------------
	// eviction
	// -------------------------------------------------------------------------

	it("evicts oldest expired/ended session at max capacity", () => {
		const store = createSessionStore({
			path: join(tmpDir, "sessions.jsonl"),
			maxEntries: 2,
		});
		store.create(makeRecord({ id: "sess_ev-a", status: "ended" }));
		store.create(makeRecord({ id: "sess_ev-b", status: "active" }));
		// At capacity — should evict sess_ev-a (ended)
		store.create(makeRecord({ id: "sess_ev-c", status: "active" }));

		const records = store.list(10);
		const ids = records.map((r) => r.id);
		expect(ids).not.toContain("sess_ev-a");
		expect(ids).toContain("sess_ev-b");
		expect(ids).toContain("sess_ev-c");
	});

	it("never evicts active/initializing/running sessions", () => {
		const store = createSessionStore({
			path: join(tmpDir, "sessions.jsonl"),
			maxEntries: 3,
		});
		store.create(makeRecord({ id: "sess_prot-a", status: "active" }));
		store.create(makeRecord({ id: "sess_prot-b", status: "initializing" }));
		store.create(makeRecord({ id: "sess_prot-c", status: "running" }));
		// At max with no evictable — next create should throw
		expect(() =>
			store.create(makeRecord({ id: "sess_prot-d", status: "active" })),
		).toThrow("Session capacity limit reached");

		// Protected sessions still present
		const records = store.list(10);
		const ids = records.map((r) => r.id);
		expect(ids).toContain("sess_prot-a");
		expect(ids).toContain("sess_prot-b");
		expect(ids).toContain("sess_prot-c");
		expect(ids).not.toContain("sess_prot-d");
	});

	// -------------------------------------------------------------------------
	// JSONL reload
	// -------------------------------------------------------------------------

	it("reloads sessions from existing JSONL file", () => {
		const filePath = join(tmpDir, "sessions.jsonl");

		const store1 = createSessionStore({ path: filePath });
		store1.create(makeRecord({ id: "sess_reload-a", status: "active" }));
		store1.create(makeRecord({ id: "sess_reload-b", status: "ended" }));

		const store2 = createSessionStore({ path: filePath });
		const records = store2.list(10);
		const ids = records.map((r) => r.id);
		expect(ids).toContain("sess_reload-a");
		expect(ids).toContain("sess_reload-b");
	});

	it("last-write-wins on reload (duplicate IDs)", () => {
		const filePath = join(tmpDir, "sessions.jsonl");

		const store1 = createSessionStore({ path: filePath });
		store1.create(makeRecord({ id: "sess_dup", status: "active" }));
		store1.update("sess_dup", { status: "ended" });

		const store2 = createSessionStore({ path: filePath });
		const rec = store2.get("sess_dup");
		expect(rec?.status).toBe("ended");
	});

	it("skips malformed tail lines on reload (crash recovery)", () => {
		const filePath = join(tmpDir, "sessions.jsonl");

		// Write a valid line followed by a malformed one (simulates crash mid-write)
		const good = makeRecord({ id: "sess_crash-ok" });
		writeFileSync(filePath, `${JSON.stringify(good)}\nBAD_JSON_TAIL`, "utf-8");

		// Should not throw, should warn, should load the good record
		const store = createSessionStore({ path: filePath });
		expect(warnSpy).toHaveBeenCalled();
		expect(store.get("sess_crash-ok")).toBeDefined();
	});

	it("handles missing JSONL file gracefully", () => {
		const filePath = join(tmpDir, "does-not-exist.jsonl");
		const store = createSessionStore({ path: filePath });
		expect(store.list()).toEqual([]);
		expect(warnSpy).not.toHaveBeenCalled();
	});

	// -------------------------------------------------------------------------
	// getActiveRecords
	// -------------------------------------------------------------------------

	it("returns only active/initializing/running sessions", () => {
		const store = createSessionStore({ path: join(tmpDir, "sessions.jsonl") });
		store.create(makeRecord({ id: "sess_ar-init", status: "initializing" }));
		store.create(makeRecord({ id: "sess_ar-active", status: "active" }));
		store.create(makeRecord({ id: "sess_ar-running", status: "running" }));
		store.create(makeRecord({ id: "sess_ar-ended", status: "ended" }));
		store.create(makeRecord({ id: "sess_ar-expired", status: "expired" }));
		store.create(makeRecord({ id: "sess_ar-failed", status: "failed" }));

		const active = store.getActiveRecords();
		const ids = active.map((r) => r.id);
		expect(ids).toContain("sess_ar-init");
		expect(ids).toContain("sess_ar-active");
		expect(ids).toContain("sess_ar-running");
		expect(ids).not.toContain("sess_ar-ended");
		expect(ids).not.toContain("sess_ar-expired");
		expect(ids).not.toContain("sess_ar-failed");
	});

	// -------------------------------------------------------------------------
	// activeCount
	// -------------------------------------------------------------------------

	it("returns count of non-expired/ended sessions in memory", () => {
		const store = createSessionStore({ path: join(tmpDir, "sessions.jsonl") });
		store.create(makeRecord({ id: "sess_cnt-1", status: "active" }));
		store.create(makeRecord({ id: "sess_cnt-2", status: "running" }));
		store.create(makeRecord({ id: "sess_cnt-3", status: "ended" }));
		store.create(makeRecord({ id: "sess_cnt-4", status: "expired" }));
		store.create(makeRecord({ id: "sess_cnt-5", status: "failed" }));

		// active + running = 2; ended + expired + failed don't count
		expect(store.activeCount()).toBe(2);
	});
});
