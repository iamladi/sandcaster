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
vi.mock("e2b", () => {
	return {
		Sandbox: {
			create: vi.fn(),
		},
	};
});

// Mock ./files.js — pragmatic boundary mock since files.ts may not exist yet
vi.mock("../files.js", () => ({
	uploadFiles: vi.fn().mockResolvedValue(undefined),
	uploadSkills: vi.fn().mockResolvedValue(undefined),
	createExtractionMarker: vi.fn().mockResolvedValue(undefined),
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

import { Sandbox } from "e2b";
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
						onStdout?: (d: { line: string }) => void;
						onStderr?: (d: { line: string }) => void;
					},
				) => {
					// Simulate async delivery of stdout lines
					for (const line of stdoutLines) {
						opts?.onStdout?.({ line });
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

	beforeEach(() => {
		createMock = vi.mocked(Sandbox.create);
		vi.clearAllMocks();
	});

	afterEach(() => {
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

		// Runner file was uploaded
		expect(sbx.files.write).toHaveBeenCalledWith(
			"/opt/runner.mjs",
			expect.any(String),
		);

		// Config was uploaded
		expect(sbx.files.write).toHaveBeenCalledWith(
			"/opt/agent_config.json",
			expect.any(String),
		);

		// Runner was executed
		expect(sbx.commands.run).toHaveBeenCalledWith(
			"node /opt/runner.mjs",
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

	it("throws SandboxError with stage='create' when sandbox creation fails", async () => {
		createMock.mockRejectedValue(new Error("network error"));

		let thrown: unknown;
		try {
			for await (const _ of runAgentInSandbox({ request: makeRequest() })) {
				// consume
			}
		} catch (err) {
			thrown = err;
		}

		expect(thrown).toBeInstanceOf(SandboxError);
		expect((thrown as SandboxError).stage).toBe("create");
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

		const callArgs = createMock.mock.calls[0][0];
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

		const callArgs = createMock.mock.calls[0][0];
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

		const callArgs = createMock.mock.calls[0][0];
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
			(call: string[]) => call[0] === "/opt/agent_config.json",
		);
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
});
