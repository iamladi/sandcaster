import {
	createSessionStore,
	type SandboxInstance,
	type SandcasterEvent,
	SessionManager,
} from "@sandcaster/core";
import { describe, expect, test, vi } from "vitest";
import { createApp } from "../../app.js";

// ---------------------------------------------------------------------------
// Fake sandbox factory
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

function createTestSessionManager() {
	const store = createSessionStore({
		path: `/tmp/sandcaster-test-${crypto.randomUUID()}.jsonl`,
	});

	return new SessionManager({
		store,
		sandboxFactory: async () => createFakeSandbox(),
		runAgent: async function* () {
			yield {
				type: "assistant",
				content: "Hello",
			} satisfies SandcasterEvent;
			yield {
				type: "result",
				content: "Done",
				costUsd: 0.01,
				numTurns: 1,
				durationSecs: 1,
			} satisfies SandcasterEvent;
		},
		idleTimeoutMs: 60_000,
		maxActiveSessions: 10,
	});
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

function postSession(app: ReturnType<typeof createApp>, body: object) {
	return app.request("/sessions", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

function postMessage(
	app: ReturnType<typeof createApp>,
	sessionId: string,
	body: object,
) {
	return app.request(`/sessions/${sessionId}/messages`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

function getSessions(app: ReturnType<typeof createApp>, query?: string) {
	return app.request(`/sessions${query ? `?${query}` : ""}`, {
		method: "GET",
	});
}

function getSession(app: ReturnType<typeof createApp>, sessionId: string) {
	return app.request(`/sessions/${sessionId}`, { method: "GET" });
}

function deleteSession(app: ReturnType<typeof createApp>, sessionId: string) {
	return app.request(`/sessions/${sessionId}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// POST /sessions
// ---------------------------------------------------------------------------

describe("POST /sessions", () => {
	test("creates session and returns SSE stream with session_created event", async () => {
		const sessionManager = createTestSessionManager();
		const app = createApp({ sessionManager });

		const res = await postSession(app, { prompt: "hello" });

		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toContain("text/event-stream");

		const text = await res.text();
		expect(text).toContain("event: session_created");
	});

	test("returns 400 for invalid body (missing prompt)", async () => {
		const sessionManager = createTestSessionManager();
		const app = createApp({ sessionManager });

		const res = await postSession(app, {});

		expect(res.status).toBe(400);
	});

	test("returns 400 for invalid JSON", async () => {
		const sessionManager = createTestSessionManager();
		const app = createApp({ sessionManager });

		const res = await app.request("/sessions", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "not-json",
		});

		expect(res.status).toBe(400);
	});

	test("streams assistant and result events when prompt provided", async () => {
		const sessionManager = createTestSessionManager();
		const app = createApp({ sessionManager });

		const res = await postSession(app, { prompt: "hello world" });
		expect(res.status).toBe(200);

		const text = await res.text();
		expect(text).toContain("event: session_created");
		expect(text).toContain("event: assistant");
		expect(text).toContain("event: result");
	});
});

// ---------------------------------------------------------------------------
// POST /sessions/:id/messages
// ---------------------------------------------------------------------------

describe("POST /sessions/:id/messages", () => {
	test("returns SSE stream with events for valid session", async () => {
		const sessionManager = createTestSessionManager();
		const app = createApp({ sessionManager });

		// Create a session first (no prompt so it settles quickly)
		const createRes = await postSession(app, { prompt: "init" });
		const createText = await createRes.text();
		const match = createText.match(/"sessionId":"([^"]+)"/);
		const sessionId = match?.[1];
		expect(sessionId).toBeDefined();

		const res = await postMessage(app, sessionId as string, {
			prompt: "hello",
		});

		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toContain("text/event-stream");

		const text = await res.text();
		expect(text).toContain("event: assistant");
	});

	test("returns 404 for unknown session", async () => {
		const sessionManager = createTestSessionManager();
		const app = createApp({ sessionManager });

		const res = await postMessage(app, "sess_fake-id-0000", {
			prompt: "hello",
		});

		expect(res.status).toBe(404);
	});

	test("returns 400 for invalid body", async () => {
		const sessionManager = createTestSessionManager();
		const app = createApp({ sessionManager });

		// Create a session
		const createRes = await postSession(app, { prompt: "init" });
		const createText = await createRes.text();
		const match = createText.match(/"sessionId":"([^"]+)"/);
		const sessionId = match?.[1] as string;

		const res = await postMessage(app, sessionId, {});

		expect(res.status).toBe(400);
	});

	test("detects /status command and returns session_command_result event", async () => {
		const sessionManager = createTestSessionManager();
		const app = createApp({ sessionManager });

		// Create a session
		const createRes = await postSession(app, { prompt: "init" });
		const createText = await createRes.text();
		const match = createText.match(/"sessionId":"([^"]+)"/);
		const sessionId = match?.[1] as string;

		const res = await postMessage(app, sessionId, { prompt: "/status" });

		expect(res.status).toBe(200);
		const text = await res.text();
		expect(text).toContain("event: session_command_result");
		expect(text).toContain('"command":"status"');
	});
});

// ---------------------------------------------------------------------------
// GET /sessions
// ---------------------------------------------------------------------------

describe("GET /sessions", () => {
	test("returns array of sessions", async () => {
		const sessionManager = createTestSessionManager();
		const app = createApp({ sessionManager });

		// Create a session
		const createRes = await postSession(app, { prompt: "init" });
		await createRes.text(); // consume stream

		const res = await getSessions(app);
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(Array.isArray(body)).toBe(true);
		expect(body.length).toBeGreaterThan(0);
	});

	test("returns empty array when no sessions", async () => {
		const sessionManager = createTestSessionManager();
		const app = createApp({ sessionManager });

		const res = await getSessions(app);
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(Array.isArray(body)).toBe(true);
		expect(body).toHaveLength(0);
	});

	test("respects limit query param", async () => {
		const sessionManager = createTestSessionManager();
		const app = createApp({ sessionManager });

		const res = await getSessions(app, "limit=10");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(Array.isArray(body)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// GET /sessions/:id
// ---------------------------------------------------------------------------

describe("GET /sessions/:id", () => {
	test("returns session detail for active session", async () => {
		const sessionManager = createTestSessionManager();
		const app = createApp({ sessionManager });

		// Create a session
		const createRes = await postSession(app, { prompt: "init" });
		const createText = await createRes.text();
		const match = createText.match(/"sessionId":"([^"]+)"/);
		const sessionId = match?.[1] as string;

		const res = await getSession(app, sessionId);
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.id).toBe(sessionId);
	});

	test("returns 404 for unknown session", async () => {
		const sessionManager = createTestSessionManager();
		const app = createApp({ sessionManager });

		const res = await getSession(app, "sess_fake-id-0000");
		expect(res.status).toBe(404);
	});
});

// ---------------------------------------------------------------------------
// DELETE /sessions/:id
// ---------------------------------------------------------------------------

describe("DELETE /sessions/:id", () => {
	test("returns 204 for existing session", async () => {
		const sessionManager = createTestSessionManager();
		const app = createApp({ sessionManager });

		// Create a session
		const createRes = await postSession(app, { prompt: "init" });
		const createText = await createRes.text();
		const match = createText.match(/"sessionId":"([^"]+)"/);
		const sessionId = match?.[1] as string;

		const res = await deleteSession(app, sessionId);
		expect(res.status).toBe(204);
	});

	test("is idempotent — returns 204 for non-existent session", async () => {
		const sessionManager = createTestSessionManager();
		const app = createApp({ sessionManager });

		const res = await deleteSession(app, "sess_fake-id-0000");
		expect(res.status).toBe(204);
	});
});
