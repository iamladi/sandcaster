import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
	return app.request(url, init);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /sandbox/create", () => {
	it("returns sessionId and token", async () => {
		const res = await request("POST", "/sandbox/create");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { sessionId: string; token: string };
		expect(typeof body.sessionId).toBe("string");
		expect(body.sessionId.length).toBeGreaterThan(0);
		expect(typeof body.token).toBe("string");
		expect(body.token.length).toBeGreaterThan(0);
	});

	it("returns unique sessionId on each call", async () => {
		const res1 = await request("POST", "/sandbox/create");
		const res2 = await request("POST", "/sandbox/create");
		const body1 = (await res1.json()) as { sessionId: string };
		const body2 = (await res2.json()) as { sessionId: string };
		expect(body1.sessionId).not.toBe(body2.sessionId);
	});
});

describe("POST /sandbox/:id/files/write", () => {
	let sessionId: string;
	let token: string;

	beforeEach(async () => {
		const res = await request("POST", "/sandbox/create");
		const body = (await res.json()) as { sessionId: string; token: string };
		sessionId = body.sessionId;
		token = body.token;
	});

	afterEach(() => {
		sessionId = "";
		token = "";
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
});

describe("GET /sandbox/:id/files/read", () => {
	let sessionId: string;
	let token: string;

	beforeEach(async () => {
		const createRes = await request("POST", "/sandbox/create");
		const body = (await createRes.json()) as {
			sessionId: string;
			token: string;
		};
		sessionId = body.sessionId;
		token = body.token;

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
		const createRes = await request("POST", "/sandbox/create");
		const body = (await createRes.json()) as {
			sessionId: string;
			token: string;
		};
		sessionId = body.sessionId;
		token = body.token;
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
		const createRes = await request("POST", "/sandbox/create");
		const body = (await createRes.json()) as {
			sessionId: string;
			token: string;
		};
		sessionId = body.sessionId;
		token = body.token;
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
