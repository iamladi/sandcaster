import { describe, expect, test } from "vitest";
import { createApp } from "../../app.js";

describe("bearer auth middleware", () => {
	test("rejects request with invalid token when apiKey is set", async () => {
		const app = createApp({ apiKey: "a]d3f5g6h7j8k9l0m1n2o3p4q5r6s7t8" });
		const res = await app.request("/runs", {
			headers: { Authorization: "Bearer wrong-key-xxxxxxxxxxxxxxxxxxxxx" },
		});
		expect(res.status).toBe(401);
	});

	test("allows request with valid token", async () => {
		const key = "a]d3f5g6h7j8k9l0m1n2o3p4q5r6s7t8";
		const app = createApp({ apiKey: key });
		const res = await app.request("/runs", {
			headers: { Authorization: `Bearer ${key}` },
		});
		// Should not be 401 — route may return 200 or other but not auth failure
		expect(res.status).not.toBe(401);
	});

	test("skips auth when apiKey is not set (dev mode)", async () => {
		const app = createApp({});
		const res = await app.request("/runs");
		// No auth header, no apiKey configured — should pass through
		expect(res.status).not.toBe(401);
	});

	test("health endpoint is public even when apiKey is set", async () => {
		const app = createApp({ apiKey: "a]d3f5g6h7j8k9l0m1n2o3p4q5r6s7t8" });
		const res = await app.request("/health");
		expect(res.status).toBe(200);
	});

	test("rejects request with no Authorization header when apiKey is set", async () => {
		const app = createApp({ apiKey: "a]d3f5g6h7j8k9l0m1n2o3p4q5r6s7t8" });
		const res = await app.request("/runs");
		expect(res.status).toBe(401);
	});

	test("throws when apiKey is shorter than MIN_KEY_LENGTH", () => {
		expect(() => createApp({ apiKey: "too-short" })).toThrow(
			/at least 32 characters/,
		);
	});

	test("throws when apiKey is 1 character", () => {
		expect(() => createApp({ apiKey: "x" })).toThrow(/at least 32 characters/);
	});

	test("accepts apiKey exactly at MIN_KEY_LENGTH", () => {
		expect(() => createApp({ apiKey: "a".repeat(32) })).not.toThrow();
	});
});

describe("request ID middleware", () => {
	test("adds X-Request-ID header to responses", async () => {
		const app = createApp({});
		const res = await app.request("/health");
		const requestId = res.headers.get("X-Request-ID");
		expect(requestId).toBeTruthy();
		// UUID v4 format
		expect(requestId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
		);
	});
});
