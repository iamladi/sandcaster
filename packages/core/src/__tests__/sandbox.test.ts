import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock node:fs so the runner bundle can load
// ---------------------------------------------------------------------------

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		readFileSync: vi.fn((path: unknown, ...args: unknown[]) => {
			if (typeof path === "string" && path.includes("runner.mjs")) {
				return "// fake runner bundle";
			}
			return actual.readFileSync(
				path as Parameters<typeof actual.readFileSync>[0],
				...(args as Parameters<typeof actual.readFileSync>[1][]),
			);
		}),
	};
});

// ---------------------------------------------------------------------------
// Mock ./files.js — isolate sandbox orchestration from file helpers
// ---------------------------------------------------------------------------

vi.mock("../files.js", () => ({
	uploadFiles: vi.fn().mockResolvedValue(undefined),
	uploadSkills: vi.fn().mockResolvedValue(undefined),
	createExtractionMarker: vi
		.fn()
		.mockResolvedValue("/tmp/sandcaster-extract-test.marker"),
	extractGeneratedFiles: vi.fn().mockResolvedValue([]),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
	createExtractionMarker,
	extractGeneratedFiles,
	uploadFiles,
} from "../files.js";
import { runAgentInSandbox, SandboxError } from "../sandbox.js";
import type { SandboxInstance, SandboxProvider } from "../sandbox-provider.js";
import { registerSandboxProvider, resetRegistry } from "../sandbox-registry.js";
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
 * Build a fake SandboxInstance whose commands.run streams the given lines.
 */
function makeFakeInstance(stdoutLines: string[] = []): SandboxInstance & {
	files: { write: ReturnType<typeof vi.fn> };
	commands: { run: ReturnType<typeof vi.fn> };
	kill: ReturnType<typeof vi.fn>;
} {
	return {
		workDir: "/home/user",
		capabilities: {
			fileSystem: true,
			shellExec: true,
			envInjection: true,
			streaming: true,
			networkPolicy: false,
			snapshots: false,
			reconnect: true,
			customImage: true,
		},
		files: {
			write: vi.fn().mockResolvedValue(undefined),
			read: vi.fn().mockResolvedValue(""),
		},
		commands: {
			run: vi.fn().mockImplementation(
				async (
					_cmd: string,
					opts?: {
						onStdout?: (data: string) => void;
						onStderr?: (data: string) => void;
					},
				) => {
					for (const line of stdoutLines) {
						opts?.onStdout?.(`${line}\n`);
					}
					return { stdout: "", stderr: "", exitCode: 0 };
				},
			),
		},
		kill: vi.fn().mockResolvedValue(undefined),
	};
}

/**
 * Register a fake provider for "e2b" that returns the given instance.
 * Calling create() resolves to { ok: true, instance }.
 */
function registerFakeProvider(
	instance: SandboxInstance,
	opts?: {
		createResult?: Awaited<ReturnType<SandboxProvider["create"]>>;
		captureConfig?: (cfg: Parameters<SandboxProvider["create"]>[0]) => void;
	},
): void {
	registerSandboxProvider("e2b", async () => ({
		name: "e2b" as const,
		create: async (cfg) => {
			opts?.captureConfig?.(cfg);
			if (opts?.createResult !== undefined) {
				return opts.createResult;
			}
			return { ok: true as const, instance };
		},
	}));
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("runAgentInSandbox", () => {
	let savedE2bKey: string | undefined;

	beforeEach(() => {
		// Reset registry state so our fake provider is fresh
		resetRegistry();
		savedE2bKey = process.env.E2B_API_KEY;
		process.env.E2B_API_KEY = "test-e2b-key";
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
		const instance = makeFakeInstance([]);
		registerFakeProvider(instance);

		const events = [];
		for await (const event of runAgentInSandbox({
			request: makeRequest(),
		})) {
			events.push(event);
		}

		// Runner file was uploaded
		expect(instance.files.write).toHaveBeenCalledWith(
			"/opt/sandcaster/runner.mjs",
			expect.any(String),
		);

		// Agent config was uploaded
		expect(instance.files.write).toHaveBeenCalledWith(
			"/opt/sandcaster/agent_config.json",
			expect.any(String),
		);

		// Runner was executed
		expect(instance.commands.run).toHaveBeenCalledWith(
			"node /opt/sandcaster/runner.mjs",
			expect.any(Object),
		);

		// Sandbox was killed
		expect(instance.kill).toHaveBeenCalledOnce();
	});

	// -------------------------------------------------------------------------
	// Event streaming
	// -------------------------------------------------------------------------

	it("yields parsed JSON events from stdout", async () => {
		const event1 = { type: "system", content: "starting" };
		const event2 = { type: "assistant", content: "hello" };
		const instance = makeFakeInstance([
			JSON.stringify(event1),
			JSON.stringify(event2),
		]);
		registerFakeProvider(instance);

		const events = [];
		for await (const event of runAgentInSandbox({ request: makeRequest() })) {
			events.push(event);
		}

		const systemEvent = events.find((e) => e.type === "system");
		const assistantEvent = events.find((e) => e.type === "assistant");
		expect(systemEvent).toMatchObject({ type: "system", content: "starting" });
		expect(assistantEvent).toMatchObject({
			type: "assistant",
			content: "hello",
		});
	});

	it("yields a warning event for invalid JSON lines", async () => {
		const instance = makeFakeInstance([
			"not-valid-json",
			JSON.stringify({ type: "result", content: "done" }),
		]);
		registerFakeProvider(instance);

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
		const instance = makeFakeInstance([]);
		instance.commands.run.mockRejectedValue(new Error("runner crashed"));
		registerFakeProvider(instance);

		const events = [];
		try {
			for await (const event of runAgentInSandbox({
				request: makeRequest(),
			})) {
				events.push(event);
			}
		} catch {
			// may throw or yield error event
		}

		expect(instance.kill).toHaveBeenCalledOnce();
	});

	it("does not call kill when provider.create() fails", async () => {
		const instance = makeFakeInstance([]);
		registerFakeProvider(instance, {
			createResult: {
				ok: false,
				code: "PROVIDER_AUTH_MISSING",
				message: "Auth failed",
				hint: "check your key",
			},
		});

		const events = [];
		for await (const event of runAgentInSandbox({
			request: makeRequest(),
		})) {
			events.push(event);
		}

		// kill should NOT have been called since create() failed
		expect(instance.kill).not.toHaveBeenCalled();
	});

	// -------------------------------------------------------------------------
	// Error handling from provider.create()
	// -------------------------------------------------------------------------

	it("yields error event when provider.create() returns ok: false", async () => {
		const instance = makeFakeInstance([]);
		registerFakeProvider(instance, {
			createResult: {
				ok: false,
				code: "TEMPLATE_NOT_FOUND",
				message: "Template not found",
				hint: "rebuild the template",
			},
		});

		const events = [];
		for await (const event of runAgentInSandbox({
			request: makeRequest(),
		})) {
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

	it("yields error event when runner crashes", async () => {
		const instance = makeFakeInstance([]);
		instance.commands.run.mockRejectedValue(new Error("OOM"));
		registerFakeProvider(instance);

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

		expect(instance.kill).toHaveBeenCalled();
	});

	// -------------------------------------------------------------------------
	// Provider resolution error
	// -------------------------------------------------------------------------

	it("yields error event when no provider can be resolved (no API key)", async () => {
		delete process.env.E2B_API_KEY;
		// Don't register a provider — let resolver fall back to e2b with no key
		// The sandbox.ts should handle the missing credential case
		// After reset, provider.create will get undefined apiKey

		const instance = makeFakeInstance([]);
		// Register a fake provider that returns auth error when no apiKey
		registerSandboxProvider("e2b", async () => ({
			name: "e2b" as const,
			create: async (cfg) => {
				if (!cfg.apiKey) {
					return {
						ok: false as const,
						code: "PROVIDER_AUTH_MISSING" as const,
						message: "E2B API key is not set.",
						hint: "Set E2B_API_KEY in your environment",
					};
				}
				return { ok: true as const, instance };
			},
		}));

		const events = [];
		for await (const event of runAgentInSandbox({
			request: makeRequest({ apiKeys: {} }),
		})) {
			events.push(event);
		}

		const errorEvent = events.find((e) => e.type === "error");
		expect(errorEvent).toBeDefined();
		expect(errorEvent?.type).toBe("error");
		expect(errorEvent).toHaveProperty("code");
	});

	// -------------------------------------------------------------------------
	// Configuration passing
	// -------------------------------------------------------------------------

	it("passes timeout as timeoutMs to provider.create", async () => {
		const instance = makeFakeInstance([]);
		let capturedConfig: Parameters<SandboxProvider["create"]>[0] | undefined;
		registerFakeProvider(instance, {
			captureConfig: (cfg) => {
				capturedConfig = cfg;
			},
		});

		for await (const _ of runAgentInSandbox({
			request: makeRequest({ timeout: 600 }),
		})) {
			// consume
		}

		expect(capturedConfig?.timeoutMs).toBe(600 * 1000);
	});

	it("does not pass template to provider when SANDCASTER_TEMPLATE is unset", async () => {
		const instance = makeFakeInstance([]);
		let capturedConfig: Parameters<SandboxProvider["create"]>[0] | undefined;
		registerFakeProvider(instance, {
			captureConfig: (cfg) => {
				capturedConfig = cfg;
			},
		});

		const origTemplate = process.env.SANDCASTER_TEMPLATE;
		delete process.env.SANDCASTER_TEMPLATE;

		for await (const _ of runAgentInSandbox({
			request: makeRequest(),
		})) {
			// consume
		}

		// Provider should receive undefined template so it uses its own default
		expect(capturedConfig?.template).toBeUndefined();

		if (origTemplate !== undefined) {
			process.env.SANDCASTER_TEMPLATE = origTemplate;
		}
	});

	it("passes SANDCASTER_TEMPLATE to provider when explicitly set", async () => {
		const instance = makeFakeInstance([]);
		let capturedConfig: Parameters<SandboxProvider["create"]>[0] | undefined;
		registerFakeProvider(instance, {
			captureConfig: (cfg) => {
				capturedConfig = cfg;
			},
		});

		const origTemplate = process.env.SANDCASTER_TEMPLATE;
		process.env.SANDCASTER_TEMPLATE = "custom-template-v2";

		for await (const _ of runAgentInSandbox({
			request: makeRequest(),
		})) {
			// consume
		}

		expect(capturedConfig?.template).toBe("custom-template-v2");

		if (origTemplate !== undefined) {
			process.env.SANDCASTER_TEMPLATE = origTemplate;
		} else {
			delete process.env.SANDCASTER_TEMPLATE;
		}
	});

	it("uses default timeout of 300s when request has no timeout", async () => {
		const instance = makeFakeInstance([]);
		let capturedConfig: Parameters<SandboxProvider["create"]>[0] | undefined;
		registerFakeProvider(instance, {
			captureConfig: (cfg) => {
				capturedConfig = cfg;
			},
		});

		for await (const _ of runAgentInSandbox({
			request: makeRequest(),
		})) {
			// consume
		}

		expect(capturedConfig?.timeoutMs).toBe(300 * 1000);
	});

	it("passes API keys as envs to provider.create", async () => {
		const instance = makeFakeInstance([]);
		let capturedConfig: Parameters<SandboxProvider["create"]>[0] | undefined;
		registerFakeProvider(instance, {
			captureConfig: (cfg) => {
				capturedConfig = cfg;
			},
		});

		for await (const _ of runAgentInSandbox({
			request: makeRequest({
				apiKeys: { anthropic: "sk-ant-test", e2b: "e2b-test" },
			}),
		})) {
			// consume
		}

		expect(capturedConfig?.envs).toMatchObject({
			ANTHROPIC_API_KEY: "sk-ant-test",
			E2B_API_KEY: "e2b-test",
		});
	});

	it("forwards request.apiKeys.openrouter as OPENROUTER_API_KEY", async () => {
		const instance = makeFakeInstance([]);
		let capturedConfig: Parameters<SandboxProvider["create"]>[0] | undefined;
		registerFakeProvider(instance, {
			captureConfig: (cfg) => {
				capturedConfig = cfg;
			},
		});

		for await (const _ of runAgentInSandbox({
			request: makeRequest({ apiKeys: { openrouter: "or-test-key" } }),
		})) {
			// consume
		}

		expect(capturedConfig?.envs).toMatchObject({
			OPENROUTER_API_KEY: "or-test-key",
		});
	});

	it("passes process.env API keys as envs", async () => {
		const instance = makeFakeInstance([]);
		let capturedConfig: Parameters<SandboxProvider["create"]>[0] | undefined;
		registerFakeProvider(instance, {
			captureConfig: (cfg) => {
				capturedConfig = cfg;
			},
		});

		const origOR = process.env.OPENROUTER_API_KEY;
		const origGG = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
		process.env.OPENROUTER_API_KEY = "or-env-key";
		process.env.GOOGLE_GENERATIVE_AI_API_KEY = "gg-env-key";

		for await (const _ of runAgentInSandbox({
			request: makeRequest(),
		})) {
			// consume
		}

		expect(capturedConfig?.envs).toMatchObject({
			OPENROUTER_API_KEY: "or-env-key",
			GOOGLE_GENERATIVE_AI_API_KEY: "gg-env-key",
		});

		if (origOR !== undefined) process.env.OPENROUTER_API_KEY = origOR;
		else delete process.env.OPENROUTER_API_KEY;
		if (origGG !== undefined) process.env.GOOGLE_GENERATIVE_AI_API_KEY = origGG;
		else delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
	});

	it("writes agent_config.json with merged config fields", async () => {
		const instance = makeFakeInstance([]);
		registerFakeProvider(instance);

		for await (const _ of runAgentInSandbox({
			request: makeRequest({ prompt: "test prompt", maxTurns: 5 }),
		})) {
			// consume
		}

		const configWriteCall = instance.files.write.mock.calls.find(
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
		const instance = makeFakeInstance([]);
		registerFakeProvider(instance);

		for await (const _ of runAgentInSandbox({
			request: makeRequest({ files: { "hello.txt": "world" } }),
		})) {
			// consume
		}

		expect(uploadFiles).toHaveBeenCalledOnce();
		expect(uploadFiles).toHaveBeenCalledWith(instance, {
			"hello.txt": "world",
		});
	});

	it("does not call uploadFiles when request has no files", async () => {
		const instance = makeFakeInstance([]);
		registerFakeProvider(instance);

		for await (const _ of runAgentInSandbox({ request: makeRequest() })) {
			// consume
		}

		expect(uploadFiles).not.toHaveBeenCalled();
	});

	it("calls createExtractionMarker with the requestId", async () => {
		const instance = makeFakeInstance([]);
		registerFakeProvider(instance);

		for await (const _ of runAgentInSandbox({
			request: makeRequest(),
			requestId: "req-abc",
		})) {
			// consume
		}

		expect(createExtractionMarker).toHaveBeenCalledWith(instance, "req-abc");
	});

	it("calls extractGeneratedFiles after runner completes", async () => {
		const instance = makeFakeInstance([]);
		registerFakeProvider(instance);

		for await (const _ of runAgentInSandbox({ request: makeRequest() })) {
			// consume
		}

		expect(extractGeneratedFiles).toHaveBeenCalledOnce();
	});

	// -------------------------------------------------------------------------
	// API key redaction
	// -------------------------------------------------------------------------

	it("does not include apiKeys values in error content when runner crashes", async () => {
		const instance = makeFakeInstance([]);
		instance.commands.run.mockRejectedValue(new Error("process died"));
		registerFakeProvider(instance);

		const events = [];
		try {
			for await (const event of runAgentInSandbox({
				request: makeRequest({
					apiKeys: { anthropic: "sk-ant-secret-value" },
				}),
			})) {
				events.push(event);
			}
		} catch {
			// may throw
		}

		// Check error events don't leak the API key value
		const errorEvents = events.filter((e) => e.type === "error");
		for (const event of errorEvents) {
			expect(JSON.stringify(event)).not.toContain("sk-ant-secret-value");
		}
	});

	it("redacts API key values from error messages that contain them", async () => {
		const instance = makeFakeInstance([]);
		// Simulate an error that includes the API key in its message
		instance.commands.run.mockRejectedValue(
			new Error(
				"Authentication failed with key sk-ant-secret-value for endpoint",
			),
		);
		registerFakeProvider(instance);

		const events = [];
		try {
			for await (const event of runAgentInSandbox({
				request: makeRequest({
					apiKeys: { anthropic: "sk-ant-secret-value" },
				}),
			})) {
				events.push(event);
			}
		} catch {
			// may throw
		}

		const errorEvents = events.filter((e) => e.type === "error");
		for (const event of errorEvents) {
			expect(JSON.stringify(event)).not.toContain("sk-ant-secret-value");
		}
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
