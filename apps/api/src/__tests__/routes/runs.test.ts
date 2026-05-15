import { createRunStore } from "@sandcaster/core";
import { describe, expect, test } from "vitest";
import { createApp } from "../../app.js";

describe("GET /runs", () => {
	test("returns empty array when no runs exist", async () => {
		const runStore = createRunStore({
			path: `/tmp/sandcaster-test-${crypto.randomUUID()}.jsonl`,
		});
		const app = createApp({ runStore });
		const res = await app.request("/runs");

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual([]);
	});

	test("returns runs from store", async () => {
		const runStore = createRunStore({
			path: `/tmp/sandcaster-test-${crypto.randomUUID()}.jsonl`,
		});
		runStore.create("run-1", "test prompt", "claude-sonnet-4-20250514");
		runStore.complete("run-1", { costUsd: 0.01 });

		const app = createApp({ runStore });
		const res = await app.request("/runs");

		const body = await res.json();
		expect(body).toHaveLength(1);
		expect(body[0].id).toBe("run-1");
		expect(body[0].status).toBe("completed");
	});

	test("respects limit query param", async () => {
		const runStore = createRunStore({
			path: `/tmp/sandcaster-test-${crypto.randomUUID()}.jsonl`,
		});
		runStore.create("run-1", "prompt 1", null);
		runStore.create("run-2", "prompt 2", null);
		runStore.create("run-3", "prompt 3", null);

		const app = createApp({ runStore });
		const res = await app.request("/runs?limit=2");

		const body = await res.json();
		expect(body).toHaveLength(2);
	});

	test("requires auth when apiKey is set", async () => {
		const app = createApp({ apiKey: "a-d3f5g6h7j8k9l0m1n2o3p4q5r6s7t8" });
		const res = await app.request("/runs");

		expect(res.status).toBe(401);
	});
});
