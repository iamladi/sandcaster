import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock e2b at the module boundary (system dependency)
// Error classes must be defined inside the factory because vi.mock is hoisted
// ---------------------------------------------------------------------------

vi.mock("e2b", () => {
	class NotFoundError extends Error {
		constructor(message: string) {
			super(message);
			this.name = "NotFoundError";
		}
	}
	class AuthenticationError extends Error {
		constructor(message: string) {
			super(message);
			this.name = "AuthenticationError";
		}
	}
	class RateLimitError extends Error {
		constructor(message: string) {
			super(message);
			this.name = "RateLimitError";
		}
	}
	class TimeoutError extends Error {
		constructor(message: string) {
			super(message);
			this.name = "TimeoutError";
		}
	}
	class TemplateError extends Error {
		constructor(message: string) {
			super(message);
			this.name = "TemplateError";
		}
	}

	const mockSandboxCreate = vi.fn();

	return {
		Sandbox: {
			create: mockSandboxCreate,
		},
		NotFoundError,
		AuthenticationError,
		RateLimitError,
		TimeoutError,
		TemplateError,
	};
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
	AuthenticationError,
	TimeoutError as E2BTimeoutError,
	NotFoundError,
	RateLimitError,
	Sandbox,
	TemplateError,
} from "e2b";
import { createE2BProvider } from "../../providers/e2b.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeE2BSandbox(overrides?: {
	filesWrite?: ReturnType<typeof vi.fn>;
	filesRead?: ReturnType<typeof vi.fn>;
	commandsRun?: ReturnType<typeof vi.fn>;
	kill?: ReturnType<typeof vi.fn>;
}) {
	return {
		files: {
			write: overrides?.filesWrite ?? vi.fn().mockResolvedValue(undefined),
			read: overrides?.filesRead ?? vi.fn().mockResolvedValue("content"),
		},
		commands: {
			run:
				overrides?.commandsRun ??
				vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
		},
		kill: overrides?.kill ?? vi.fn().mockResolvedValue(undefined),
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createE2BProvider", () => {
	let createMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		createMock = vi.mocked(Sandbox.create);
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	// -------------------------------------------------------------------------
	// Provider identity
	// -------------------------------------------------------------------------

	it("has name 'e2b'", () => {
		const provider = createE2BProvider();
		expect(provider.name).toBe("e2b");
	});

	// -------------------------------------------------------------------------
	// Successful create
	// -------------------------------------------------------------------------

	it("returns ok: true with a SandboxInstance on success", async () => {
		const fakeSbx = makeE2BSandbox();
		createMock.mockResolvedValue(fakeSbx);

		const provider = createE2BProvider();
		const result = await provider.create({
			template: "sandcaster-v1",
			apiKey: "test-key",
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");
		expect(result.instance).toBeDefined();
	});

	it("instance has workDir '/home/user'", async () => {
		const fakeSbx = makeE2BSandbox();
		createMock.mockResolvedValue(fakeSbx);

		const provider = createE2BProvider();
		const result = await provider.create({ apiKey: "test-key" });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");
		expect(result.instance.workDir).toBe("/home/user");
	});

	it("instance has correct capabilities", async () => {
		const fakeSbx = makeE2BSandbox();
		createMock.mockResolvedValue(fakeSbx);

		const provider = createE2BProvider();
		const result = await provider.create({ apiKey: "test-key" });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");
		expect(result.instance.capabilities).toMatchObject({
			fileSystem: true,
			shellExec: true,
			envInjection: true,
			streaming: true,
			networkPolicy: false,
			snapshots: false,
			reconnect: true,
			customImage: true,
		});
	});

	it("passes template, timeoutMs, envs, metadata, and apiKey to Sandbox.create", async () => {
		const fakeSbx = makeE2BSandbox();
		createMock.mockResolvedValue(fakeSbx);

		const provider = createE2BProvider();
		await provider.create({
			template: "my-template",
			timeoutMs: 60000,
			envs: { FOO: "bar" },
			metadata: { requestId: "req-1" },
			apiKey: "my-api-key",
		});

		expect(createMock).toHaveBeenCalledWith("my-template", {
			apiKey: "my-api-key",
			timeoutMs: 60000,
			envs: { FOO: "bar" },
			metadata: { requestId: "req-1" },
		});
	});

	it("uses default template when none provided", async () => {
		const fakeSbx = makeE2BSandbox();
		createMock.mockResolvedValue(fakeSbx);

		const provider = createE2BProvider();
		await provider.create({ apiKey: "test-key" });

		const callArgs = createMock.mock.calls[0];
		expect(callArgs[0]).toBeDefined(); // template name was provided
	});

	// -------------------------------------------------------------------------
	// File operations
	// -------------------------------------------------------------------------

	it("instance.files.write delegates to E2B sdk files.write", async () => {
		const filesWrite = vi.fn().mockResolvedValue(undefined);
		const fakeSbx = makeE2BSandbox({ filesWrite });
		createMock.mockResolvedValue(fakeSbx);

		const provider = createE2BProvider();
		const result = await provider.create({ apiKey: "test-key" });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		await result.instance.files.write("/some/path", "content");
		expect(filesWrite).toHaveBeenCalledWith("/some/path", "content");
	});

	it("instance.files.read delegates to E2B sdk files.read", async () => {
		const filesRead = vi.fn().mockResolvedValue("read-content");
		const fakeSbx = makeE2BSandbox({ filesRead });
		createMock.mockResolvedValue(fakeSbx);

		const provider = createE2BProvider();
		const result = await provider.create({ apiKey: "test-key" });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		const content = await result.instance.files.read("/some/path", {
			format: "text",
		});
		expect(filesRead).toHaveBeenCalledWith("/some/path", { format: "text" });
		expect(content).toBe("read-content");
	});

	// -------------------------------------------------------------------------
	// Command operations
	// -------------------------------------------------------------------------

	it("instance.commands.run delegates to E2B sdk commands.run", async () => {
		const commandsRun = vi
			.fn()
			.mockResolvedValue({ stdout: "out", stderr: "err", exitCode: 0 });
		const fakeSbx = makeE2BSandbox({ commandsRun });
		createMock.mockResolvedValue(fakeSbx);

		const provider = createE2BProvider();
		const result = await provider.create({ apiKey: "test-key" });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		const cmdResult = await result.instance.commands.run("echo hello");
		expect(commandsRun).toHaveBeenCalledWith("echo hello", undefined);
		expect(cmdResult).toMatchObject({
			stdout: "out",
			stderr: "err",
			exitCode: 0,
		});
	});

	it("returns exitCode instead of throwing when command exits non-zero", async () => {
		const nonZeroError = Object.assign(new Error("Command failed"), {
			stdout: "partial output",
			stderr: "error message",
			exitCode: 1,
		});
		const commandsRun = vi.fn().mockRejectedValueOnce(nonZeroError);
		const fakeSbx = makeE2BSandbox({ commandsRun });
		createMock.mockResolvedValue(fakeSbx);

		const provider = createE2BProvider();
		const result = await provider.create({ apiKey: "test-key" });
		if (!result.ok) throw new Error("unreachable");

		const cmdResult = await result.instance.commands.run("exit 1");
		expect(cmdResult.exitCode).toBe(1);
		expect(cmdResult.stdout).toBe("partial output");
		expect(cmdResult.stderr).toBe("error message");
	});

	it("rethrows errors without exitCode property", async () => {
		const commandsRun = vi
			.fn()
			.mockRejectedValueOnce(new Error("Network error"));
		const fakeSbx = makeE2BSandbox({ commandsRun });
		createMock.mockResolvedValue(fakeSbx);

		const provider = createE2BProvider();
		const result = await provider.create({ apiKey: "test-key" });
		if (!result.ok) throw new Error("unreachable");

		await expect(result.instance.commands.run("ls")).rejects.toThrow(
			"Network error",
		);
	});

	it("instance.commands.run maps onStdout/onStderr/timeoutMs from opts", async () => {
		const commandsRun = vi
			.fn()
			.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
		const fakeSbx = makeE2BSandbox({ commandsRun });
		createMock.mockResolvedValue(fakeSbx);

		const provider = createE2BProvider();
		const result = await provider.create({ apiKey: "test-key" });
		if (!result.ok) throw new Error("unreachable");

		const onStdout = vi.fn();
		const onStderr = vi.fn();
		await result.instance.commands.run("ls", {
			timeoutMs: 5000,
			onStdout,
			onStderr,
		});

		expect(commandsRun).toHaveBeenCalledWith("ls", {
			timeoutMs: 5000,
			onStdout,
			onStderr,
		});
	});

	// -------------------------------------------------------------------------
	// Kill
	// -------------------------------------------------------------------------

	it("instance.kill delegates to E2B sdk kill", async () => {
		const kill = vi.fn().mockResolvedValue(undefined);
		const fakeSbx = makeE2BSandbox({ kill });
		createMock.mockResolvedValue(fakeSbx);

		const provider = createE2BProvider();
		const result = await provider.create({ apiKey: "test-key" });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		await result.instance.kill();
		expect(kill).toHaveBeenCalledOnce();
	});

	it("instance.kill is idempotent — second kill does not throw", async () => {
		const kill = vi
			.fn()
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(new Error("already killed"));
		const fakeSbx = makeE2BSandbox({ kill });
		createMock.mockResolvedValue(fakeSbx);

		const provider = createE2BProvider();
		const result = await provider.create({ apiKey: "test-key" });
		if (!result.ok) throw new Error("unreachable");

		await result.instance.kill();
		// Second kill should not throw even though SDK throws
		await expect(result.instance.kill()).resolves.toBeUndefined();
	});

	// -------------------------------------------------------------------------
	// Error mapping
	// -------------------------------------------------------------------------

	it("maps NotFoundError to TEMPLATE_NOT_FOUND", async () => {
		createMock.mockRejectedValue(new NotFoundError("not found"));

		const provider = createE2BProvider();
		const result = await provider.create({ apiKey: "test-key" });

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("TEMPLATE_NOT_FOUND");
		expect(result.hint).toBeDefined();
	});

	it("maps AuthenticationError to PROVIDER_AUTH_MISSING", async () => {
		createMock.mockRejectedValue(new AuthenticationError("bad key"));

		const provider = createE2BProvider();
		const result = await provider.create({ apiKey: "test-key" });

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("PROVIDER_AUTH_MISSING");
		expect(result.hint).toBeDefined();
	});

	it("maps RateLimitError to RATE_LIMIT", async () => {
		createMock.mockRejectedValue(new RateLimitError("rate limited"));

		const provider = createE2BProvider();
		const result = await provider.create({ apiKey: "test-key" });

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("RATE_LIMIT");
		expect(result.hint).toBeDefined();
	});

	it("maps TimeoutError to SANDBOX_TIMEOUT", async () => {
		createMock.mockRejectedValue(new E2BTimeoutError("timed out"));

		const provider = createE2BProvider();
		const result = await provider.create({ apiKey: "test-key" });

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("SANDBOX_TIMEOUT");
		expect(result.hint).toBeDefined();
	});

	it("maps TemplateError to TEMPLATE_INCOMPATIBLE", async () => {
		createMock.mockRejectedValue(new TemplateError("bad template"));

		const provider = createE2BProvider();
		const result = await provider.create({ apiKey: "test-key" });

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("TEMPLATE_INCOMPATIBLE");
		expect(result.hint).toBeDefined();
	});

	it("maps unknown errors to SANDBOX_ERROR", async () => {
		createMock.mockRejectedValue(new Error("unexpected"));

		const provider = createE2BProvider();
		const result = await provider.create({ apiKey: "test-key" });

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("SANDBOX_ERROR");
	});

	// -------------------------------------------------------------------------
	// Template validation
	// -------------------------------------------------------------------------

	it("returns INVALID_TEMPLATE_FOR_PROVIDER for templates with invalid characters", async () => {
		const provider = createE2BProvider();
		const result = await provider.create({
			template: "invalid template with spaces!",
			apiKey: "test-key",
		});

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("INVALID_TEMPLATE_FOR_PROVIDER");
	});

	it("accepts alphanumeric templates with hyphens", async () => {
		const fakeSbx = makeE2BSandbox();
		createMock.mockResolvedValue(fakeSbx);

		const provider = createE2BProvider();
		const result = await provider.create({
			template: "sandcaster-v1",
			apiKey: "test-key",
		});

		expect(result.ok).toBe(true);
	});

	it("accepts templates with numbers and letters only", async () => {
		const fakeSbx = makeE2BSandbox();
		createMock.mockResolvedValue(fakeSbx);

		const provider = createE2BProvider();
		const result = await provider.create({
			template: "mytemplate123",
			apiKey: "test-key",
		});

		expect(result.ok).toBe(true);
	});
});
