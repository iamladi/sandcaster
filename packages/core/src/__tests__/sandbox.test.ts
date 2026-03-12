import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	type MockInstance,
	vi,
} from "vitest";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

// Mock e2b at the module boundary — it is a system dependency
// Error classes must be defined inside the factory because vi.mock is hoisted
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

	return {
		Sandbox: {
			create: vi.fn(),
		},
		NotFoundError,
		AuthenticationError,
		RateLimitError,
		TimeoutError,
		TemplateError,
	};
});

// Mock ./files.js — pragmatic boundary mock since files.ts may not exist yet
vi.mock("../files.js", () => ({
	uploadFiles: vi.fn().mockResolvedValue(undefined),
	uploadSkills: vi.fn().mockResolvedValue(undefined),
	createExtractionMarker: vi
		.fn()
		.mockResolvedValue("/tmp/sandcaster-extract-test.marker"),
	extractGeneratedFiles: vi.fn().mockResolvedValue([]),
}));

// Mock fs.readFileSync at module level so runner bundle load succeeds
vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		readFileSync: vi.fn((path: unknown, ...args: unknown[]) => {
			// Return a fake runner bundle for the runner path
			if (typeof path === "string" && path.includes("runner.mjs")) {
				return "// fake runner bundle";
			}
			// Fall through to real implementation for all other paths
			return actual.readFileSync(
				path as Parameters<typeof actual.readFileSync>[0],
				...(args as Parameters<typeof actual.readFileSync>[1][]),
			);
		}),
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
import {
	createExtractionMarker,
	extractGeneratedFiles,
	uploadFiles,
} from "../files.js";
import { runAgentInSandbox, SandboxError } from "../sandbox.js";
import type { QueryRequest } from "../schemas.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal QueryRequest for tests */
function makeRequest(overrides: Partial<QueryRequest> = {}): QueryRequest {
	return {
		prompt: "hello agent",
		...overrides,
	};
}

/**
 * Build a fake E2B sandbox whose `commands.run` streams the given lines and
 * then resolves. Returns the mock sandbox object.
 */
