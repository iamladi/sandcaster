import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock node:fs so runner bundle loading doesn't hit disk
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
		existsSync: vi.fn((path: unknown) => {
			// Suppress Docker socket detection during tests
			if (
				typeof path === "string" &&
				(path.includes("docker.sock") || path.includes("/run/docker.sock"))
			) {
				return false;
			}
			return actual.existsSync(path as string);
		}),
	};
});

// ---------------------------------------------------------------------------
// Mock ./files.js — isolate orchestration from file helpers
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

import { runAgentInSandbox } from "../sandbox.js";
import type { SandboxInstance, SandboxProvider } from "../sandbox-provider.js";
import { registerSandboxProvider, resetRegistry } from "../sandbox-registry.js";
import type { QueryRequest } from "../schemas.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(overrides: Partial<QueryRequest> = {}): QueryRequest {
	return {
		prompt: "integration test prompt",
		...overrides,
	};
}

/**
 * Build a minimal fake SandboxInstance.
 * stdoutLines are emitted via onStdout one-by-one when commands.run is called.
 */
function makeFakeInstance(stdoutLines: string[] = []): SandboxInstance & {
	files: {
		write: ReturnType<typeof vi.fn>;
		read: ReturnType<typeof vi.fn>;
	};
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
			reconnect: false,
			customImage: false,
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

interface TrackingProvider extends SandboxProvider {
	createCallCount: number;
}

function makeTrackingProvider(
	name: "e2b" | "vercel" | "docker" | "cloudflare",
	instance: SandboxInstance,
	opts?: {
		createResult?: Awaited<ReturnType<SandboxProvider["create"]>>;
	},
): TrackingProvider {
	const provider: TrackingProvider = {
		name,
		createCallCount: 0,
		create: async (_cfg) => {
			provider.createCallCount++;
			if (opts?.createResult !== undefined) {
				return opts.createResult;
			}
			return { ok: true as const, instance };
		},
	};
	return provider;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("sandbox-integration", () => {
	let savedE2bKey: string | undefined;
	let savedVercelToken: string | undefined;
	let savedDockerHost: string | undefined;

	beforeEach(() => {
		resetRegistry();
		savedE2bKey = process.env.E2B_API_KEY;
		savedVercelToken = process.env.VERCEL_TOKEN;
		savedDockerHost = process.env.DOCKER_HOST;
		// Set E2B key so resolver auto-detects "e2b"
		process.env.E2B_API_KEY = "test-e2b-key";
		delete process.env.VERCEL_TOKEN;
		delete process.env.DOCKER_HOST;
	});

	afterEach(() => {
		if (savedE2bKey !== undefined) {
			process.env.E2B_API_KEY = savedE2bKey;
		} else {
			delete process.env.E2B_API_KEY;
		}
		if (savedVercelToken !== undefined) {
			process.env.VERCEL_TOKEN = savedVercelToken;
		} else {
			delete process.env.VERCEL_TOKEN;
		}
		if (savedDockerHost !== undefined) {
			process.env.DOCKER_HOST = savedDockerHost;
		} else {
			delete process.env.DOCKER_HOST;
		}
		vi.clearAllMocks();
	});

	// -----------------------------------------------------------------------
	// Full flow: resolve → create → upload → run → extract → kill
	// -----------------------------------------------------------------------

	it("full flow: resolve provider, create, upload runner, run, extract files, kill", async () => {
		const instance = makeFakeInstance([
			JSON.stringify({ type: "system", content: "starting" }),
			JSON.stringify({ type: "result", content: "done" }),
		]);
		const provider = makeTrackingProvider("e2b", instance);
		registerSandboxProvider("e2b", async () => provider);

		const events = [];
		for await (const event of runAgentInSandbox({
			request: makeRequest(),
			requestId: "integ-req-1",
		})) {
			events.push(event);
		}

		// Provider was called once
		expect(provider.createCallCount).toBe(1);

		// Runner bundle was written
		expect(instance.files.write).toHaveBeenCalledWith(
			"/opt/sandcaster/runner.mjs",
			expect.any(String),
		);

		// Agent config was written
		expect(instance.files.write).toHaveBeenCalledWith(
			"/opt/sandcaster/agent_config.json",
			expect.any(String),
		);

		// Runner command was executed
		expect(instance.commands.run).toHaveBeenCalledWith(
			"node /opt/sandcaster/runner.mjs",
			expect.any(Object),
		);

		// Sandbox was killed in finally block
		expect(instance.kill).toHaveBeenCalledOnce();

		// Events from stdout were yielded
		const systemEvent = events.find((e) => e.type === "system");
		const resultEvent = events.find((e) => e.type === "result");
		expect(systemEvent).toMatchObject({ type: "system", content: "starting" });
		expect(resultEvent).toMatchObject({ type: "result", content: "done" });
	});

	// -----------------------------------------------------------------------
	// Provider resolution chain
	// -----------------------------------------------------------------------

	it("request.sandboxProvider overrides env auto-detect", async () => {
		// Env would auto-detect "e2b", but request overrides to "docker"
		const e2bInstance = makeFakeInstance([]);
		const dockerInstance = makeFakeInstance([]);
		const e2bProvider = makeTrackingProvider("e2b", e2bInstance);
		const dockerProvider = makeTrackingProvider("docker", dockerInstance);

		registerSandboxProvider("e2b", async () => e2bProvider);
		registerSandboxProvider("docker", async () => dockerProvider);

		for await (const _ of runAgentInSandbox({
			request: makeRequest({ sandboxProvider: "docker" }),
		})) {
			// consume
		}

		expect(dockerProvider.createCallCount).toBe(1);
		expect(e2bProvider.createCallCount).toBe(0);
		expect(dockerInstance.kill).toHaveBeenCalledOnce();
		expect(e2bInstance.kill).not.toHaveBeenCalled();
	});

	it("config.sandboxProvider overrides env auto-detect", async () => {
		const e2bInstance = makeFakeInstance([]);
		const vercelInstance = makeFakeInstance([]);
		const e2bProvider = makeTrackingProvider("e2b", e2bInstance);
		const vercelProvider = makeTrackingProvider("vercel", vercelInstance);

		registerSandboxProvider("e2b", async () => e2bProvider);
		registerSandboxProvider("vercel", async () => vercelProvider);

		for await (const _ of runAgentInSandbox({
			request: makeRequest(),
			config: { sandboxProvider: "vercel" },
		})) {
			// consume
		}

		expect(vercelProvider.createCallCount).toBe(1);
		expect(e2bProvider.createCallCount).toBe(0);
	});

	it("request.sandboxProvider overrides config.sandboxProvider", async () => {
		const vercelInstance = makeFakeInstance([]);
		const dockerInstance = makeFakeInstance([]);
		const vercelProvider = makeTrackingProvider("vercel", vercelInstance);
		const dockerProvider = makeTrackingProvider("docker", dockerInstance);

		registerSandboxProvider("vercel", async () => vercelProvider);
		registerSandboxProvider("docker", async () => dockerProvider);

		// config says "vercel", request overrides to "docker"
		for await (const _ of runAgentInSandbox({
			request: makeRequest({ sandboxProvider: "docker" }),
			config: { sandboxProvider: "vercel" },
		})) {
			// consume
		}

		expect(dockerProvider.createCallCount).toBe(1);
		expect(vercelProvider.createCallCount).toBe(0);
	});

	it("env auto-detect resolves correct provider when only VERCEL_TOKEN is set", async () => {
		delete process.env.E2B_API_KEY;
		process.env.VERCEL_TOKEN = "vercel-token-abc";

		const vercelInstance = makeFakeInstance([]);
		const vercelProvider = makeTrackingProvider("vercel", vercelInstance);
		registerSandboxProvider("vercel", async () => vercelProvider);

		for await (const _ of runAgentInSandbox({
			request: makeRequest(),
		})) {
			// consume
		}

		expect(vercelProvider.createCallCount).toBe(1);
	});

	// -----------------------------------------------------------------------
	// Non-streaming provider (streaming: false capability)
	// -----------------------------------------------------------------------

	it("runner still works when provider has streaming: false capability", async () => {
		const instance = makeFakeInstance([
			JSON.stringify({ type: "result", content: "buffered done" }),
		]);
		// Override capabilities to mark streaming as false
		instance.capabilities.streaming = false;

		const provider = makeTrackingProvider("e2b", instance);
		registerSandboxProvider("e2b", async () => provider);

		const events = [];
		for await (const event of runAgentInSandbox({
			request: makeRequest(),
		})) {
			events.push(event);
		}

		// The runner still uses onStdout callbacks regardless of streaming capability
		// so it should still yield events and kill
		expect(instance.kill).toHaveBeenCalledOnce();
		const resultEvent = events.find((e) => e.type === "result");
		expect(resultEvent).toMatchObject({
			type: "result",
			content: "buffered done",
		});
	});

	// -----------------------------------------------------------------------
	// Cleanup guarantee: kill() called even when run throws
	// -----------------------------------------------------------------------

	it("kill() is called even when commands.run throws during execution", async () => {
		const instance = makeFakeInstance([]);
		instance.commands.run.mockRejectedValue(new Error("runner crashed hard"));

		const provider = makeTrackingProvider("e2b", instance);
		registerSandboxProvider("e2b", async () => provider);

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

	it("kill() is called even when file upload throws after create succeeds", async () => {
		const instance = makeFakeInstance([]);
		// Make files.write throw on the second call (agent_config upload)
		instance.files.write
			.mockResolvedValueOnce(undefined) // runner.mjs succeeds
			.mockRejectedValueOnce(new Error("disk full")); // agent_config fails

		const provider = makeTrackingProvider("e2b", instance);
		registerSandboxProvider("e2b", async () => provider);

		try {
			for await (const _ of runAgentInSandbox({
				request: makeRequest(),
			})) {
				// consume
			}
		} catch {
			// expected
		}

		expect(instance.kill).toHaveBeenCalledOnce();
	});

	// -----------------------------------------------------------------------
	// Error propagation: provider.create() returns ok: false
	// -----------------------------------------------------------------------

	it("yields error event with correct code when provider.create() returns PROVIDER_AUTH_MISSING", async () => {
		const instance = makeFakeInstance([]);
		const provider = makeTrackingProvider("e2b", instance, {
			createResult: {
				ok: false,
				code: "PROVIDER_AUTH_MISSING",
				message: "E2B API key is not set.",
				hint: "Set E2B_API_KEY in your environment",
			},
		});
		registerSandboxProvider("e2b", async () => provider);

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
			code: "PROVIDER_AUTH_MISSING",
			hint: "Set E2B_API_KEY in your environment",
		});
	});

	it("does not call kill when provider.create() returns ok: false", async () => {
		const instance = makeFakeInstance([]);
		const provider = makeTrackingProvider("e2b", instance, {
			createResult: {
				ok: false,
				code: "TEMPLATE_NOT_FOUND",
				message: "Template not found",
			},
		});
		registerSandboxProvider("e2b", async () => provider);

		for await (const _ of runAgentInSandbox({
			request: makeRequest(),
		})) {
			// consume
		}

		expect(instance.kill).not.toHaveBeenCalled();
	});

	// -----------------------------------------------------------------------
	// API key redaction
	// -----------------------------------------------------------------------

	it("error events do not contain raw API key values when runner crashes", async () => {
		const instance = makeFakeInstance([]);
		instance.commands.run.mockRejectedValue(new Error("oom"));

		const provider = makeTrackingProvider("e2b", instance);
		registerSandboxProvider("e2b", async () => provider);

		const events = [];
		try {
			for await (const event of runAgentInSandbox({
				request: makeRequest({
					apiKeys: { anthropic: "sk-ant-super-secret-key" },
				}),
			})) {
				events.push(event);
			}
		} catch {
			// may throw
		}

		const errorEvents = events.filter((e) => e.type === "error");
		for (const event of errorEvents) {
			expect(JSON.stringify(event)).not.toContain("sk-ant-super-secret-key");
		}
	});

	it("error events do not contain raw API key values when create fails", async () => {
		const instance = makeFakeInstance([]);
		const provider = makeTrackingProvider("e2b", instance, {
			createResult: {
				ok: false,
				code: "PROVIDER_AUTH_MISSING",
				message: "Auth failed — key invalid",
			},
		});
		registerSandboxProvider("e2b", async () => provider);

		const events = [];
		for await (const event of runAgentInSandbox({
			request: makeRequest({
				apiKeys: { e2b: "e2b-raw-secret-value" },
			}),
		})) {
			events.push(event);
		}

		const errorEvents = events.filter((e) => e.type === "error");
		for (const event of errorEvents) {
			expect(JSON.stringify(event)).not.toContain("e2b-raw-secret-value");
		}
	});

	// -----------------------------------------------------------------------
	// Provider selection: request.sandboxProvider targets correct provider
	// -----------------------------------------------------------------------

	it("uses 'docker' provider create() when request.sandboxProvider is 'docker'", async () => {
		const e2bInstance = makeFakeInstance([]);
		const dockerInstance = makeFakeInstance([]);
		const e2bProvider = makeTrackingProvider("e2b", e2bInstance);
		const dockerProvider = makeTrackingProvider("docker", dockerInstance);

		registerSandboxProvider("e2b", async () => e2bProvider);
		registerSandboxProvider("docker", async () => dockerProvider);

		for await (const _ of runAgentInSandbox({
			request: makeRequest({ sandboxProvider: "docker" }),
		})) {
			// consume
		}

		expect(dockerProvider.createCallCount).toBe(1);
		expect(e2bProvider.createCallCount).toBe(0);
		expect(dockerInstance.kill).toHaveBeenCalledOnce();
	});

	it("uses 'cloudflare' provider create() when request.sandboxProvider is 'cloudflare'", async () => {
		const e2bInstance = makeFakeInstance([]);
		const cfInstance = makeFakeInstance([]);
		const e2bProvider = makeTrackingProvider("e2b", e2bInstance);
		const cfProvider = makeTrackingProvider("cloudflare", cfInstance);

		registerSandboxProvider("e2b", async () => e2bProvider);
		registerSandboxProvider("cloudflare", async () => cfProvider);

		for await (const _ of runAgentInSandbox({
			request: makeRequest({ sandboxProvider: "cloudflare" }),
		})) {
			// consume
		}

		expect(cfProvider.createCallCount).toBe(1);
		expect(e2bProvider.createCallCount).toBe(0);
		expect(cfInstance.kill).toHaveBeenCalledOnce();
	});
});
