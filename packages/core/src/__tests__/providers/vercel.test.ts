import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock @vercel/sandbox at the module boundary (system dependency)
// Error classes must be defined inside the factory because vi.mock is hoisted
// ---------------------------------------------------------------------------

const mockSandboxCreate = vi.fn();
const mockWriteFiles = vi.fn();
const mockReadFileToBuffer = vi.fn();
const mockRunCommand = vi.fn();
const mockStop = vi.fn();
const mockMkDir = vi.fn();

vi.mock("@vercel/sandbox", () => {
	return {
		Sandbox: {
			create: mockSandboxCreate,
		},
	};
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { createVercelProvider } from "../../providers/vercel.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVercelSandbox(overrides?: {
	writeFiles?: ReturnType<typeof vi.fn>;
	readFileToBuffer?: ReturnType<typeof vi.fn>;
	runCommand?: ReturnType<typeof vi.fn>;
	stop?: ReturnType<typeof vi.fn>;
	mkDir?: ReturnType<typeof vi.fn>;
}) {
	return {
		writeFiles: overrides?.writeFiles ?? mockWriteFiles,
		readFileToBuffer: overrides?.readFileToBuffer ?? mockReadFileToBuffer,
		runCommand: overrides?.runCommand ?? mockRunCommand,
		stop: overrides?.stop ?? mockStop,
		mkDir: overrides?.mkDir ?? mockMkDir,
	};
}