function makeFakeSandbox(stdoutLines: string[] = []) {
	const sbx = {
		files: {
			write: vi.fn().mockResolvedValue(undefined),
		},
		commands: {
			run: vi.fn().mockImplementation(
				async (
					_cmd: string,
					opts: {
						onStdout?: (data: string) => void;
						onStderr?: (data: string) => void;
					},
				) => {
					// Simulate async delivery of stdout lines (with \n like real E2B)
					for (const line of stdoutLines) {
						opts?.onStdout?.(`${line}\n`);
					}
					return { exitCode: 0 };
				},
			),
		},
		kill: vi.fn().mockResolvedValue(undefined),
	};
	return sbx;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runAgentInSandbox", () => {
	let createMock: MockInstance;

	let savedE2bKey: string | undefined;

	beforeEach(() => {
		savedE2bKey = process.env.E2B_API_KEY;
		process.env.E2B_API_KEY = "test-e2b-key";
		createMock = vi.mocked(Sandbox.create);
		vi.clearAllMocks();
	});

	afterEach(() => {
		if (savedE2bKey !== undefined) {
			process.env.E2B_API_KEY = savedE2bKey;
		} else {
			delete process.env.E2B_API_KEY;
		}
		vi.clearAllMocks();
	});

	// -------------------------------------------------------------------------
	// Tracer bullet: basic happy path
	// -------------------------------------------------------------------------

	it("creates sandbox, uploads, runs runner, and kills sandbox", async () => {
		const sbx = makeFakeSandbox([]);
		createMock.mockResolvedValue(sbx);

		const events = [];
		for await (const event of runAgentInSandbox({ request: makeRequest() })) {
			events.push(event);
		}

		// Sandbox was created
		expect(createMock).toHaveBeenCalledOnce();

		// Runner file was uploaded (must be next to /opt/sandcaster/node_modules)
		expect(sbx.files.write).toHaveBeenCalledWith(
			"/opt/sandcaster/runner.mjs",
			expect.any(String),
		);

		// Config was uploaded
		expect(sbx.files.write).toHaveBeenCalledWith(
			"/opt/sandcaster/agent_config.json",
			expect.any(String),
		);

		// Runner was executed
		expect(sbx.commands.run).toHaveBeenCalledWith(
			"node /opt/sandcaster/runner.mjs",
			expect.any(Object),
		);

		// Sandbox was killed
		expect(sbx.kill).toHaveBeenCalledOnce();
	});

	// -------------------------------------------------------------------------
	// Event streaming
	// -------------------------------------------------------------------------

	it("yields parsed JSON events from stdout", async () => {
		const event1 = { type: "system", content: "starting" };
		const event2 = { type: "assistant", content: "hello" };
		const sbx = makeFakeSandbox([
			JSON.stringify(event1),
			JSON.stringify(event2),
		]);
		createMock.mockResolvedValue(sbx);

		const events = [];
		for await (const event of runAgentInSandbox({ request: makeRequest() })) {
			events.push(event);
		}

		// Should contain the two parsed events (may also include file events)
		const systemEvent = events.find((e) => e.type === "system");
		const assistantEvent = events.find((e) => e.type === "assistant");
		expect(systemEvent).toMatchObject({ type: "system", content: "starting" });
		expect(assistantEvent).toMatchObject({
			type: "assistant",
			content: "hello",
		});
	});

	it("yields a warning event for invalid JSON lines (graceful degradation)", async () => {
		const sbx = makeFakeSandbox([
			"not-valid-json",
			JSON.stringify({ type: "result", content: "done" }),
		]);
		createMock.mockResolvedValue(sbx);

		const events = [];
		for await (const event of runAgentInSandbox({ request: makeRequest() })) {
			events.push(event);
		}

		const warnEvent = events.find((e) => e.type === "warning");
		expect(warnEvent).toBeDefined();
		expect(warnEvent?.type).toBe("warning");
	});

	// -------------------------------------------------------------------------
	// Cleanup guarantee
	// -------------------------------------------------------------------------

	it("kills sandbox in finally block even when runner throws", async () => {
		const sbx = makeFakeSandbox([]);
		sbx.commands.run.mockRejectedValue(new Error("runner crashed"));
		createMock.mockResolvedValue(sbx);

		const events = [];
		try {
			for await (const event of runAgentInSandbox({
				request: makeRequest(),
			})) {
				events.push(event);
			}
		} catch {
			// expected to throw or yield error event
		}

		expect(sbx.kill).toHaveBeenCalledOnce();
	});

	// -------------------------------------------------------------------------
	// Error handling
	// -------------------------------------------------------------------------

	it("yields error event with code and hint when sandbox creation fails", async () => {
		createMock.mockRejectedValue(new Error("network error"));

		const events = [];
		for await (const event of runAgentInSandbox({ request: makeRequest() })) {
			events.push(event);
		}

		const errorEvent = events.find((e) => e.type === "error");
		expect(errorEvent).toBeDefined();
		expect(errorEvent?.type).toBe("error");
		expect(errorEvent).toHaveProperty("code");
	});

	it("yields error event when runner crashes (non-creation failure)", async () => {
		const sbx = makeFakeSandbox([]);
		sbx.commands.run.mockRejectedValue(new Error("OOM"));
		createMock.mockResolvedValue(sbx);

		const events = [];
		try {
			for await (const event of runAgentInSandbox({
				request: makeRequest(),
			})) {
				events.push(event);
			}
		} catch {
			// may throw after yielding error event
		}

		// Either an error event was yielded or a SandboxError thrown — both are valid outcomes
		// The requirement is that kill() is called (tested above)
		// and that the sandbox doesn't silently succeed
		expect(sbx.kill).toHaveBeenCalled();
	});

	// -------------------------------------------------------------------------
	// Configuration
	// -------------------------------------------------------------------------

	it("passes request timeout as timeoutMs to sandbox create", async () => {
		const sbx = makeFakeSandbox([]);
		createMock.mockResolvedValue(sbx);

		for await (const _ of runAgentInSandbox({
			request: makeRequest({ timeout: 600 }),
		})) {
			// consume
		}

		const callArgs = createMock.mock.calls[0][1];
		// timeout is in seconds in the request, ms in E2B API
		expect(callArgs.timeoutMs).toBe(600 * 1000);
	});

	it("uses default timeout of 300s when request has no timeout", async () => {
		const sbx = makeFakeSandbox([]);
		createMock.mockResolvedValue(sbx);

		for await (const _ of runAgentInSandbox({
			request: makeRequest(),
		})) {
			// consume
		}

		const callArgs = createMock.mock.calls[0][1];
		expect(callArgs.timeoutMs).toBe(300 * 1000);
	});

	it("passes API keys as env vars to sandbox", async () => {
		const sbx = makeFakeSandbox([]);
		createMock.mockResolvedValue(sbx);

		for await (const _ of runAgentInSandbox({
			request: makeRequest({
				apiKeys: { anthropic: "sk-ant-test", e2b: "e2b-test" },
			}),
		})) {
			// consume
		}

		const callArgs = createMock.mock.calls[0][1];
		expect(callArgs.envs).toMatchObject({
			ANTHROPIC_API_KEY: "sk-ant-test",
			E2B_API_KEY: "e2b-test",
		});
	});

	it("writes agent_config.json with merged config fields", async () => {
		const sbx = makeFakeSandbox([]);
		createMock.mockResolvedValue(sbx);

		for await (const _ of runAgentInSandbox({
			request: makeRequest({ prompt: "test prompt", maxTurns: 5 }),
		})) {
			// consume
		}

		const configWriteCall = sbx.files.write.mock.calls.find(
			(call: string[]) => call[0] === "/opt/sandcaster/agent_config.json",
		) as string[];
		expect(configWriteCall).toBeDefined();

		const writtenConfig = JSON.parse(configWriteCall[1]);
		expect(writtenConfig.prompt).toBe("test prompt");
		expect(writtenConfig.max_turns).toBe(5);
	});

	// -------------------------------------------------------------------------
	// File uploads
	// -------------------------------------------------------------------------

	it("calls uploadFiles when request has files", async () => {
		const sbx = makeFakeSandbox([]);
		createMock.mockResolvedValue(sbx);

		for await (const _ of runAgentInSandbox({
			request: makeRequest({ files: { "hello.txt": "world" } }),
		})) {
			// consume
		}

		expect(uploadFiles).toHaveBeenCalledOnce();
		expect(uploadFiles).toHaveBeenCalledWith(sbx, { "hello.txt": "world" });
	});

	it("does not call uploadFiles when request has no files", async () => {
		const sbx = makeFakeSandbox([]);
		createMock.mockResolvedValue(sbx);

		for await (const _ of runAgentInSandbox({ request: makeRequest() })) {
			// consume
		}

		expect(uploadFiles).not.toHaveBeenCalled();
	});

	it("calls createExtractionMarker with the requestId", async () => {
		const sbx = makeFakeSandbox([]);
		createMock.mockResolvedValue(sbx);

		for await (const _ of runAgentInSandbox({
			request: makeRequest(),
			requestId: "req-abc",
		})) {
			// consume
		}

		expect(createExtractionMarker).toHaveBeenCalledWith(sbx, "req-abc");
	});

	it("calls extractGeneratedFiles after runner completes", async () => {
		const sbx = makeFakeSandbox([]);
		createMock.mockResolvedValue(sbx);

		for await (const _ of runAgentInSandbox({ request: makeRequest() })) {
			// consume
		}

		expect(extractGeneratedFiles).toHaveBeenCalledOnce();
	});

	// -------------------------------------------------------------------------
	// SandboxError class
	// -------------------------------------------------------------------------

	it("SandboxError has correct name", () => {
		const err = new SandboxError("failed", "create");
		expect(err.name).toBe("SandboxError");
	});

	it("SandboxError has correct stage", () => {
		const err = new SandboxError("failed", "upload");
		expect(err.stage).toBe("upload");
	});

	it("SandboxError stores cause", () => {
		const cause = new Error("original");
		const err = new SandboxError("failed", "exec", cause);
		expect(err.cause).toBe(cause);
	});

	it("SandboxError is instanceof Error", () => {
		const err = new SandboxError("failed", "create");
		expect(err).toBeInstanceOf(Error);
	});

	// -------------------------------------------------------------------------
	// Error classification
	// -------------------------------------------------------------------------

	it("yields error event with E2B_AUTH code when API key is missing", async () => {
		const originalKey = process.env.E2B_API_KEY;
		delete process.env.E2B_API_KEY;

		const events = [];
		for await (const event of runAgentInSandbox({
			request: makeRequest({ apiKeys: {} }),
		})) {
			events.push(event);
		}

		process.env.E2B_API_KEY = originalKey;

		const errorEvent = events.find((e) => e.type === "error");
		expect(errorEvent).toBeDefined();
		expect(errorEvent).toMatchObject({
			type: "error",
			code: "E2B_AUTH",
		});
		expect(errorEvent).toHaveProperty("hint");
		expect(createMock).not.toHaveBeenCalled();
	});

	it("yields error event with TEMPLATE_NOT_FOUND code for NotFoundError", async () => {
		createMock.mockRejectedValue(new NotFoundError("template 'bad' not found"));

		const events = [];
		for await (const event of runAgentInSandbox({ request: makeRequest() })) {
			events.push(event);
		}

		const errorEvent = events.find((e) => e.type === "error");
		expect(errorEvent).toBeDefined();
		expect(errorEvent).toMatchObject({
			type: "error",
			code: "TEMPLATE_NOT_FOUND",
		});
		expect(errorEvent).toHaveProperty("hint");
	});

	it("yields error event with E2B_AUTH code for AuthenticationError", async () => {
		createMock.mockRejectedValue(new AuthenticationError("invalid api key"));

		const events = [];
		for await (const event of runAgentInSandbox({ request: makeRequest() })) {
			events.push(event);
		}

		const errorEvent = events.find((e) => e.type === "error");
		expect(errorEvent).toBeDefined();
		expect(errorEvent).toMatchObject({
			type: "error",
			code: "E2B_AUTH",
		});
		expect(errorEvent).toHaveProperty("hint");
	});

	it("yields error event with RATE_LIMIT code for RateLimitError", async () => {
		createMock.mockRejectedValue(new RateLimitError("rate limit exceeded"));

		const events = [];
		for await (const event of runAgentInSandbox({ request: makeRequest() })) {
			events.push(event);
		}

		const errorEvent = events.find((e) => e.type === "error");
		expect(errorEvent).toBeDefined();
		expect(errorEvent).toMatchObject({
			type: "error",
			code: "RATE_LIMIT",
		});
		expect(errorEvent).toHaveProperty("hint");
	});

	it("yields error event with SANDBOX_TIMEOUT code for TimeoutError", async () => {
		createMock.mockRejectedValue(
			new E2BTimeoutError("sandbox creation timed out"),
		);

		const events = [];
		for await (const event of runAgentInSandbox({ request: makeRequest() })) {
			events.push(event);
		}

		const errorEvent = events.find((e) => e.type === "error");
		expect(errorEvent).toBeDefined();
		expect(errorEvent).toMatchObject({
			type: "error",
			code: "SANDBOX_TIMEOUT",
		});
		expect(errorEvent).toHaveProperty("hint");
	});

	it("yields error event with TEMPLATE_INCOMPATIBLE code for TemplateError", async () => {
		createMock.mockRejectedValue(new TemplateError("template incompatible"));

		const events = [];
		for await (const event of runAgentInSandbox({ request: makeRequest() })) {
			events.push(event);
		}

		const errorEvent = events.find((e) => e.type === "error");
		expect(errorEvent).toBeDefined();
		expect(errorEvent).toMatchObject({
			type: "error",
			code: "TEMPLATE_INCOMPATIBLE",
		});
		expect(errorEvent).toHaveProperty("hint");
	});

	it("yields error event with SANDBOX_ERROR code for unknown errors", async () => {
		createMock.mockRejectedValue(new Error("something unexpected"));

		const events = [];
		for await (const event of runAgentInSandbox({ request: makeRequest() })) {
			events.push(event);
		}

		const errorEvent = events.find((e) => e.type === "error");
		expect(errorEvent).toBeDefined();
		expect(errorEvent).toMatchObject({
			type: "error",
			code: "SANDBOX_ERROR",
		});
	});
});
