import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock @cloudflare/sandbox — must be before importing the worker
// ---------------------------------------------------------------------------

const mockExec = vi
	.fn()
	.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockReadFile = vi.fn().mockResolvedValue({ content: "test content" });
const mockDestroy = vi.fn().mockResolvedValue(undefined);

const mockSandbox = {
	exec: mockExec,
	writeFile: mockWriteFile,
	readFile: mockReadFile,
	destroy: mockDestroy,
};

vi.mock("@cloudflare/sandbox", () => ({
	getSandbox: vi.fn().mockReturnValue(mockSandbox),
	proxyToSandbox: vi.fn().mockResolvedValue(null),
	Sandbox: class {},
}));

// ---------------------------------------------------------------------------
// Import after mocking
// ---------------------------------------------------------------------------

// The worker uses default export with fetch handler; we need to test
// the Hono app routes through it. Import the module to get the default export.
const workerModule = await import("../index.js");
const worker = workerModule.default;

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
	const env = {
		API_KEY: "test-api-key",
		Sandbox: {} as any,
	};
	return worker.fetch(new Request(url, init), env, {} as ExecutionContext);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /sandbox/create", () => {
	it("returns sessionId and token with valid API key", async () => {
		const res = await request("POST", "/sandbox/create", {
			headers: { "X-API-Key": "test-api-key" },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { sessionId: string; token: string };
		expect(typeof body.sessionId).toBe("string");
		expect(typeof body.token).toBe("string");
	});

	it("returns 401 without authentication", async () => {
		const res = await request("POST", "/sandbox/create");
		expect(res.status).toBe(401);
	});

	it("returns 401 with wrong API key", async () => {
		const res = await request("POST", "/sandbox/create", {
			headers: { "X-API-Key": "wrong-key" },
		});
		expect(res.status).toBe(401);
	});

	it("accepts Bearer token in Authorization header", async () => {
		const res = await request("POST", "/sandbox/create", {
			headers: { Authorization: "Bearer test-api-key" },
		});
		expect(res.status).toBe(200);
	});
});

describe("POST /sandbox/:id/exec", () => {
	it("returns stdout, stderr, exitCode with valid auth", async () => {
		mockExec.mockResolvedValueOnce({
			stdout: "hello\n",
			stderr: "",
			exitCode: 0,
		});

		const res = await request("POST", "/sandbox/test-session/exec", {
			headers: { Authorization: "Bearer test-api-key" },
			body: { cmd: "echo hello" },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			stdout: string;
			stderr: string;
			exitCode: number;
		};
		expect(body.stdout).toBe("hello\n");
		expect(body.exitCode).toBe(0);
	});

	it("returns 401 without auth", async () => {
		const res = await request("POST", "/sandbox/test-session/exec", {
			body: { cmd: "echo hello" },
		});
		expect(res.status).toBe(401);
	});
});

describe("POST /sandbox/:id/kill", () => {
	it("calls destroy and returns ok", async () => {
		const res = await request("POST", "/sandbox/test-session/kill", {
			headers: { Authorization: "Bearer test-api-key" },
		});
		expect(res.status).toBe(200);
		expect(mockDestroy).toHaveBeenCalled();
	});

	it("returns 401 without auth", async () => {
		const res = await request("POST", "/sandbox/test-session/kill");
		expect(res.status).toBe(401);
	});
});
