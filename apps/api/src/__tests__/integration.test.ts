import { createHmac } from "node:crypto";
import type { RunOptions, SandcasterEvent } from "@sandcaster/core";
import { createRunStore } from "@sandcaster/core";
import { describe, expect, test } from "vitest";
import { createApp } from "../app.js";

async function* fakeRunAgent(
	_options: RunOptions,
): AsyncGenerator<SandcasterEvent> {
	yield { type: "system", subtype: "init", content: "Agent starting" };
	yield { type: "assistant", content: "I'll help you with that." };
	yield {
		type: "result",
		content: "Task completed",
		costUsd: 0.05,
		numTurns: 3,
		model: "claude-sonnet-4-20250514",
	};
}

const API_KEY = "test-api-key-that-is-32-chars-ok";
const WEBHOOK_SECRET = "webhook-secret-for-integration-test";

function createTestApp() {
	return createApp({
		runAgent: fakeRunAgent,
		runStore: createRunStore({
			path: `/tmp/sandcaster-integration-${crypto.randomUUID()}.jsonl`,
		}),
		apiKey: API_KEY,
		webhookSecret: WEBHOOK_SECRET,
		version: "0.1.0",
		corsOrigins: ["http://localhost:3000"],
	});
}

describe("integration: full request lifecycle", () => {
	test("health is public, returns version", async () => {
		const app = createTestApp();
		const res = await app.request("/health");

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ status: "ok", version: "0.1.0" });
		expect(res.headers.get("X-Request-ID")).toBeTruthy();
	});

	test("query requires auth, streams SSE, updates store", async () => {
		const app = createTestApp();

		// Without auth → 401
		const noAuth = await app.request("/query", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ prompt: "hello" }),
		});
		expect(noAuth.status).toBe(401);

		// With auth → SSE stream
		const res = await app.request("/query", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${API_KEY}`,
			},
			body: JSON.stringify({ prompt: "hello" }),
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toContain("text/event-stream");

		const text = await res.text();
		expect(text).toContain("event: system");
		expect(text).toContain("event: assistant");
		expect(text).toContain("event: result");

		// Verify runs are tracked
		const runsRes = await app.request("/runs", {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		expect(runsRes.status).toBe(200);
		const runs = await runsRes.json();
		expect(runs).toHaveLength(1);
		expect(runs[0].status).toBe("completed");
	});

	test("webhook verifies HMAC and logs event", async () => {
		const app = createTestApp();
		const body = JSON.stringify({
			type: "sandbox.lifecycle.created",
			sandboxId: "sbx-test",
		});
		const signature = createHmac("sha256", WEBHOOK_SECRET)
			.update(body)
			.digest("hex");

		const res = await app.request("/webhooks/e2b", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"e2b-signature": signature,
			},
			body,
		});

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ status: "ok" });
	});
});
