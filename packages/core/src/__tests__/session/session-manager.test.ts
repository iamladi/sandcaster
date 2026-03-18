import { afterEach, describe, expect, it, vi } from "vitest";
import type { SandboxInstance } from "../../sandbox-provider.js";
import type { SandcasterEvent, SessionCreateRequest } from "../../schemas.js";
import { SessionError, SessionManager } from "../../session/session-manager.js";
import type { ISessionStore } from "../../session/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createFakeSandbox(): SandboxInstance {
	return {
		workDir: "/home/user",
		capabilities: {
			fileSystem: true,
			shellExec: true,
			envInjection: true,
			streaming: true,
			networkPolicy: false,
			snapshots: false,
			reconnect: false,
			customImage: false,
		},
		files: {
			write: vi.fn().mockResolvedValue(undefined),
			read: vi.fn().mockResolvedValue(""),
		},
		commands: {
			run: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
		},
		kill: vi.fn().mockResolvedValue(undefined),
	};
}

function createFakeRunAgent(
	events?: SandcasterEvent[],
): (...args: unknown[]) => AsyncGenerator<SandcasterEvent> {
	const defaultEvents: SandcasterEvent[] = events ?? [
		{ type: "assistant", content: "Hello" },
		{
			type: "result",
			content: "Done",
			costUsd: 0.01,
			numTurns: 1,
			durationSecs: 1.5,
		},
	];
	return async function* () {
		for (const event of defaultEvents) {
			yield event;
		}
	};
}

function createFakeStore(
	initial: Array<import("../../schemas.js").SessionRecord> = [],
): ISessionStore {
	const records = new Map(initial.map((r) => [r.id, { ...r }]));
	const order: string[] = initial.map((r) => r.id);

	return {
		create(record) {
			records.set(record.id, { ...record });
			order.push(record.id);
		},
		get(id) {
			return records.get(id);
		},
		update(id, updates) {
			const existing = records.get(id);
			if (existing) {
				Object.assign(existing, updates, {
					lastActivityAt: new Date().toISOString(),
				});
			}
		},
		list(limit = 50) {
			const ids = order.slice(-limit).reverse();
			return ids.map((id) => ({ ...records.get(id)! }));
		},
		delete(id) {
			records.delete(id);
			const idx = order.indexOf(id);
			if (idx !== -1) order.splice(idx, 1);
		},
		getActiveRecords() {
			const activeStatuses = new Set(["initializing", "active", "running"]);
			return order
				.map((id) => records.get(id)!)
				.filter((r) => r && activeStatuses.has(r.status));
		},
		activeCount() {
			const activeStatuses = new Set(["initializing", "active", "running"]);
			return order.filter((id) => {
				const r = records.get(id);
				return r && activeStatuses.has(r.status);
			}).length;
		},
	};
}

function makeSessionCreateRequest(
	overrides: Partial<SessionCreateRequest> = {},
): SessionCreateRequest {
	return {
		prompt: "Hello, world",
		...overrides,
	};
}

