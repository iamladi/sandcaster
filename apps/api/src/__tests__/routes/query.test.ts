import type { RunOptions, SandcasterEvent } from "@sandcaster/core";
import { createRunStore } from "@sandcaster/core";
import { describe, expect, test } from "vitest";
import { createApp } from "../../app.js";

async function* fakeRunAgent(
	_options: RunOptions,
): AsyncGenerator<SandcasterEvent> {
	yield { type: "system", content: "Starting" };
	yield { type: "assistant", content: "Hello" };
	yield {
		type: "result",
		content: "Done",
		costUsd: 0.01,
		numTurns: 1,
		durationSecs: 42,
		model: "claude-sonnet-4-20250514",
	};
}

async function* errorRunAgentWithResult(
	_options: RunOptions,
): AsyncGenerator<SandcasterEvent> {
	yield { type: "system", content: "Starting" };
	yield {
		type: "result",
		content: "partial",
		durationSecs: 5,
	};
	throw new Error("Sandbox crashed");
}

async function* errorRunAgent(
	_options: RunOptions,
): AsyncGenerator<SandcasterEvent> {
	yield { type: "system", content: "Starting" };
	throw new Error("Sandbox crashed");
}

function postQuery(app: ReturnType<typeof createApp>, body: object) {
	return app.request("/query", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

describe("POST /query", () => {
	test("streams SSE events from runAgent", async () => {
		const app = createApp({ runAgent: fakeRunAgent });
		const res = await postQuery(app, { prompt: "hello" });

		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toContain("text/event-stream");

		const text = await res.text();
		expect(text).toContain("event: system");
		expect(text).toContain("event: assistant");
		expect(text).toContain("event: result");
		expect(text).toContain('"content":"Hello"');
	});

	test("sets Content-Encoding: Identity header", async () => {
		const app = createApp({ runAgent: fakeRunAgent });
		const res = await postQuery(app, { prompt: "hello" });

		expect(res.headers.get("Content-Encoding")).toBe("Identity");
	});

	test("returns 400 for missing prompt", async () => {
		const app = createApp({ runAgent: fakeRunAgent });
		const res = await postQuery(app, {});

		expect(res.status).toBe(400);
	});

	test("returns 400 for empty prompt", async () => {
		const app = createApp({ runAgent: fakeRunAgent });
		const res = await postQuery(app, { prompt: "" });

		expect(res.status).toBe(400);
	});

	test("sends error SSE event when runAgent throws", async () => {
		const app = createApp({ runAgent: errorRunAgent });
		const res = await postQuery(app, { prompt: "hello" });

		expect(res.status).toBe(200);
		const text = await res.text();
		expect(text).toContain("event: error");
		expect(text).toContain("Sandbox crashed");
	});

	test("tracks run lifecycle in store", async () => {
		const runStore = createRunStore({
			path: `/tmp/sandcaster-test-${crypto.randomUUID()}.jsonl`,
		});
		const app = createApp({ runAgent: fakeRunAgent, runStore });
		const res = await postQuery(app, { prompt: "hello" });
		await res.text(); // consume stream so lifecycle completes

		const runs = runStore.list();
		expect(runs).toHaveLength(1);
		expect(runs[0].status).toBe("completed");
		expect(runs[0].prompt).toBe("hello");
	});

	test("marks run as error in store when runAgent throws", async () => {
		const runStore = createRunStore({
			path: `/tmp/sandcaster-test-${crypto.randomUUID()}.jsonl`,
		});
		const app = createApp({ runAgent: errorRunAgent, runStore });
		const res = await postQuery(app, { prompt: "hello" });
		await res.text(); // consume stream so lifecycle completes

		const runs = runStore.list();
		expect(runs).toHaveLength(1);
		expect(runs[0].status).toBe("error");
		expect(runs[0].error).toContain("Sandbox crashed");
	});

	test("passes durationSecs to runStore.fail when agent throws after result event", async () => {
		const runStore = createRunStore({
			path: `/tmp/sandcaster-test-${crypto.randomUUID()}.jsonl`,
		});
		const app = createApp({
			runAgent: errorRunAgentWithResult,
			runStore,
		});
		const res = await postQuery(app, { prompt: "hello" });
		await res.text();

		const runs = runStore.list();
		expect(runs).toHaveLength(1);
		expect(runs[0].status).toBe("error");
		expect(runs[0].durationSecs).toBe(5);
	});

	test("stores durationSecs on completed runs", async () => {
		const runStore = createRunStore({
			path: `/tmp/sandcaster-test-${crypto.randomUUID()}.jsonl`,
		});
		const app = createApp({ runAgent: fakeRunAgent, runStore });
		const res = await postQuery(app, { prompt: "hello" });
		await res.text();

		const runs = runStore.list();
		expect(runs[0].durationSecs).toBe(42);
	});

	test("requires auth when apiKey is set", async () => {
		const app = createApp({
			runAgent: fakeRunAgent,
			apiKey: "a]d3f5g6h7j8k9l0m1n2o3p4q5r6s7t8",
		});
		const res = await postQuery(app, { prompt: "hello" });

		expect(res.status).toBe(401);
	});
});
