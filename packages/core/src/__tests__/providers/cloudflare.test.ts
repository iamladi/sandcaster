import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock globalThis.fetch at the system boundary (HTTP calls to Cloudflare Worker)
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();

// ---------------------------------------------------------------------------
// Imports (after mocks are set up in beforeEach)
// ---------------------------------------------------------------------------

import { createCloudflareProvider } from "../../providers/cloudflare.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

const WORKER_URL = "https://sandcaster-sandbox-proxy.example.workers.dev";
const SESSION_ID = "session-abc123";
const TOKEN = "token-xyz789";

function setupSuccessfulCreate() {
	mockFetch.mockResolvedValueOnce(
		makeJsonResponse({ sessionId: SESSION_ID, token: TOKEN }),
	);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createCloudflareProvider", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		globalThis.fetch = mockFetch;
		// Clear env var between tests
		delete process.env.CLOUDFLARE_SANDBOX_WORKER_URL;
	});

	afterEach(() => {
		vi.clearAllMocks();
		delete process.env.CLOUDFLARE_SANDBOX_WORKER_URL;
	});

	// -------------------------------------------------------------------------
	// Provider identity
	// -------------------------------------------------------------------------

	it("has name 'cloudflare'", () => {
		const provider = createCloudflareProvider();
		expect(provider.name).toBe("cloudflare");
	});

	// -------------------------------------------------------------------------
	// Successful create
	// -------------------------------------------------------------------------

	it("returns ok: true with a SandboxInstance on success", async () => {
		setupSuccessfulCreate();

		const provider = createCloudflareProvider();
		const result = await provider.create({
			metadata: { workerUrl: WORKER_URL },
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");
		expect(result.instance).toBeDefined();
	});

	it("instance has workDir '/workspace'", async () => {
		setupSuccessfulCreate();

		const provider = createCloudflareProvider();
		const result = await provider.create({
			metadata: { workerUrl: WORKER_URL },
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");
		expect(result.instance.workDir).toBe("/workspace");
	});

	it("instance has correct capabilities", async () => {
		setupSuccessfulCreate();

		const provider = createCloudflareProvider();
		const result = await provider.create({
			metadata: { workerUrl: WORKER_URL },
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");
		expect(result.instance.capabilities).toMatchObject({
			fileSystem: true,
			shellExec: true,
			envInjection: true,
			streaming: false,
			networkPolicy: false,
			snapshots: false,
			reconnect: false,
			customImage: false,
		});
	});

	it("POSTs to /sandbox/create with template, timeoutMs, envs and apiKey auth", async () => {
		setupSuccessfulCreate();

		const provider = createCloudflareProvider();
		await provider.create({
			template: "my-sandbox",
			timeoutMs: 30000,
			envs: { FOO: "bar" },
			metadata: { workerUrl: WORKER_URL },
			apiKey: "cf-api-key-123",
		});

		expect(mockFetch).toHaveBeenCalledWith(
			`${WORKER_URL}/sandbox/create`,
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					"Content-Type": "application/json",
					Authorization: "Bearer cf-api-key-123",
				}),
				body: JSON.stringify({
					template: "my-sandbox",
					timeoutMs: 30000,
					envs: { FOO: "bar" },
				}),
			}),
		);
	});

	// -------------------------------------------------------------------------
	// Worker URL resolution
	// -------------------------------------------------------------------------

	it("uses config.metadata.workerUrl when provided", async () => {
		setupSuccessfulCreate();

		const provider = createCloudflareProvider();
		await provider.create({ metadata: { workerUrl: WORKER_URL } });

		expect(mockFetch).toHaveBeenCalledWith(
			expect.stringContaining(WORKER_URL),
			expect.anything(),
		);
	});

	it("uses CLOUDFLARE_SANDBOX_WORKER_URL env var when no metadata URL", async () => {
		process.env.CLOUDFLARE_SANDBOX_WORKER_URL = WORKER_URL;
		setupSuccessfulCreate();

		const provider = createCloudflareProvider();
		await provider.create({});

		expect(mockFetch).toHaveBeenCalledWith(
			expect.stringContaining(WORKER_URL),
			expect.anything(),
		);
	});

	it("returns SANDBOX_ERROR with hint when worker URL is not configured", async () => {
		delete process.env.CLOUDFLARE_SANDBOX_WORKER_URL;

		const provider = createCloudflareProvider();
		const result = await provider.create({});

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("SANDBOX_ERROR");
		expect(result.hint).toContain("CLOUDFLARE_SANDBOX_WORKER_URL");
	});

	// -------------------------------------------------------------------------
	// Template validation
	// -------------------------------------------------------------------------

	it("returns INVALID_TEMPLATE_FOR_PROVIDER for empty template", async () => {
		const provider = createCloudflareProvider();
		const result = await provider.create({
			template: "",
			metadata: { workerUrl: WORKER_URL },
		});

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("INVALID_TEMPLATE_FOR_PROVIDER");
	});

	it("returns INVALID_TEMPLATE_FOR_PROVIDER for template with spaces", async () => {
		const provider = createCloudflareProvider();
		const result = await provider.create({
			template: "my template",
			metadata: { workerUrl: WORKER_URL },
		});

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("INVALID_TEMPLATE_FOR_PROVIDER");
	});

	it("accepts valid template names without spaces", async () => {
		setupSuccessfulCreate();

		const provider = createCloudflareProvider();
		const result = await provider.create({
			template: "my-sandbox",
			metadata: { workerUrl: WORKER_URL },
		});

		expect(result.ok).toBe(true);
	});

	// -------------------------------------------------------------------------
	// Error mapping
	// -------------------------------------------------------------------------

	it("maps 401 response to PROVIDER_AUTH_MISSING", async () => {
		mockFetch.mockResolvedValueOnce(
			makeJsonResponse({ error: "Unauthorized" }, 401),
		);

		const provider = createCloudflareProvider();
		const result = await provider.create({
			metadata: { workerUrl: WORKER_URL },
		});

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("PROVIDER_AUTH_MISSING");
	});

	it("maps 403 response to PROVIDER_AUTH_MISSING", async () => {
		mockFetch.mockResolvedValueOnce(
			makeJsonResponse({ error: "Forbidden" }, 403),
		);

		const provider = createCloudflareProvider();
		const result = await provider.create({
			metadata: { workerUrl: WORKER_URL },
		});

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("PROVIDER_AUTH_MISSING");
	});

	it("maps 429 response to RATE_LIMIT", async () => {
		mockFetch.mockResolvedValueOnce(
			makeJsonResponse({ error: "Too Many Requests" }, 429),
		);

		const provider = createCloudflareProvider();
		const result = await provider.create({
			metadata: { workerUrl: WORKER_URL },
		});

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("RATE_LIMIT");
	});

	it("maps fetch timeout (AbortError) to SANDBOX_TIMEOUT", async () => {
		const abortErr = new Error("The operation was aborted");
		abortErr.name = "AbortError";
		mockFetch.mockRejectedValueOnce(abortErr);

		const provider = createCloudflareProvider();
		const result = await provider.create({
			metadata: { workerUrl: WORKER_URL },
		});

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("SANDBOX_TIMEOUT");
	});

	it("maps network error to SANDBOX_ERROR", async () => {
		mockFetch.mockRejectedValueOnce(new Error("fetch failed"));

		const provider = createCloudflareProvider();
		const result = await provider.create({
			metadata: { workerUrl: WORKER_URL },
		});

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("SANDBOX_ERROR");
	});

	// -------------------------------------------------------------------------
	// files.write
	// -------------------------------------------------------------------------

	it("files.write POSTs to /sandbox/:id/files/write with Bearer token and path/content", async () => {
		setupSuccessfulCreate();
		mockFetch.mockResolvedValueOnce(makeJsonResponse({ ok: true }));

		const provider = createCloudflareProvider();
		const result = await provider.create({
			metadata: { workerUrl: WORKER_URL },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		await result.instance.files.write("/workspace/file.txt", "hello world");

		expect(mockFetch).toHaveBeenCalledWith(
			`${WORKER_URL}/sandbox/${SESSION_ID}/files/write`,
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					Authorization: `Bearer ${TOKEN}`,
					"Content-Type": "application/json",
				}),
				body: JSON.stringify({
					path: "/workspace/file.txt",
					content: "hello world",
				}),
			}),
		);
	});

	// -------------------------------------------------------------------------
	// files.read
	// -------------------------------------------------------------------------

	it("files.read GETs /sandbox/:id/files/read?path=... with Bearer token", async () => {
		setupSuccessfulCreate();
		mockFetch.mockResolvedValueOnce(
			makeJsonResponse({ content: "file contents" }),
		);

		const provider = createCloudflareProvider();
		const result = await provider.create({
			metadata: { workerUrl: WORKER_URL },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		const content = await result.instance.files.read("/workspace/file.txt");

		expect(mockFetch).toHaveBeenCalledWith(
			`${WORKER_URL}/sandbox/${SESSION_ID}/files/read?path=%2Fworkspace%2Ffile.txt`,
			expect.objectContaining({
				method: "GET",
				headers: expect.objectContaining({
					Authorization: `Bearer ${TOKEN}`,
				}),
			}),
		);
		expect(content).toBe("file contents");
	});

	it("files.read returns Uint8Array when format is 'bytes'", async () => {
		setupSuccessfulCreate();
		mockFetch.mockResolvedValueOnce(
			makeJsonResponse({ content: "file contents" }),
		);

		const provider = createCloudflareProvider();
		const result = await provider.create({
			metadata: { workerUrl: WORKER_URL },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		const content = await result.instance.files.read("/workspace/file.txt", {
			format: "bytes",
		});

		expect(content).toBeInstanceOf(Uint8Array);
	});

	it("files.read decodes base64 content correctly for binary files", async () => {
		setupSuccessfulCreate();
		const originalBytes = new Uint8Array([0, 255, 128, 42, 1]);
		const base64Content = Buffer.from(originalBytes).toString("base64");
		mockFetch.mockResolvedValueOnce(
			makeJsonResponse({ content: base64Content, encoding: "base64" }),
		);

		const provider = createCloudflareProvider();
		const result = await provider.create({
			metadata: { workerUrl: WORKER_URL },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		const content = await result.instance.files.read("/workspace/binary.bin", {
			format: "bytes",
		});

		expect(content).toBeInstanceOf(Uint8Array);
		expect(content).toEqual(originalBytes);
	});

	// -------------------------------------------------------------------------
	// commands.run
	// -------------------------------------------------------------------------

	it("commands.run POSTs to /sandbox/:id/exec with cmd and returns stdout/stderr/exitCode", async () => {
		setupSuccessfulCreate();
		mockFetch.mockResolvedValueOnce(
			makeJsonResponse({ stdout: "hello\n", stderr: "", exitCode: 0 }),
		);

		const provider = createCloudflareProvider();
		const result = await provider.create({
			metadata: { workerUrl: WORKER_URL },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		const cmdResult = await result.instance.commands.run("echo hello");

		expect(mockFetch).toHaveBeenCalledWith(
			`${WORKER_URL}/sandbox/${SESSION_ID}/exec`,
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					Authorization: `Bearer ${TOKEN}`,
				}),
				body: JSON.stringify({ cmd: "echo hello" }),
			}),
		);
		expect(cmdResult).toMatchObject({
			stdout: "hello\n",
			stderr: "",
			exitCode: 0,
		});
	});

	it("commands.run forwards opts.signal to fetch so callers can abort the HTTP request", async () => {
		setupSuccessfulCreate();
		mockFetch.mockResolvedValueOnce(
			makeJsonResponse({ stdout: "", stderr: "", exitCode: 0 }),
		);

		const provider = createCloudflareProvider();
		const result = await provider.create({
			metadata: { workerUrl: WORKER_URL },
		});
		if (!result.ok) throw new Error("unreachable");

		const controller = new AbortController();
		await result.instance.commands.run("sleep 1", { signal: controller.signal });

		// The exec fetch (last call) must include the signal so abort propagates
		const execCall = mockFetch.mock.calls.find(
			(call) => typeof call[0] === "string" && call[0].endsWith("/exec"),
		);
		expect(execCall).toBeDefined();
		const initArg = execCall?.[1] as RequestInit | undefined;
		expect(initArg?.signal).toBe(controller.signal);
	});

	it("commands.run passes timeoutMs in request body", async () => {
		setupSuccessfulCreate();
		mockFetch.mockResolvedValueOnce(
			makeJsonResponse({ stdout: "", stderr: "", exitCode: 0 }),
		);

		const provider = createCloudflareProvider();
		const result = await provider.create({
			metadata: { workerUrl: WORKER_URL },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		await result.instance.commands.run("sleep 1", { timeoutMs: 5000 });

		expect(mockFetch).toHaveBeenCalledWith(
			`${WORKER_URL}/sandbox/${SESSION_ID}/exec`,
			expect.objectContaining({
				body: JSON.stringify({ cmd: "sleep 1", timeoutMs: 5000 }),
			}),
		);
	});

	// -------------------------------------------------------------------------
	// commands.run — streaming callbacks (non-streaming compatibility)
	// -------------------------------------------------------------------------

	it("commands.run calls onStdout and onStderr callbacks with response data", async () => {
		setupSuccessfulCreate();
		mockFetch.mockResolvedValueOnce(
			makeJsonResponse({
				stdout: "output line\n",
				stderr: "error line\n",
				exitCode: 0,
			}),
		);

		const provider = createCloudflareProvider();
		const result = await provider.create({
			metadata: { workerUrl: WORKER_URL },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		const onStdout = vi.fn();
		const onStderr = vi.fn();
		await result.instance.commands.run("echo hello", { onStdout, onStderr });

		expect(onStdout).toHaveBeenCalledWith("output line\n");
		expect(onStderr).toHaveBeenCalledWith("error line\n");
	});

	it("commands.run does not call callbacks when output is empty", async () => {
		setupSuccessfulCreate();
		mockFetch.mockResolvedValueOnce(
			makeJsonResponse({ stdout: "", stderr: "", exitCode: 0 }),
		);

		const provider = createCloudflareProvider();
		const result = await provider.create({
			metadata: { workerUrl: WORKER_URL },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		const onStdout = vi.fn();
		const onStderr = vi.fn();
		await result.instance.commands.run("true", { onStdout, onStderr });

		expect(onStdout).not.toHaveBeenCalled();
		expect(onStderr).not.toHaveBeenCalled();
	});

	// -------------------------------------------------------------------------
	// files.write — binary handling
	// -------------------------------------------------------------------------

	it("files.write sends base64-encoded content for Uint8Array", async () => {
		setupSuccessfulCreate();
		mockFetch.mockResolvedValueOnce(makeJsonResponse({ ok: true }));

		const provider = createCloudflareProvider();
		const result = await provider.create({
			metadata: { workerUrl: WORKER_URL },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		const bytes = new Uint8Array([0x00, 0xff, 0x80]);
		await result.instance.files.write("/workspace/binary.bin", bytes);

		const callBody = JSON.parse(
			(mockFetch.mock.calls[1] as [string, RequestInit])[1].body as string,
		);
		expect(callBody.encoding).toBe("base64");
		expect(callBody.content).toBe(Buffer.from(bytes).toString("base64"));
	});

	// -------------------------------------------------------------------------
	// kill
	// -------------------------------------------------------------------------

	it("kill POSTs to /sandbox/:id/kill with Bearer token", async () => {
		setupSuccessfulCreate();
		mockFetch.mockResolvedValueOnce(makeJsonResponse({ ok: true }));

		const provider = createCloudflareProvider();
		const result = await provider.create({
			metadata: { workerUrl: WORKER_URL },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		await result.instance.kill();

		expect(mockFetch).toHaveBeenCalledWith(
			`${WORKER_URL}/sandbox/${SESSION_ID}/kill`,
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					Authorization: `Bearer ${TOKEN}`,
				}),
			}),
		);
	});

	it("kill is idempotent — does not throw on second call when Worker returns 404", async () => {
		setupSuccessfulCreate();
		mockFetch
			.mockResolvedValueOnce(makeJsonResponse({ ok: true }))
			.mockResolvedValueOnce(makeJsonResponse({ error: "Not Found" }, 404));

		const provider = createCloudflareProvider();
		const result = await provider.create({
			metadata: { workerUrl: WORKER_URL },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		await result.instance.kill();
		await expect(result.instance.kill()).resolves.toBeUndefined();
	});

	// -------------------------------------------------------------------------
	// Unauthorized operation (wrong token on subsequent requests)
	// -------------------------------------------------------------------------

	it("files.write throws SandboxOperationError on 401 response", async () => {
		setupSuccessfulCreate();
		mockFetch.mockResolvedValueOnce(
			makeJsonResponse({ error: "Unauthorized" }, 401),
		);

		const provider = createCloudflareProvider();
		const result = await provider.create({
			metadata: { workerUrl: WORKER_URL },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		await expect(
			result.instance.files.write("/workspace/file.txt", "content"),
		).rejects.toThrow();
	});
});