function makeSessionRecord(
	overrides: Partial<import("../../schemas.js").SessionRecord> = {},
): import("../../schemas.js").SessionRecord {
	return {
		id: "sess_test-1234",
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

async function collectEvents(
	gen: AsyncGenerator<SandcasterEvent>,
): Promise<SandcasterEvent[]> {
	const events: SandcasterEvent[] = [];
	for await (const event of gen) {
		events.push(event);
	}
	return events;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SessionManager", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	// -------------------------------------------------------------------------
	// Test 1: createSession creates a session with status active
	// -------------------------------------------------------------------------

	it("createSession creates a session with status active and correct ID format", async () => {
		const sandbox = createFakeSandbox();
		const store = createFakeStore();
		const manager = new SessionManager({
			store,
			sandboxFactory: vi.fn().mockResolvedValue(sandbox),
			runAgent: createFakeRunAgent(),
		});

		const { sessionId, events } = await manager.createSession(
			makeSessionCreateRequest({ prompt: "hi" }),
		);
		await collectEvents(events);

		expect(sessionId).toMatch(/^sess_[a-z]+-[a-z]+-\d{4}$/);
		const session = manager.getSession(sessionId);
		expect(session).toBeDefined();
		expect(session?.status).toBe("active");
		expect(session?.id).toBe(sessionId);
	});

	// -------------------------------------------------------------------------
	// Test 2: createSession runs first message and yields events
	// -------------------------------------------------------------------------

	it("createSession with prompt yields session_created event then agent events", async () => {
		const sandbox = createFakeSandbox();
		const store = createFakeStore();
		const agentEvents: SandcasterEvent[] = [
			{ type: "assistant", content: "Hello" },
			{
				type: "result",
				content: "Done",
				costUsd: 0.01,
				numTurns: 1,
				durationSecs: 1.5,
			},
		];
		const manager = new SessionManager({
			store,
			sandboxFactory: vi.fn().mockResolvedValue(sandbox),
			runAgent: createFakeRunAgent(agentEvents),
		});

		const { sessionId, events } = await manager.createSession(
			makeSessionCreateRequest({ prompt: "Hello" }),
		);
		const collected = await collectEvents(events);

		// First event must be session_created
		expect(collected[0]).toMatchObject({
			type: "session_created",
			sessionId,
		});
		// Subsequent events come from agent
		const agentCollected = collected.slice(1);
		expect(agentCollected).toHaveLength(agentEvents.length);
		expect(agentCollected[0]).toMatchObject({ type: "assistant" });
		expect(agentCollected[1]).toMatchObject({ type: "result" });
	});

	// -------------------------------------------------------------------------
	// Test 3: createSession atomic failure — sandbox factory throws
	// -------------------------------------------------------------------------

	it("createSession marks session as failed when sandbox factory throws", async () => {
		const store = createFakeStore();
		const manager = new SessionManager({
			store,
			sandboxFactory: vi.fn().mockRejectedValue(new Error("E2B unavailable")),
			runAgent: createFakeRunAgent(),
		});

		await expect(
			manager.createSession(makeSessionCreateRequest()),
		).rejects.toThrow();

		// The store should have a record with status "failed"
		const records = store.list(10);
		expect(records.length).toBe(1);
		expect(records[0].status).toBe("failed");
	});

	// -------------------------------------------------------------------------
	// Test 4: sendMessage reuses existing sandbox (no kill between messages)
	// -------------------------------------------------------------------------

	it("sendMessage reuses existing sandbox and does not kill it between messages", async () => {
		const sandbox = createFakeSandbox();
		const store = createFakeStore();
		const manager = new SessionManager({
			store,
			sandboxFactory: vi.fn().mockResolvedValue(sandbox),
			runAgent: createFakeRunAgent(),
		});

		const { sessionId, events: createEvents } = await manager.createSession(
			makeSessionCreateRequest({ prompt: "first" }),
		);
		await collectEvents(createEvents);

		const msgEvents = await manager.sendMessage(sessionId, {
			prompt: "second",
		});
		await collectEvents(msgEvents);

		expect(sandbox.kill).not.toHaveBeenCalled();
	});

	// -------------------------------------------------------------------------
	// Test 5: sendMessage rejects with SESSION_BUSY when mutex locked
	// -------------------------------------------------------------------------

	it("sendMessage rejects with SESSION_BUSY when another message is running", async () => {
		const sandbox = createFakeSandbox();
		const store = createFakeStore();

		// Create a slow agent that we can control
		let resolveAgent!: () => void;
		const slowAgent = async function* (): AsyncGenerator<SandcasterEvent> {
			await new Promise<void>((resolve) => {
				resolveAgent = resolve;
			});
			yield {
				type: "result",
				content: "Done",
				costUsd: 0,
				numTurns: 1,
				durationSecs: 0,
			} satisfies SandcasterEvent;
		};

		const manager = new SessionManager({
			store,
			sandboxFactory: vi.fn().mockResolvedValue(sandbox),
			runAgent: createFakeRunAgent(),
		});

		// Create session without prompt so it's immediately active
		const { sessionId, events: createEvents } = await manager.createSession(
			makeSessionCreateRequest({ prompt: undefined }),
		);
		await collectEvents(createEvents);

		// Override runAgent to the slow one for the next call
		(manager as unknown as { opts: { runAgent: unknown } }).opts.runAgent =
			slowAgent;

		// Start first message (slow, won't complete yet)
		const firstMsgPromise = manager.sendMessage(sessionId, {
			prompt: "slow message",
		});
		// Small tick to let the generator start
		await new Promise((r) => setTimeout(r, 0));

		// Second message should be rejected immediately with SESSION_BUSY
		await expect(
			manager.sendMessage(sessionId, { prompt: "concurrent message" }),
		).rejects.toMatchObject({ code: "SESSION_BUSY" });

		// Clean up — resolve the first agent
		resolveAgent();
		const gen = await firstMsgPromise;
		await collectEvents(gen);
	});

	// -------------------------------------------------------------------------
	// Test 6: sendMessage updates conversation history with user turn
	// -------------------------------------------------------------------------

	it("sendMessage adds user turn to conversation history", async () => {
		const sandbox = createFakeSandbox();
		const store = createFakeStore();
		const manager = new SessionManager({
			store,
			sandboxFactory: vi.fn().mockResolvedValue(sandbox),
			runAgent: createFakeRunAgent(),
		});

		const { sessionId, events: createEvents } = await manager.createSession(
			makeSessionCreateRequest({ prompt: undefined }),
		);
		await collectEvents(createEvents);

		const msgEvents = await manager.sendMessage(sessionId, {
			prompt: "tell me a joke",
		});
		await collectEvents(msgEvents);

		const active = manager.getActiveSession(sessionId);
		expect(active).toBeDefined();
		const userTurns = active!.history.filter((t) => t.role === "user");
		expect(userTurns.length).toBeGreaterThanOrEqual(1);
		expect(userTurns.some((t) => t.content.includes("tell me a joke"))).toBe(
			true,
		);
	});

	// -------------------------------------------------------------------------
	// Test 7: sendMessage adds assistant content to history
	// -------------------------------------------------------------------------

	it("sendMessage adds assistant turn to history from agent events", async () => {
		const sandbox = createFakeSandbox();
		const store = createFakeStore();
		const manager = new SessionManager({
			store,
			sandboxFactory: vi.fn().mockResolvedValue(sandbox),
			runAgent: createFakeRunAgent([
				{ type: "assistant", content: "Here is a joke!" },
				{
					type: "result",
					content: "Done",
					costUsd: 0,
					numTurns: 1,
					durationSecs: 0,
				},
			]),
		});

		const { sessionId, events: createEvents } = await manager.createSession(
			makeSessionCreateRequest({ prompt: undefined }),
		);
		await collectEvents(createEvents);

		const msgEvents = await manager.sendMessage(sessionId, {
			prompt: "tell me a joke",
		});
		await collectEvents(msgEvents);

		const active = manager.getActiveSession(sessionId);
		const assistantTurns = active!.history.filter(
			(t) => t.role === "assistant",
		);
		expect(assistantTurns.length).toBeGreaterThanOrEqual(1);
		expect(
			assistantTurns.some((t) => t.content.includes("Here is a joke!")),
		).toBe(true);
	});

	// -------------------------------------------------------------------------
	// Test 8: deleteSession kills sandbox and marks ended
	// -------------------------------------------------------------------------

	it("deleteSession kills sandbox and marks session as ended", async () => {
		const sandbox = createFakeSandbox();
		const store = createFakeStore();
		const manager = new SessionManager({
			store,
			sandboxFactory: vi.fn().mockResolvedValue(sandbox),
			runAgent: createFakeRunAgent(),
		});

		const { sessionId, events: createEvents } = await manager.createSession(
			makeSessionCreateRequest({ prompt: undefined }),
		);
		await collectEvents(createEvents);

		await manager.deleteSession(sessionId);

		expect(sandbox.kill).toHaveBeenCalledOnce();
		const record = store.get(sessionId);
		expect(record?.status).toBe("ended");
		// getSession returns terminal-state sessions (for API visibility)
		const session = manager.getSession(sessionId);
		expect(session?.status).toBe("ended");
	});

	// -------------------------------------------------------------------------
	// Test 9: deleteSession aborts active run
	// -------------------------------------------------------------------------

	it("deleteSession aborts an active run", async () => {
		const sandbox = createFakeSandbox();
		const store = createFakeStore();

		let abortSignal: AbortSignal | undefined;
		const slowAgent = async function* (
			_instance: SandboxInstance,
			_request: unknown,
			_config: unknown,
			signal?: AbortSignal,
		): AsyncGenerator<SandcasterEvent> {
			abortSignal = signal;
			// Wait for abort or a long time
			await new Promise<void>((resolve) => {
				if (signal) {
					signal.addEventListener("abort", () => resolve(), { once: true });
				}
				// Fallback after 10s
				setTimeout(resolve, 10_000);
			});
			yield {
				type: "result",
				content: "Aborted",
				costUsd: 0,
				numTurns: 0,
				durationSecs: 0,
			} satisfies SandcasterEvent;
		};

		const manager = new SessionManager({
			store,
			sandboxFactory: vi.fn().mockResolvedValue(sandbox),
			runAgent: createFakeRunAgent(),
		});

		const { sessionId, events: createEvents } = await manager.createSession(
			makeSessionCreateRequest({ prompt: undefined }),
		);
		await collectEvents(createEvents);

		// Switch to slow agent
		(manager as unknown as { opts: { runAgent: unknown } }).opts.runAgent =
			slowAgent;

		// Start a long-running message
		const msgGenPromise = manager.sendMessage(sessionId, {
			prompt: "slow task",
		});

		// Give it a tick to start
		await new Promise((r) => setTimeout(r, 0));

		// Delete while running
		await manager.deleteSession(sessionId);

		// The abort signal should be aborted
		expect(abortSignal?.aborted).toBe(true);

		// Clean up — consume the generator
		const gen = await msgGenPromise;
		await collectEvents(gen);
	});

	// -------------------------------------------------------------------------
	// Test 10: idle timeout expires session
	// -------------------------------------------------------------------------

	it("idle timeout expires session after inactivity", async () => {
		vi.useFakeTimers();

		const sandbox = createFakeSandbox();
		const store = createFakeStore();
		const idleTimeoutMs = 5_000;
		const manager = new SessionManager({
			store,
			sandboxFactory: vi.fn().mockResolvedValue(sandbox),
			runAgent: createFakeRunAgent(),
			idleTimeoutMs,
		});

		const { sessionId, events: createEvents } = await manager.createSession(
			makeSessionCreateRequest({ prompt: undefined }),
		);
		await collectEvents(createEvents);

		// Verify session is active before timeout
		expect(manager.getSession(sessionId)?.status).toBe("active");

		// Advance time past idle timeout
		await vi.advanceTimersByTimeAsync(idleTimeoutMs + 100);

		// Session should be expired
		const record = store.get(sessionId);
		expect(record?.status).toBe("expired");
		// Active session should be removed from in-memory map
		expect(manager.getActiveSession(sessionId)).toBeUndefined();
	});

	// -------------------------------------------------------------------------
	// Test 11: idle timeout suspended during active run
	// -------------------------------------------------------------------------

	it("idle timeout is suspended during active run and restarted after completion", async () => {
		vi.useFakeTimers();

		const sandbox = createFakeSandbox();
		const store = createFakeStore();
		const idleTimeoutMs = 3_000;

		let resolveAgent!: () => void;
		const slowAgent = async function* (): AsyncGenerator<SandcasterEvent> {
			await new Promise<void>((resolve) => {
				resolveAgent = resolve;
			});
			yield {
				type: "result",
				content: "Done",
				costUsd: 0,
				numTurns: 1,
				durationSecs: 0,
			} satisfies SandcasterEvent;
		};

		const manager = new SessionManager({
			store,
			sandboxFactory: vi.fn().mockResolvedValue(sandbox),
			runAgent: createFakeRunAgent(),
			idleTimeoutMs,
		});

		const { sessionId, events: createEvents } = await manager.createSession(
			makeSessionCreateRequest({ prompt: undefined }),
		);
		await collectEvents(createEvents);

		// Switch to slow agent
		(manager as unknown as { opts: { runAgent: unknown } }).opts.runAgent =
			slowAgent;

		// Start a slow message — timer should be cleared during run
		const msgGenPromise = manager.sendMessage(sessionId, { prompt: "slow" });
		await vi.advanceTimersByTimeAsync(0);

		// Advance past idle timeout — session should NOT expire because run is active
		await vi.advanceTimersByTimeAsync(idleTimeoutMs + 100);
		expect(store.get(sessionId)?.status).toBe("running");

		// Complete the run
		resolveAgent();
		const gen = await msgGenPromise;
		await collectEvents(gen);
		await vi.advanceTimersByTimeAsync(0);

		// Now session is active again, timer restarted
		expect(store.get(sessionId)?.status).toBe("active");

		// Advance past idle timeout again — NOW it should expire
		await vi.advanceTimersByTimeAsync(idleTimeoutMs + 100);
		expect(store.get(sessionId)?.status).toBe("expired");
	});

	// -------------------------------------------------------------------------
	// Test 12: getSession returns undefined for unknown ID
	// -------------------------------------------------------------------------

	it("getSession returns undefined for unknown session ID", async () => {
		const store = createFakeStore();
		const manager = new SessionManager({
			store,
			sandboxFactory: vi.fn(),
			runAgent: createFakeRunAgent(),
		});

		expect(manager.getSession("sess_nonexistent-1234")).toBeUndefined();
	});

	// -------------------------------------------------------------------------
	// Test 13: listSessions delegates to store
	// -------------------------------------------------------------------------

	it("listSessions returns records from the store", async () => {
		const records = [
			makeSessionRecord({ id: "sess_a-1234" }),
			makeSessionRecord({ id: "sess_b-5678" }),
		];
		const store = createFakeStore(records);
		const manager = new SessionManager({
			store,
			sandboxFactory: vi.fn(),
			runAgent: createFakeRunAgent(),
		});

		const listed = manager.listSessions();
		const ids = listed.map((r) => r.id);
		expect(ids).toContain("sess_a-1234");
		expect(ids).toContain("sess_b-5678");
	});

	// -------------------------------------------------------------------------
	// Test 14: initialize kills orphaned sandboxes
	// -------------------------------------------------------------------------

	it("initialize marks orphaned active sessions as expired", async () => {
		const orphanRecord = makeSessionRecord({
			id: "sess_orphan-1234",
			status: "active",
			sandboxId: "sandbox-orphan",
		});
		const store = createFakeStore([orphanRecord]);
		const sandboxFactory = vi.fn();
		const manager = new SessionManager({
			store,
			sandboxFactory,
			runAgent: createFakeRunAgent(),
		});

		await manager.initialize();

		// After initialize, the orphaned session should be expired
		const record = store.get("sess_orphan-1234");
		expect(record?.status).toBe("expired");
	});

	// -------------------------------------------------------------------------
	// Test 15: session capacity limit
	// -------------------------------------------------------------------------

	it("createSession throws SESSION_CAPACITY_EXCEEDED when at max capacity", async () => {
		const store = createFakeStore();
		const manager = new SessionManager({
			store,
			sandboxFactory: vi.fn().mockResolvedValue(createFakeSandbox()),
			runAgent: createFakeRunAgent(),
			maxActiveSessions: 2,
		});

		// Create 2 sessions (at capacity)
		const s1 = await manager.createSession(
			makeSessionCreateRequest({ prompt: undefined }),
		);
		await collectEvents(s1.events);

		const s2 = await manager.createSession(
			makeSessionCreateRequest({ prompt: undefined }),
		);
		await collectEvents(s2.events);

		// Third should fail
		await expect(
			manager.createSession(makeSessionCreateRequest({ prompt: undefined })),
		).rejects.toMatchObject({ code: "SESSION_CAPACITY_EXCEEDED" });
	});

	// -------------------------------------------------------------------------
	// Test 16: sendMessage throws SESSION_NOT_FOUND for unknown session
	// -------------------------------------------------------------------------

	it("sendMessage throws SESSION_NOT_FOUND for unknown session ID", async () => {
		const store = createFakeStore();
		const manager = new SessionManager({
			store,
			sandboxFactory: vi.fn(),
			runAgent: createFakeRunAgent(),
		});

		await expect(
			manager.sendMessage("sess_nonexistent-1234", { prompt: "hi" }),
		).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
	});

	// -------------------------------------------------------------------------
	// Test 17: shutdown kills all active sessions
	// -------------------------------------------------------------------------

	it("shutdown kills all active sandbox instances", async () => {
		const sandbox1 = createFakeSandbox();
		const sandbox2 = createFakeSandbox();
		const sandboxes = [sandbox1, sandbox2];
		let callCount = 0;
		const store = createFakeStore();
		const manager = new SessionManager({
			store,
			sandboxFactory: vi.fn().mockImplementation(() => {
				return Promise.resolve(sandboxes[callCount++]);
			}),
			runAgent: createFakeRunAgent(),
		});

		const s1 = await manager.createSession(
			makeSessionCreateRequest({ prompt: undefined }),
		);
		await collectEvents(s1.events);

		const s2 = await manager.createSession(
			makeSessionCreateRequest({ prompt: undefined }),
		);
		await collectEvents(s2.events);

		await manager.shutdown();

		expect(sandbox1.kill).toHaveBeenCalled();
		expect(sandbox2.kill).toHaveBeenCalled();
	});

	// -------------------------------------------------------------------------
	// Test 18: SessionError has correct name and code
	// -------------------------------------------------------------------------

	it("SessionError has correct name and code properties", () => {
		const err = new SessionError("test message", "SESSION_NOT_FOUND");
		expect(err).toBeInstanceOf(Error);
		expect(err.name).toBe("SessionError");
		expect(err.code).toBe("SESSION_NOT_FOUND");
		expect(err.message).toBe("test message");
	});

	// -------------------------------------------------------------------------
	// Test 19: failed run records status "error" (F3)
	// -------------------------------------------------------------------------

	it("records run with status 'error' when agent throws", async () => {
		const sandbox = createFakeSandbox();
		const store = createFakeStore();
		const throwingAgent = async function* (): AsyncGenerator<SandcasterEvent> {
			yield {
				type: "assistant",
				content: "Starting...",
			} satisfies SandcasterEvent;
			throw new Error("LLM provider down");
		};

		const manager = new SessionManager({
			store,
			sandboxFactory: vi.fn().mockResolvedValue(sandbox),
			runAgent: createFakeRunAgent(),
		});

		const { sessionId, events: createEvents } = await manager.createSession(
			makeSessionCreateRequest({ prompt: undefined }),
		);
		await collectEvents(createEvents);

		// Switch to throwing agent
		(manager as unknown as { opts: { runAgent: unknown } }).opts.runAgent =
			throwingAgent;

		const msgEvents = await manager.sendMessage(sessionId, {
			prompt: "crash",
		});
		const collected = await collectEvents(msgEvents);

		// Should have yielded an error event
		expect(collected.some((e) => e.type === "error")).toBe(true);

		// The run should be recorded with status "error", not "completed"
		const active = manager.getActiveSession(sessionId);
		expect(active!.session.runs).toHaveLength(1);
		expect(active!.session.runs[0].status).toBe("error");
	});

	// -------------------------------------------------------------------------
	// Test 20: eagerBuffer preserves all events under load (F1)
	// -------------------------------------------------------------------------

	it("preserves all events when agent generates more than buffer limit", async () => {
		const sandbox = createFakeSandbox();
		const store = createFakeStore();

		// Generate 1100 events (> MAX_EAGER_BUFFER of 1000)
		const eventCount = 1100;
		const manyEvents: SandcasterEvent[] = [];
		for (let i = 0; i < eventCount - 1; i++) {
			manyEvents.push({
				type: "assistant",
				content: `token-${i}`,
			} satisfies SandcasterEvent);
		}
		manyEvents.push({
			type: "result",
			content: "Done",
			costUsd: 0,
			numTurns: 1,
			durationSecs: 0,
		} satisfies SandcasterEvent);

		const manager = new SessionManager({
			store,
			sandboxFactory: vi.fn().mockResolvedValue(sandbox),
			runAgent: createFakeRunAgent(manyEvents),
		});

		const { events } = await manager.createSession(
			makeSessionCreateRequest({ prompt: "hi" }),
		);

		// Delay consumer so the producer fills the buffer before we start pulling.
		// Without backpressure, events beyond MAX_EAGER_BUFFER (1000) are dropped.
		await new Promise((resolve) => setTimeout(resolve, 100));

		const collected = await collectEvents(events);

		// +1 for session_created event
		expect(collected).toHaveLength(eventCount + 1);
		// The last event must be the result — not dropped
		expect(collected[collected.length - 1]).toMatchObject({
			type: "result",
		});
	});

	// -------------------------------------------------------------------------
	// Test 21: consumer disconnect unblocks backpressured producer (F1-fix)
	// -------------------------------------------------------------------------

	it("cleans up producer when consumer disconnects mid-stream under backpressure", async () => {
		const sandbox = createFakeSandbox();
		const store = createFakeStore();

		// Track whether the source generator was properly closed
		let sourceReturnCalled = false;

		// Generate 1100 events to trigger backpressure (> MAX_EAGER_BUFFER of 1000)
		const slowAgent = async function* (): AsyncGenerator<SandcasterEvent> {
			try {
				for (let i = 0; i < 1100; i++) {
					yield {
						type: "assistant",
						content: `token-${i}`,
					} satisfies SandcasterEvent;
				}
				yield {
					type: "result",
					content: "Done",
					costUsd: 0,
					numTurns: 1,
					durationSecs: 0,
				} satisfies SandcasterEvent;
			} finally {
				sourceReturnCalled = true;
			}
		};

		const manager = new SessionManager({
			store,
			sandboxFactory: vi.fn().mockResolvedValue(sandbox),
			runAgent: slowAgent,
		});

		const { sessionId, events } = await manager.createSession(
			makeSessionCreateRequest({ prompt: "hi" }),
		);

		// Pull a few events then disconnect (call .return() on the iterator)
		const iter = events[Symbol.asyncIterator]();
		const first = await iter.next(); // session_created
		expect(first.value).toMatchObject({ type: "session_created" });
		const second = await iter.next(); // first assistant token
		expect(second.value).toMatchObject({ type: "assistant" });

		// Simulate client disconnect
		await iter.return!(undefined);

		// Give the producer time to unblock and clean up
		await new Promise((resolve) => setTimeout(resolve, 200));

		// The source generator's finally block should have run
		expect(sourceReturnCalled).toBe(true);

		// Session should NOT be stuck in "running" — it should have finalized
		const active = manager.getActiveSession(sessionId);
		expect(active!.session.status).not.toBe("running");
	});
});
