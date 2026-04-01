import { describe, expect, test } from "vitest";
import { SessionPool } from "../session-pool.js";

describe("SessionPool", () => {
	describe("resolve", () => {
		test("returns undefined for unknown thread key", () => {
			const pool = new SessionPool();
			expect(pool.resolve("slack:C123:1234567890.000")).toBeUndefined();
		});

		test("returns session ID after register", () => {
			const pool = new SessionPool();
			pool.register("slack:C123:1234567890.000", "sess-abc");
			expect(pool.resolve("slack:C123:1234567890.000")).toBe("sess-abc");
		});
	});

	describe("register", () => {
		test("stores thread to session ID mapping", () => {
			const pool = new SessionPool();
			pool.register("discord:C456:M789", "sess-xyz");
			expect(pool.resolve("discord:C456:M789")).toBe("sess-xyz");
		});
	});

	describe("remove", () => {
		test("deletes the mapping by thread key", () => {
			const pool = new SessionPool();
			pool.register("telegram:42:100", "sess-qrs");
			pool.remove("telegram:42:100");
			expect(pool.resolve("telegram:42:100")).toBeUndefined();
		});

		test("does nothing when thread key is not found", () => {
			const pool = new SessionPool();
			// Should not throw
			expect(() => pool.remove("nonexistent:key")).not.toThrow();
		});
	});

	describe("removeBySessionId", () => {
		test("finds and removes the entry by session ID value", () => {
			const pool = new SessionPool();
			pool.register("slack:C123:1234567890.000", "sess-to-remove");
			pool.removeBySessionId("sess-to-remove");
			expect(pool.resolve("slack:C123:1234567890.000")).toBeUndefined();
		});

		test("does nothing when session ID is not found", () => {
			const pool = new SessionPool();
			pool.register("slack:C123:9999999.000", "sess-other");
			// Should not throw, and existing mapping should remain
			expect(() => pool.removeBySessionId("sess-nonexistent")).not.toThrow();
			expect(pool.resolve("slack:C123:9999999.000")).toBe("sess-other");
		});
	});

	describe("makeKey", () => {
		test("produces correct format for Slack: slack:{channelId}:{threadTs}", () => {
			expect(SessionPool.makeKey("slack", "C123ABC", "1234567890.000200")).toBe(
				"slack:C123ABC:1234567890.000200",
			);
		});

		test("produces correct format for Discord: discord:{channelId}:{messageId}", () => {
			expect(SessionPool.makeKey("discord", "987654321", "111222333")).toBe(
				"discord:987654321:111222333",
			);
		});

		test("produces correct format for Discord DM: discord:{channelId}:dm", () => {
			expect(SessionPool.makeKey("discord", "987654321", "dm")).toBe(
				"discord:987654321:dm",
			);
		});

		test("produces correct format for Telegram: telegram:{chatId}:{messageThreadId}", () => {
			expect(SessionPool.makeKey("telegram", "123456789", "42")).toBe(
				"telegram:123456789:42",
			);
		});

		test("produces correct format for Telegram root: telegram:{chatId}:root", () => {
			expect(SessionPool.makeKey("telegram", "123456789", "root")).toBe(
				"telegram:123456789:root",
			);
		});
	});

	describe("acquireMutex", () => {
		test("serializes concurrent access on the same thread key", async () => {
			const pool = new SessionPool();
			const threadKey = "slack:C123:1234567890.000";
			const order: number[] = [];

			const release1 = await pool.acquireMutex(threadKey);
			order.push(1);

			// Start second acquire — it will wait because mutex is held
			const acquire2Promise = pool.acquireMutex(threadKey).then((release) => {
				order.push(2);
				return release;
			});

			// Give the microtask queue a chance to run — acquire2 should NOT proceed
			await Promise.resolve();
			await Promise.resolve();
			expect(order).toEqual([1]);

			// Release the first lock — acquire2 should now proceed
			release1();

			const release2 = await acquire2Promise;
			expect(order).toEqual([1, 2]);

			release2();
		});

		test("does not block acquires on different thread keys", async () => {
			const pool = new SessionPool();
			const key1 = "slack:C123:1234567890.000";
			const key2 = "slack:C456:9876543210.000";

			const release1 = await pool.acquireMutex(key1);
			// Acquiring a different key should not block
			const release2 = await pool.acquireMutex(key2);

			expect(release1).toBeTypeOf("function");
			expect(release2).toBeTypeOf("function");

			release1();
			release2();
		});

		test("creates mutex lazily on first acquire", async () => {
			const pool = new SessionPool();
			const threadKey = "discord:999:888";
			// No prior state — should just work
			const release = await pool.acquireMutex(threadKey);
			expect(release).toBeTypeOf("function");
			release();
		});

		test("removeBySessionId does not break mutual exclusion for queued waiters", async () => {
			const pool = new SessionPool();
			const threadKey = "slack:C123:1234567890.000";
			const sessionId = "sess-test";
			pool.register(threadKey, sessionId);

			// M1 holds mutex
			const release1 = await pool.acquireMutex(threadKey);

			// M2 waits on the same mutex
			let m2Started = false;
			const m2Promise = pool.acquireMutex(threadKey).then((release) => {
				m2Started = true;
				return release;
			});

			// Let M2's acquire() enqueue
			await Promise.resolve();
			expect(m2Started).toBe(false);

			// Remove session — must NOT delete the mutex
			pool.removeBySessionId(sessionId);

			// M3 arrives — should wait on the SAME mutex, not get a new one
			let m3Started = false;
			const m3Promise = pool.acquireMutex(threadKey).then((release) => {
				m3Started = true;
				return release;
			});

			await Promise.resolve();
			await Promise.resolve();

			// M3 should NOT have started — M1 still holds the mutex
			expect(m3Started).toBe(false);

			// Release M1 — M2 should proceed, M3 still waiting
			release1();
			const release2 = await m2Promise;
			expect(m2Started).toBe(true);
			expect(m3Started).toBe(false);

			release2();
			const release3 = await m3Promise;
			expect(m3Started).toBe(true);
			release3();
		});
	});
});