// Make a runCommand result with an async generator for logs
function makeCommandResult(opts?: {
	exitCode?: number;
	logs?: Array<{ stream: "stdout" | "stderr"; data: string }>;
}) {
	const exitCode = opts?.exitCode ?? 0;
	const logEntries = opts?.logs ?? [];

	async function* logsGenerator() {
		for (const entry of logEntries) {
			yield entry;
		}
	}

	return {
		exitCode,
		logs: logsGenerator,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createVercelProvider", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockWriteFiles.mockResolvedValue(undefined);
		mockReadFileToBuffer.mockResolvedValue(Buffer.from("content"));
		mockRunCommand.mockResolvedValue(makeCommandResult());
		mockStop.mockResolvedValue(undefined);
		mockMkDir.mockResolvedValue(undefined);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	// -------------------------------------------------------------------------
	// Provider identity
	// -------------------------------------------------------------------------

	it("has name 'vercel'", () => {
		const provider = createVercelProvider();
		expect(provider.name).toBe("vercel");
	});

	// -------------------------------------------------------------------------
	// Successful create
	// -------------------------------------------------------------------------

	it("returns ok: true with a SandboxInstance on success", async () => {
		const fakeSbx = makeVercelSandbox();
		mockSandboxCreate.mockResolvedValue(fakeSbx);

		const provider = createVercelProvider();
		const result = await provider.create({ template: "snap-abc123" });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");
		expect(result.instance).toBeDefined();
	});

	it("instance has workDir '/vercel/sandbox'", async () => {
		const fakeSbx = makeVercelSandbox();
		mockSandboxCreate.mockResolvedValue(fakeSbx);

		const provider = createVercelProvider();
		const result = await provider.create({});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");
		expect(result.instance.workDir).toBe("/vercel/sandbox");
	});

	it("instance has correct capabilities", async () => {
		const fakeSbx = makeVercelSandbox();
		mockSandboxCreate.mockResolvedValue(fakeSbx);

		const provider = createVercelProvider();
		const result = await provider.create({});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");
		expect(result.instance.capabilities).toMatchObject({
			fileSystem: true,
			shellExec: true,
			envInjection: true,
			streaming: true,
			networkPolicy: false,
			snapshots: true,
			reconnect: false,
			customImage: false,
		});
	});

	it("passes snapshot and timeoutMs to Sandbox.create", async () => {
		const fakeSbx = makeVercelSandbox();
		mockSandboxCreate.mockResolvedValue(fakeSbx);

		const provider = createVercelProvider();
		await provider.create({
			template: "snap-abc123",
			timeoutMs: 60000,
		});

		expect(mockSandboxCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				snapshot: "snap-abc123",
				timeoutMs: 60000,
			}),
		);
	});

	it("omits snapshot from Sandbox.create when no template provided", async () => {
		const fakeSbx = makeVercelSandbox();
		mockSandboxCreate.mockResolvedValue(fakeSbx);

		const provider = createVercelProvider();
		await provider.create({});

		const callArg = mockSandboxCreate.mock.calls[0][0];
		expect(callArg).not.toHaveProperty("snapshot");
	});

	// -------------------------------------------------------------------------
	// Template validation
	// -------------------------------------------------------------------------

	it("returns INVALID_TEMPLATE_FOR_PROVIDER for templates with spaces", async () => {
		const provider = createVercelProvider();
		const result = await provider.create({
			template: "invalid template with spaces",
		});

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("INVALID_TEMPLATE_FOR_PROVIDER");
	});

	it("returns INVALID_TEMPLATE_FOR_PROVIDER for templates with slashes", async () => {
		const provider = createVercelProvider();
		const result = await provider.create({ template: "my/template" });

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("INVALID_TEMPLATE_FOR_PROVIDER");
	});

	it("accepts alphanumeric snapshot IDs", async () => {
		const fakeSbx = makeVercelSandbox();
		mockSandboxCreate.mockResolvedValue(fakeSbx);

		const provider = createVercelProvider();
		const result = await provider.create({ template: "snap-abc123" });

		expect(result.ok).toBe(true);
	});

	// -------------------------------------------------------------------------
	// Error mapping
	// -------------------------------------------------------------------------

	it("maps 401 auth error to PROVIDER_AUTH_MISSING with VERCEL_TOKEN hint", async () => {
		const authErr = new Error("Unauthorized");
		(authErr as Error & { status?: number }).status = 401;
		mockSandboxCreate.mockRejectedValue(authErr);

		const provider = createVercelProvider();
		const result = await provider.create({});

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("PROVIDER_AUTH_MISSING");
		expect(result.hint).toContain("VERCEL_TOKEN");
	});

	it("maps 403 auth error to PROVIDER_AUTH_MISSING", async () => {
		const authErr = new Error("Forbidden");
		(authErr as Error & { status?: number }).status = 403;
		mockSandboxCreate.mockRejectedValue(authErr);

		const provider = createVercelProvider();
		const result = await provider.create({});

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("PROVIDER_AUTH_MISSING");
	});

	it("maps 429 error to RATE_LIMIT", async () => {
		const rateLimitErr = new Error("Too Many Requests");
		(rateLimitErr as Error & { status?: number }).status = 429;
		mockSandboxCreate.mockRejectedValue(rateLimitErr);

		const provider = createVercelProvider();
		const result = await provider.create({});

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("RATE_LIMIT");
	});

	it("maps timeout error to SANDBOX_TIMEOUT", async () => {
		const timeoutErr = new Error("Request timed out");
		(timeoutErr as Error & { code?: string }).code = "ETIMEDOUT";
		mockSandboxCreate.mockRejectedValue(timeoutErr);

		const provider = createVercelProvider();
		const result = await provider.create({});

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("SANDBOX_TIMEOUT");
	});

	it("maps unknown error to SANDBOX_ERROR", async () => {
		mockSandboxCreate.mockRejectedValue(new Error("unexpected"));

		const provider = createVercelProvider();
		const result = await provider.create({});

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("SANDBOX_ERROR");
	});

	// -------------------------------------------------------------------------
	// File operations
	// -------------------------------------------------------------------------

	it("files.write calls writeFiles with Buffer-converted content", async () => {
		const writeFiles = vi.fn().mockResolvedValue(undefined);
		const fakeSbx = makeVercelSandbox({ writeFiles });
		mockSandboxCreate.mockResolvedValue(fakeSbx);

		const provider = createVercelProvider();
		const result = await provider.create({});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		await result.instance.files.write("/some/path.txt", "hello world");

		expect(writeFiles).toHaveBeenCalledWith([
			{
				path: "/some/path.txt",
				content: Buffer.from("hello world"),
			},
		]);
	});

	it("files.write handles Uint8Array content", async () => {
		const writeFiles = vi.fn().mockResolvedValue(undefined);
		const fakeSbx = makeVercelSandbox({ writeFiles });
		mockSandboxCreate.mockResolvedValue(fakeSbx);

		const provider = createVercelProvider();
		const result = await provider.create({});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		const bytes = new Uint8Array([1, 2, 3]);
		await result.instance.files.write("/binary.bin", bytes);

		const callArg = writeFiles.mock.calls[0][0][0];
		expect(callArg.path).toBe("/binary.bin");
		expect(callArg.content).toBeInstanceOf(Buffer);
		expect(Buffer.from(callArg.content)).toEqual(Buffer.from(bytes));
	});

	it("files.read calls readFileToBuffer and returns result as Uint8Array by default", async () => {
		const buf = Buffer.from("file contents");
		const readFileToBuffer = vi.fn().mockResolvedValue(buf);
		const fakeSbx = makeVercelSandbox({ readFileToBuffer });
		mockSandboxCreate.mockResolvedValue(fakeSbx);

		const provider = createVercelProvider();
		const result = await provider.create({});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		const content = await result.instance.files.read("/some/path.txt");
		expect(readFileToBuffer).toHaveBeenCalledWith("/some/path.txt");
		expect(content).toBeInstanceOf(Uint8Array);
	});

	it("files.read returns string when format is 'text'", async () => {
		const buf = Buffer.from("file contents");
		const readFileToBuffer = vi.fn().mockResolvedValue(buf);
		const fakeSbx = makeVercelSandbox({ readFileToBuffer });
		mockSandboxCreate.mockResolvedValue(fakeSbx);

		const provider = createVercelProvider();
		const result = await provider.create({});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		const content = await result.instance.files.read("/some/path.txt", {
			format: "text",
		});
		expect(typeof content).toBe("string");
		expect(content).toBe("file contents");
	});

	// -------------------------------------------------------------------------
	// Command operations
	// -------------------------------------------------------------------------

	it("commands.run calls runCommand and returns exitCode with stdout/stderr", async () => {
		const cmdResult = makeCommandResult({
			exitCode: 0,
			logs: [
				{ stream: "stdout", data: "hello\n" },
				{ stream: "stderr", data: "warn\n" },
			],
		});
		const runCommand = vi.fn().mockResolvedValue(cmdResult);
		const fakeSbx = makeVercelSandbox({ runCommand });
		mockSandboxCreate.mockResolvedValue(fakeSbx);

		const provider = createVercelProvider();
		const result = await provider.create({});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		const cmdRes = await result.instance.commands.run("echo hello");
		expect(runCommand).toHaveBeenCalledWith("echo hello");
		expect(cmdRes.exitCode).toBe(0);
		expect(cmdRes.stdout).toBe("hello\n");
		expect(cmdRes.stderr).toBe("warn\n");
	});

	it("commands.run returns non-zero exit code without throwing", async () => {
		const cmdResult = makeCommandResult({
			exitCode: 1,
			logs: [{ stream: "stderr", data: "error\n" }],
		});
		const runCommand = vi.fn().mockResolvedValue(cmdResult);
		const fakeSbx = makeVercelSandbox({ runCommand });
		mockSandboxCreate.mockResolvedValue(fakeSbx);

		const provider = createVercelProvider();
		const result = await provider.create({});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		const cmdRes = await result.instance.commands.run("exit 1");
		expect(cmdRes.exitCode).toBe(1);
		expect(cmdRes.stderr).toBe("error\n");
	});

	it("commands.run calls onStdout/onStderr callbacks as logs stream", async () => {
		const cmdResult = makeCommandResult({
			exitCode: 0,
			logs: [
				{ stream: "stdout", data: "line1\n" },
				{ stream: "stderr", data: "err1\n" },
				{ stream: "stdout", data: "line2\n" },
			],
		});
		const runCommand = vi.fn().mockResolvedValue(cmdResult);
		const fakeSbx = makeVercelSandbox({ runCommand });
		mockSandboxCreate.mockResolvedValue(fakeSbx);

		const provider = createVercelProvider();
		const result = await provider.create({});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		const onStdout = vi.fn();
		const onStderr = vi.fn();
		await result.instance.commands.run("ls", { onStdout, onStderr });

		expect(onStdout).toHaveBeenCalledWith("line1\n");
		expect(onStdout).toHaveBeenCalledWith("line2\n");
		expect(onStderr).toHaveBeenCalledWith("err1\n");
	});

	it("commands.run collects full stdout and stderr even with callbacks", async () => {
		const cmdResult = makeCommandResult({
			exitCode: 0,
			logs: [
				{ stream: "stdout", data: "line1\n" },
				{ stream: "stdout", data: "line2\n" },
				{ stream: "stderr", data: "err1\n" },
			],
		});
		const runCommand = vi.fn().mockResolvedValue(cmdResult);
		const fakeSbx = makeVercelSandbox({ runCommand });
		mockSandboxCreate.mockResolvedValue(fakeSbx);

		const provider = createVercelProvider();
		const result = await provider.create({});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		const onStdout = vi.fn();
		const cmdRes = await result.instance.commands.run("ls", { onStdout });
		expect(cmdRes.stdout).toBe("line1\nline2\n");
		expect(cmdRes.stderr).toBe("err1\n");
	});

	it("commands.run handles StreamError mid-stream and returns partial output", async () => {
		class StreamError extends Error {
			constructor(message: string) {
				super(message);
				this.name = "StreamError";
			}
		}

		async function* brokenLogs() {
			yield { stream: "stdout" as const, data: "partial\n" };
			throw new StreamError("sandbox stopped");
		}

		const runCommand = vi.fn().mockResolvedValue({
			exitCode: 0,
			logs: brokenLogs,
		});
		const fakeSbx = makeVercelSandbox({ runCommand });
		mockSandboxCreate.mockResolvedValue(fakeSbx);

		const provider = createVercelProvider();
		const result = await provider.create({});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		// Should not throw — StreamError is caught and partial output returned
		const cmdRes = await result.instance.commands.run("some-cmd");
		expect(cmdRes.stdout).toBe("partial\n");
	});

	// -------------------------------------------------------------------------
	// Kill
	// -------------------------------------------------------------------------

	it("kill calls sandbox.stop()", async () => {
		const stop = vi.fn().mockResolvedValue(undefined);
		const fakeSbx = makeVercelSandbox({ stop });
		mockSandboxCreate.mockResolvedValue(fakeSbx);

		const provider = createVercelProvider();
		const result = await provider.create({});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		await result.instance.kill();
		expect(stop).toHaveBeenCalledOnce();
	});

	it("kill is idempotent — double kill does not throw", async () => {
		const stop = vi
			.fn()
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(new Error("already stopped"));
		const fakeSbx = makeVercelSandbox({ stop });
		mockSandboxCreate.mockResolvedValue(fakeSbx);

		const provider = createVercelProvider();
		const result = await provider.create({});
		if (!result.ok) throw new Error("unreachable");

		await result.instance.kill();
		await expect(result.instance.kill()).resolves.toBeUndefined();
	});
});
