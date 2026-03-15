import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../index.js";

// ---------------------------------------------------------------------------
// Cloudflare Worker endpoint tests
// Tests use the Hono app directly (not the Worker runtime) so no Durable Object
// bindings are needed at the HTTP layer. The Durable Object is stubbed.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function request(
	method: string,
	path: string,
	options?: {
		body?: unknown;
		headers?: Record<string, string>;
		env?: Record<string, string>;
	},
): Promise<Response> {
	const url = `http://localhost${path}`;
	const init: RequestInit = {
		method,
		headers: {
			"Content-Type": "application/json",
			...(options?.headers ?? {}),
		},
	};
	if (options?.body !== undefined) {
		init.body = JSON.stringify(options.body);
	}
	return app.request(url, init, options?.env);
}

const TEST_API_KEY = "test-api-key-for-create";
const TEST_ENV = { API_KEY: TEST_API_KEY };

async function _createTestSession(): Promise<{
	sessionId: string;
	token: string;
}> {
	const res = await request("POST", "/sandbox/create", {
		headers: { "X-API-Key": TEST_API_KEY },
		env: TEST_ENV,
	});
	return (await res.json()) as { sessionId: string; token: string };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /sandbox/create", () => {
	const API_KEY = "test-api-key-for-create";
	const WORKER_ENV = { API_KEY };

	it("returns sessionId and token when valid API key is provided", async () => {
		const res = await request("POST", "/sandbox/create", {
			headers: { "X-API-Key": API_KEY },
			env: WORKER_ENV,
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { sessionId: string; token: string };
		expect(typeof body.sessionId).toBe("string");
		expect(body.sessionId.length).toBeGreaterThan(0);
		expect(typeof body.token).toBe("string");
		expect(body.token.length).toBeGreaterThan(0);
	});

	it("returns unique sessionId on each call", async () => {
		const res1 = await request("POST", "/sandbox/create", {
			headers: { "X-API-Key": API_KEY },
			env: WORKER_ENV,
		});
		const res2 = await request("POST", "/sandbox/create", {
			headers: { "X-API-Key": API_KEY },
			env: WORKER_ENV,
		});
		const body1 = (await res1.json()) as { sessionId: string };
		const body2 = (await res2.json()) as { sessionId: string };
		expect(body1.sessionId).not.toBe(body2.sessionId);
	});

	it("accepts Bearer token in Authorization header", async () => {
		const res = await request("POST", "/sandbox/create", {
			headers: { Authorization: `Bearer ${API_KEY}` },
			env: WORKER_ENV,
		});
		expect(res.status).toBe(200);
	});

	it("returns 401 without any authentication", async () => {
		const res = await request("POST", "/sandbox/create", {
			env: WORKER_ENV,
		});
		expect(res.status).toBe(401);
	});

	it("returns 401 with wrong API key", async () => {
		const res = await request("POST", "/sandbox/create", {
			headers: { "X-API-Key": "wrong-key-value" },
			env: WORKER_ENV,
		});
		expect(res.status).toBe(401);
	});
});

describe("POST /sandbox/:id/files/write", () => {
	let sessionId: string;
	let token: string;

	beforeEach(async () => {
		({ sessionId, token } = await _createTestSession());
	});

	it("succeeds with valid auth", async () => {
		const res = await request("POST", `/sandbox/${sessionId}/files/write`, {
			headers: { Authorization: `Bearer ${token}` },
			body: { path: "/workspace/file.txt", content: "hello world" },
		});
		expect(res.status).toBe(200);
	});

	it("returns 401 without Authorization header", async () => {
		const res = await request("POST", `/sandbox/${sessionId}/files/write`, {
			body: { path: "/workspace/file.txt", content: "hello" },
		});
		expect(res.status).toBe(401);
	});

	it("returns 401 with wrong token", async () => {
		const res = await request("POST", `/sandbox/${sessionId}/files/write`, {
			headers: { Authorization: "Bearer wrong-token" },
			body: { path: "/workspace/file.txt", content: "hello" },
		});
		expect(res.status).toBe(401);
	});

	it("decodes base64 content when encoding field is 'base64'", async () => {
		const originalContent = "hello binary world";
		const base64Content = btoa(originalContent);

		// Write with base64 encoding
		const writeRes = await request(
			"POST",
			`/sandbox/${sessionId}/files/write`,
			{
				headers: { Authorization: `Bearer ${token}` },
				body: {
					path: "/workspace/decoded.txt",
					content: base64Content,
					encoding: "base64",
				},
			},
		);
		expect(writeRes.status).toBe(200);

		// Read back — should be the original content, not base64
		const readRes = await request(
			"GET",
			`/sandbox/${sessionId}/files/read?path=%2Fworkspace%2Fdecoded.txt`,
			{ headers: { Authorization: `Bearer ${token}` } },
		);
		const body = (await readRes.json()) as { content: string };
		expect(body.content).toBe(originalContent);
	});
});

describe("GET /sandbox/:id/files/read", () => {
	let sessionId: string;
	let token: string;

	beforeEach(async () => {
		({ sessionId, token } = await _createTestSession());

		// Write a file first so we can read it back
		await request("POST", `/sandbox/${sessionId}/files/write`, {
			headers: { Authorization: `Bearer ${token}` },
			body: { path: "/workspace/test.txt", content: "test content" },
		});
	});

	it("returns file content with valid auth", async () => {
		const res = await request(
			"GET",
			`/sandbox/${sessionId}/files/read?path=%2Fworkspace%2Ftest.txt`,
			{ headers: { Authorization: `Bearer ${token}` } },
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { content: string };
		expect(body.content).toBe("test content");
	});

	it("returns 401 without auth", async () => {
		const res = await request(
			"GET",
			`/sandbox/${sessionId}/files/read?path=%2Fworkspace%2Ftest.txt`,
		);
		expect(res.status).toBe(401);
	});

	it("returns 401 with wrong token", async () => {
		const res = await request(
			"GET",
			`/sandbox/${sessionId}/files/read?path=%2Fworkspace%2Ftest.txt`,
			{ headers: { Authorization: "Bearer wrong-token" } },
		);
		expect(res.status).toBe(401);
	});
});

describe("POST /sandbox/:id/exec", () => {
	let sessionId: string;
	let token: string;

	beforeEach(async () => {
		({ sessionId, token } = await _createTestSession());
	});

	it("returns stdout, stderr, exitCode with valid auth", async () => {
		const res = await request("POST", `/sandbox/${sessionId}/exec`, {
			headers: { Authorization: `Bearer ${token}` },
			body: { cmd: "echo hello" },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			stdout: string;
			stderr: string;
			exitCode: number;
		};
		expect(typeof body.stdout).toBe("string");
		expect(typeof body.stderr).toBe("string");
		expect(typeof body.exitCode).toBe("number");
	});

	it("returns 401 without auth", async () => {
		const res = await request("POST", `/sandbox/${sessionId}/exec`, {
			body: { cmd: "echo hello" },
		});
		expect(res.status).toBe(401);
	});

	it("returns 401 with wrong token", async () => {
		const res = await request("POST", `/sandbox/${sessionId}/exec`, {
			headers: { Authorization: "Bearer wrong-token" },
			body: { cmd: "echo hello" },
		});
		expect(res.status).toBe(401);
	});
});

describe("POST /sandbox/:id/kill", () => {
	let sessionId: string;
	let token: string;

	beforeEach(async () => {
		({ sessionId, token } = await _createTestSession());
	});

	it("succeeds with valid auth", async () => {
		const res = await request("POST", `/sandbox/${sessionId}/kill`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(200);
	});

	it("returns 401 without auth", async () => {
		const res = await request("POST", `/sandbox/${sessionId}/kill`);
		expect(res.status).toBe(401);
	});

	it("returns 401 with wrong token", async () => {
		const res = await request("POST", `/sandbox/${sessionId}/kill`, {
			headers: { Authorization: "Bearer wrong-token" },
		});
		expect(res.status).toBe(401);
	});
});
