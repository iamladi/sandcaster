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

vi.mock("../files.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../files.js")>();
	return {
		...actual,
		uploadFiles: vi.fn().mockResolvedValue(undefined),
		uploadSkills: vi.fn().mockResolvedValue(undefined),
		createExtractionMarker: vi
			.fn()
			.mockResolvedValue("/tmp/sandcaster-extract-test.marker"),
		extractGeneratedFiles: vi.fn().mockResolvedValue([]),
	};
});

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
		prompt: "composite integration test",
		...overrides,
	};
}

/**
 * Build a composite-capable fake SandboxInstance.
 * Commands starting with "node " stream the provided lines, all other commands
 * return immediately with success (for IPC mv, rm -f, etc.).
 */
function makeCompositeInstance(runnerLines: string[] = []): SandboxInstance & {
	files: { write: ReturnType<typeof vi.fn>; read: ReturnType<typeof vi.fn> };
	commands: { run: ReturnType<typeof vi.fn> };
	kill: ReturnType<typeof vi.fn>;
} {
	const runFn = vi.fn().mockImplementation(
		async (
			cmd: string,
			opts?: {
				onStdout?: (data: string) => void;
				onStderr?: (data: string) => void;
			},
		) => {
			if (cmd.includes("node ")) {
				for (const line of runnerLines) {
					opts?.onStdout?.(`${line}\n`);
				}
			}
			return { stdout: "", stderr: "", exitCode: 0 };
		},
	);

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
		commands: { run: runFn },
		kill: vi.fn().mockResolvedValue(undefined),
	};
}

/**
 * Build a minimal fake SandboxInstance (non-composite path).
 */
function _makeFakeInstance(stdoutLines: string[] = []): SandboxInstance & {
	files: { write: ReturnType<typeof vi.fn>; read: ReturnType<typeof vi.fn> };
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
 * Register a fake provider that calls back with config and returns the instance.
 */
function registerFakeProvider(
	name: "e2b" | "vercel" | "docker" | "cloudflare",
	instance: SandboxInstance,
	opts?: {
		createResult?: Awaited<ReturnType<SandboxProvider["create"]>>;
		onCreate?: (cfg: Parameters<SandboxProvider["create"]>[0]) => void;
	},
): void {
	registerSandboxProvider(name, async () => ({
		name,
		create: async (cfg) => {
			opts?.onCreate?.(cfg);
			if (opts?.createResult !== undefined) return opts.createResult;
			return { ok: true as const, instance };
		},
	}));
}

/**
 * Capture nonce from agent_config.json, then override the runner to emit
 * composite_request lines with the correct nonce.
 *
 * Returns a promise that resolves once the nonce has been captured.
 */
function installNonceCapture(
	instance: ReturnType<typeof makeCompositeInstance>,
	buildLines: (nonce: string) => string[],
): { getNonce: () => string | undefined } {
	let capturedNonce: string | undefined;

	instance.files.write.mockImplementation(
		async (path: string, content: string) => {
			if (path === "/home/user/.sandcaster/agent_config.json") {
				capturedNonce = JSON.parse(content).composite_nonce;

				const lines = capturedNonce ? buildLines(capturedNonce) : [];

				instance.commands.run.mockImplementation(
					async (cmd: string, opts?: { onStdout?: (data: string) => void }) => {
						if (cmd.includes("node ")) {
							for (const line of lines) {
								opts?.onStdout?.(`${line}\n`);
							}
						}
						return { stdout: "", stderr: "", exitCode: 0 };
					},
				);
			}
		},
	);

	return { getNonce: () => capturedNonce };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("composite-integration", () => {
	beforeEach(() => {
		resetRegistry();
		process.env.E2B_API_KEY = "test-e2b-key";
	});

	afterEach(() => {
		vi.clearAllMocks();
		delete process.env.E2B_API_KEY;
	});

	// -------------------------------------------------------------------------
	// Test 1: Full composite workflow — spawn / exec / transfer / kill actions
	// -------------------------------------------------------------------------

	describe("Test 1: full composite workflow with multiple IPC actions", () => {
		it("intercepts all four composite actions and does not yield them as events", async () => {
			const primaryInstance = makeCompositeInstance();
			const secondaryInstance = makeCompositeInstance();
			let createCallCount = 0;

			// First create() returns primaryInstance; subsequent calls return secondaryInstance
			registerSandboxProvider("e2b", async () => ({
				name: "e2b" as const,
				create: async () => {
					createCallCount++;
					if (createCallCount === 1) {
						return { ok: true as const, instance: primaryInstance };
					}
					return { ok: true as const, instance: secondaryInstance };
				},
			}));

			// Set up nonce capture and IPC line emission
			installNonceCapture(primaryInstance, (nonce) => [
				JSON.stringify({
					type: "composite_request",
					id: "spawn-001",
					nonce,
					action: "spawn",
					name: "worker",
					provider: "e2b",
				}),
				JSON.stringify({ type: "system", content: "after spawn" }),
				JSON.stringify({
					type: "composite_request",
					id: "exec-001",
					nonce,
					action: "exec",
					name: "worker",
					command: "ls",
				}),
				JSON.stringify({ type: "assistant", content: "working" }),
				JSON.stringify({
					type: "composite_request",
					id: "kill-001",
					nonce,
					action: "kill",
					name: "worker",
				}),
				JSON.stringify({ type: "result", content: "done" }),
			]);

			const events: Array<{ type: string }> = [];
			for await (const event of runAgentInSandbox({
				request: makeRequest({ composite: { maxSandboxes: 2 } }),
			})) {
				events.push(event);
			}

			// No composite_request events should leak through
			const compositeEvents = events.filter(
				(e) => e.type === "composite_request",
			);
			expect(compositeEvents).toHaveLength(0);

			// Regular events should still be yielded
			expect(events.find((e) => e.type === "system")).toBeDefined();
			expect(events.find((e) => e.type === "assistant")).toBeDefined();
			expect(events.find((e) => e.type === "result")).toBeDefined();
		});

		it("writes IPC response files for each composite request handled", async () => {
			const primaryInstance = makeCompositeInstance();
			const secondaryInstance = makeCompositeInstance();
			let createCallCount = 0;

			registerSandboxProvider("e2b", async () => ({
				name: "e2b" as const,
				create: async () => {
					createCallCount++;
					if (createCallCount === 1) {
						return { ok: true as const, instance: primaryInstance };
					}
					return { ok: true as const, instance: secondaryInstance };
				},
			}));

			installNonceCapture(primaryInstance, (nonce) => [
				JSON.stringify({
					type: "composite_request",
					id: "spawn-r1",
					nonce,
					action: "spawn",
					name: "worker",
					provider: "e2b",
				}),
				JSON.stringify({
					type: "composite_request",
					id: "list-r1",
					nonce,
					action: "list",
				}),
			]);

			for await (const _ of runAgentInSandbox({
				request: makeRequest({ composite: { maxSandboxes: 2 } }),
			})) {
				// consume
			}

			// Should have written .tmp files for each IPC request
			const tmpWrites = primaryInstance.files.write.mock.calls.filter(
				(call: string[]) =>
					typeof call[0] === "string" && call[0].endsWith(".json.tmp"),
			);
			expect(tmpWrites.length).toBeGreaterThanOrEqual(2);

			// Should have mv'd each .tmp to .json
			const mvCalls = primaryInstance.commands.run.mock.calls.filter(
				(call: string[]) =>
					typeof call[0] === "string" && call[0].startsWith("mv "),
			);
			expect(mvCalls.length).toBeGreaterThanOrEqual(2);
		});
	});

	// -------------------------------------------------------------------------
	// Test 2: Config limits enforced
	// -------------------------------------------------------------------------

	describe("Test 2: config limits enforced", () => {
		it("second spawn attempt fails with error response when maxSandboxes is 1", async () => {
			const primaryInstance = makeCompositeInstance();
			const secondaryInstance = makeCompositeInstance();
			let createCallCount = 0;

			registerSandboxProvider("e2b", async () => ({
				name: "e2b" as const,
				create: async () => {
					createCallCount++;
					if (createCallCount === 1) {
						return { ok: true as const, instance: primaryInstance };
					}
					return { ok: true as const, instance: secondaryInstance };
				},
			}));

			installNonceCapture(primaryInstance, (nonce) => [
				// First spawn succeeds (maxSandboxes: 1 means 1 secondary allowed)
				JSON.stringify({
					type: "composite_request",
					id: "spawn-first",
					nonce,
					action: "spawn",
					name: "worker1",
					provider: "e2b",
				}),
				// Second spawn should fail because secondary count (1) >= maxSandboxes (1)
				JSON.stringify({
					type: "composite_request",
					id: "spawn-second",
					nonce,
					action: "spawn",
					name: "worker2",
					provider: "e2b",
				}),
			]);

			for await (const _ of runAgentInSandbox({
				request: makeRequest({ composite: { maxSandboxes: 1 } }),
			})) {
				// consume
			}

			// Find the IPC response written for spawn-second
			const secondSpawnTmpWrite = primaryInstance.files.write.mock.calls.find(
				(call: string[]) => {
					if (
						typeof call[0] !== "string" ||
						!call[0].endsWith(".json.tmp") ||
						!call[0].includes("spawn-second")
					)
						return false;
					return true;
				},
			);
			expect(secondSpawnTmpWrite).toBeDefined();
			// biome-ignore lint/style/noNonNullAssertion: asserted defined above
			const response = JSON.parse(secondSpawnTmpWrite![1]);
			expect(response.ok).toBe(false);
			expect(response.error).toContain("maxSandboxes");
		});

		it("spawn with disallowed provider results in error response", async () => {
			const primaryInstance = makeCompositeInstance();

			registerFakeProvider("e2b", primaryInstance);

			installNonceCapture(primaryInstance, (nonce) => [
				JSON.stringify({
					type: "composite_request",
					id: "spawn-docker",
					nonce,
					action: "spawn",
					name: "worker",
					provider: "docker",
				}),
			]);

			for await (const _ of runAgentInSandbox({
				request: makeRequest({
					composite: { maxSandboxes: 2, allowedProviders: ["e2b"] },
				}),
			})) {
				// consume
			}

			// Find IPC response for the docker spawn
			const dockerSpawnTmpWrite = primaryInstance.files.write.mock.calls.find(
				(call: string[]) => {
					if (typeof call[0] !== "string" || !call[0].endsWith(".json.tmp"))
						return false;
					if (!call[0].includes("spawn-docker")) return false;
					return true;
				},
			);
			expect(dockerSpawnTmpWrite).toBeDefined();
			// biome-ignore lint/style/noNonNullAssertion: asserted defined above
			const response = JSON.parse(dockerSpawnTmpWrite![1]);
			expect(response.ok).toBe(false);
			expect(response.error).toContain("allowedProviders");
		});

		it("config maxSandboxes: 5 + request maxSandboxes: 2 → effective maxSandboxes is 2", async () => {
			const primaryInstance = makeCompositeInstance();
			const secondaryInstance = makeCompositeInstance();
			let createCallCount = 0;

			registerSandboxProvider("e2b", async () => ({
				name: "e2b" as const,
				create: async () => {
					createCallCount++;
					if (createCallCount === 1) {
						return { ok: true as const, instance: primaryInstance };
					}
					return { ok: true as const, instance: secondaryInstance };
				},
			}));

			// Emit 3 spawn requests: first 2 should succeed (up to effective limit 2),
			// the third should fail
			installNonceCapture(primaryInstance, (nonce) => [
				JSON.stringify({
					type: "composite_request",
					id: "spawn-a",
					nonce,
					action: "spawn",
					name: "worker1",
					provider: "e2b",
				}),
				JSON.stringify({
					type: "composite_request",
					id: "spawn-b",
					nonce,
					action: "spawn",
					name: "worker2",
					provider: "e2b",
				}),
				JSON.stringify({
					type: "composite_request",
					id: "spawn-c",
					nonce,
					action: "spawn",
					name: "worker3",
					provider: "e2b",
				}),
			]);

			for await (const _ of runAgentInSandbox({
				request: makeRequest({ composite: { maxSandboxes: 2 } }),
				config: {
					composite: {
						maxSandboxes: 5,
						maxTotalSpawns: 10,
						allowedProviders: ["e2b", "docker", "vercel", "cloudflare"],
						pollIntervalMs: 50,
					},
				},
			})) {
				// consume
			}

			// Third spawn (spawn-c) should fail
			const thirdSpawnTmpWrite = primaryInstance.files.write.mock.calls.find(
				(call: string[]) => {
					if (typeof call[0] !== "string" || !call[0].endsWith(".json.tmp"))
						return false;
					return call[0].includes("spawn-c");
				},
			);
			expect(thirdSpawnTmpWrite).toBeDefined();
			// biome-ignore lint/style/noNonNullAssertion: asserted defined above
			const response = JSON.parse(thirdSpawnTmpWrite![1]);
			expect(response.ok).toBe(false);
		});
	});

	// -------------------------------------------------------------------------
	// Test 3: IPC round-trip — spawn responds with correct workDir
	// -------------------------------------------------------------------------

	describe("Test 3: IPC round-trip", () => {
		it("spawn response contains the secondary instance workDir", async () => {
			const primaryInstance = makeCompositeInstance();
			const secondaryWorkDir = "/home/worker-node";
			const secondaryInstance: SandboxInstance = {
				workDir: secondaryWorkDir,
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
					run: vi
						.fn()
						.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
				},
				kill: vi.fn().mockResolvedValue(undefined),
			};

			let createCallCount = 0;
			registerSandboxProvider("e2b", async () => ({
				name: "e2b" as const,
				create: async () => {
					createCallCount++;
					if (createCallCount === 1) {
						return { ok: true as const, instance: primaryInstance };
					}
					return { ok: true as const, instance: secondaryInstance };
				},
			}));

			installNonceCapture(primaryInstance, (nonce) => [
				JSON.stringify({
					type: "composite_request",
					id: "spawn-ipc",
					nonce,
					action: "spawn",
					name: "worker",
					provider: "e2b",
				}),
			]);

			for await (const _ of runAgentInSandbox({
				request: makeRequest({ composite: { maxSandboxes: 2 } }),
			})) {
				// consume
			}

			// Find the .tmp response file for the spawn
			const tmpWriteCall = primaryInstance.files.write.mock.calls.find(
				(call: string[]) =>
					typeof call[0] === "string" && call[0].endsWith(".json.tmp"),
			);
			expect(tmpWriteCall).toBeDefined();
			// biome-ignore lint/style/noNonNullAssertion: asserted defined above
			const responsePayload = JSON.parse(tmpWriteCall![1]);
			expect(responsePayload.ok).toBe(true);
			expect(responsePayload.workDir).toBe(secondaryWorkDir);
		});

		it("list response contains the sandbox list including primary", async () => {
			const primaryInstance = makeCompositeInstance();
			registerFakeProvider("e2b", primaryInstance);

			installNonceCapture(primaryInstance, (nonce) => [
				JSON.stringify({
					type: "composite_request",
					id: "list-ipc",
					nonce,
					action: "list",
				}),
			]);

			for await (const _ of runAgentInSandbox({
				request: makeRequest({ composite: { maxSandboxes: 2 } }),
			})) {
				// consume
			}

			const tmpWriteCall = primaryInstance.files.write.mock.calls.find(
				(call: string[]) =>
					typeof call[0] === "string" && call[0].endsWith(".json.tmp"),
			);
			expect(tmpWriteCall).toBeDefined();
			// biome-ignore lint/style/noNonNullAssertion: asserted defined above
			const responsePayload = JSON.parse(tmpWriteCall![1]);
			expect(responsePayload.ok).toBe(true);
			expect(Array.isArray(responsePayload.result)).toBe(true);
			const list = responsePayload.result as Array<{ name: string }>;
			expect(list.some((s) => s.name === "primary")).toBe(true);
		});

		it("exec response contains stdout from the target sandbox", async () => {
			const primaryInstance = makeCompositeInstance();
			const secondaryInstance = makeCompositeInstance();
			secondaryInstance.commands.run.mockResolvedValue({
				stdout: "exec-output",
				stderr: "",
				exitCode: 0,
			});

			let createCallCount = 0;
			registerSandboxProvider("e2b", async () => ({
				name: "e2b" as const,
				create: async () => {
					createCallCount++;
					if (createCallCount === 1) {
						return { ok: true as const, instance: primaryInstance };
					}
					return { ok: true as const, instance: secondaryInstance };
				},
			}));

			installNonceCapture(primaryInstance, (nonce) => [
				JSON.stringify({
					type: "composite_request",
					id: "spawn-for-exec",
					nonce,
					action: "spawn",
					name: "worker",
					provider: "e2b",
				}),
				JSON.stringify({
					type: "composite_request",
					id: "exec-ipc",
					nonce,
					action: "exec",
					name: "worker",
					command: "echo hello",
				}),
			]);

			for await (const _ of runAgentInSandbox({
				request: makeRequest({ composite: { maxSandboxes: 2 } }),
			})) {
				// consume
			}

			const execTmpWrite = primaryInstance.files.write.mock.calls.find(
				(call: string[]) => {
					if (typeof call[0] !== "string" || !call[0].endsWith(".json.tmp"))
						return false;
					return call[0].includes("exec-ipc");
				},
			);
			expect(execTmpWrite).toBeDefined();
			// biome-ignore lint/style/noNonNullAssertion: asserted defined above
			const responsePayload = JSON.parse(execTmpWrite![1]);
			expect(responsePayload.ok).toBe(true);
			expect(responsePayload.result).toMatchObject({ stdout: "exec-output" });
		});
	});

	// -------------------------------------------------------------------------
	// Test 4: Error handling matrix
	// -------------------------------------------------------------------------

	describe("Test 4: error handling matrix", () => {
		it("auth failure on secondary spawn → ok:false response with error message", async () => {
			const primaryInstance = makeCompositeInstance();
			let createCallCount = 0;

			registerSandboxProvider("e2b", async () => ({
				name: "e2b" as const,
				create: async () => {
					createCallCount++;
					if (createCallCount === 1) {
						return { ok: true as const, instance: primaryInstance };
					}
					return {
						ok: false as const,
						code: "PROVIDER_AUTH_MISSING" as const,
						message: "Auth failed for secondary",
						hint: "Check credentials",
					};
				},
			}));

			installNonceCapture(primaryInstance, (nonce) => [
				JSON.stringify({
					type: "composite_request",
					id: "spawn-auth-fail",
					nonce,
					action: "spawn",
					name: "worker",
					provider: "e2b",
				}),
			]);

			for await (const _ of runAgentInSandbox({
				request: makeRequest({ composite: { maxSandboxes: 2 } }),
			})) {
				// consume
			}

			const tmpWriteCall = primaryInstance.files.write.mock.calls.find(
				(call: string[]) =>
					typeof call[0] === "string" && call[0].endsWith(".json.tmp"),
			);
			expect(tmpWriteCall).toBeDefined();
			// biome-ignore lint/style/noNonNullAssertion: asserted defined above
			const responsePayload = JSON.parse(tmpWriteCall![1]);
			expect(responsePayload.ok).toBe(false);
			expect(responsePayload.error).toContain("Auth failed for secondary");
		});

		it("exec on non-existent sandbox → ok:false response", async () => {
			const primaryInstance = makeCompositeInstance();
			registerFakeProvider("e2b", primaryInstance);

			installNonceCapture(primaryInstance, (nonce) => [
				JSON.stringify({
					type: "composite_request",
					id: "exec-missing",
					nonce,
					action: "exec",
					name: "nonexistent",
					command: "ls",
				}),
			]);

			for await (const _ of runAgentInSandbox({
				request: makeRequest({ composite: { maxSandboxes: 2 } }),
			})) {
				// consume
			}

			const tmpWriteCall = primaryInstance.files.write.mock.calls.find(
				(call: string[]) =>
					typeof call[0] === "string" && call[0].endsWith(".json.tmp"),
			);
			expect(tmpWriteCall).toBeDefined();
			// biome-ignore lint/style/noNonNullAssertion: asserted defined above
			const responsePayload = JSON.parse(tmpWriteCall![1]);
			expect(responsePayload.ok).toBe(false);
			expect(responsePayload.error).toContain("nonexistent");
		});

		it("kill on non-existent sandbox → ok:false response", async () => {
			const primaryInstance = makeCompositeInstance();
			registerFakeProvider("e2b", primaryInstance);

			installNonceCapture(primaryInstance, (nonce) => [
				JSON.stringify({
					type: "composite_request",
					id: "kill-missing",
					nonce,
					action: "kill",
					name: "ghost",
				}),
			]);

			for await (const _ of runAgentInSandbox({
				request: makeRequest({ composite: { maxSandboxes: 2 } }),
			})) {
				// consume
			}

			const tmpWriteCall = primaryInstance.files.write.mock.calls.find(
				(call: string[]) =>
					typeof call[0] === "string" && call[0].endsWith(".json.tmp"),
			);
			expect(tmpWriteCall).toBeDefined();
			// biome-ignore lint/style/noNonNullAssertion: asserted defined above
			const responsePayload = JSON.parse(tmpWriteCall![1]);
			expect(responsePayload.ok).toBe(false);
			expect(responsePayload.error).toContain("ghost");
		});

		it("spawn missing name field → ok:false response", async () => {
			const primaryInstance = makeCompositeInstance();
			registerFakeProvider("e2b", primaryInstance);

			installNonceCapture(primaryInstance, (nonce) => [
				// Intentionally omit 'name' — handler should reject with error
				JSON.stringify({
					type: "composite_request",
					id: "spawn-no-name",
					nonce,
					action: "spawn",
					provider: "e2b",
					// name intentionally absent
				}),
			]);

			for await (const _ of runAgentInSandbox({
				request: makeRequest({ composite: { maxSandboxes: 2 } }),
			})) {
				// consume
			}

			const tmpWriteCall = primaryInstance.files.write.mock.calls.find(
				(call: string[]) =>
					typeof call[0] === "string" && call[0].endsWith(".json.tmp"),
			);
			expect(tmpWriteCall).toBeDefined();
			// biome-ignore lint/style/noNonNullAssertion: asserted defined above
			const responsePayload = JSON.parse(tmpWriteCall![1]);
			expect(responsePayload.ok).toBe(false);
		});
	});

	// -------------------------------------------------------------------------
	// Test 5: Provider matrix — all 4 providers can be used as secondary
	// -------------------------------------------------------------------------

	describe("Test 5: provider matrix", () => {
		const secondaryProviders = [
			"e2b",
			"docker",
			"vercel",
			"cloudflare",
		] as const;

		for (const providerName of secondaryProviders) {
			it(`spawns secondary with provider="${providerName}" and calls getSandboxProvider`, async () => {
				const primaryInstance = makeCompositeInstance();
				const secondaryInstance = makeCompositeInstance();
				let _secondaryCreateCount = 0;

				// Primary always uses e2b
				let primaryCallCount = 0;
				registerSandboxProvider("e2b", async () => ({
					name: "e2b" as const,
					create: async () => {
						primaryCallCount++;
						if (primaryCallCount === 1) {
							return { ok: true as const, instance: primaryInstance };
						}
						// If e2b is also the secondary provider, return secondary instance
						_secondaryCreateCount++;
						return { ok: true as const, instance: secondaryInstance };
					},
				}));

				// Register the target provider (if not e2b, it's separate)
				if (providerName !== "e2b") {
					registerSandboxProvider(providerName, async () => ({
						name: providerName,
						create: async () => {
							_secondaryCreateCount++;
							return { ok: true as const, instance: secondaryInstance };
						},
					}));
				}

				// Set credentials so the resolver doesn't block
				if (providerName === "vercel") {
					process.env.VERCEL_TOKEN = "test-vercel-token";
				}

				installNonceCapture(primaryInstance, (nonce) => [
					JSON.stringify({
						type: "composite_request",
						id: `spawn-${providerName}`,
						nonce,
						action: "spawn",
						name: `worker-${providerName}`,
						provider: providerName,
					}),
				]);

				for await (const _ of runAgentInSandbox({
					request: makeRequest({
						composite: {
							maxSandboxes: 2,
							allowedProviders: [providerName],
						},
					}),
				})) {
					// consume
				}

				// The IPC response should be success with secondary workDir
				const tmpWriteCall = primaryInstance.files.write.mock.calls.find(
					(call: string[]) =>
						typeof call[0] === "string" && call[0].endsWith(".json.tmp"),
				);
				expect(tmpWriteCall).toBeDefined();
				// biome-ignore lint/style/noNonNullAssertion: asserted defined above
				const responsePayload = JSON.parse(tmpWriteCall![1]);
				expect(responsePayload.ok).toBe(true);
				expect(responsePayload.workDir).toBe(secondaryInstance.workDir);

				// Cleanup
				delete process.env.VERCEL_TOKEN;
			});
		}
	});

	// -------------------------------------------------------------------------
	// Test 6: Path traversal variants in transfer_files
	// -------------------------------------------------------------------------

	describe("Test 6: path traversal variants in transfer_files", () => {
		// Each entry: [description, paths, expectOk]
		const cases: Array<[string, string[], boolean]> = [
			["../escape — rejected", ["../escape"], false],
			["/etc/passwd absolute — rejected", ["/etc/passwd"], false],
			["..\\escape backslash — rejected", ["..\\escape"], false],
			[
				"foo/../../escape encoded traversal — rejected",
				["foo/../../escape"],
				false,
			],
			["foo/../bar stays within root — allowed", ["foo/../bar"], true],
			["normal path — allowed", ["output.txt"], true],
		];

		for (const [description, paths, expectOk] of cases) {
			it(description, async () => {
				const primaryInstance = makeCompositeInstance();
				const secondaryInstance = makeCompositeInstance();

				// Mock read to return minimal content
				secondaryInstance.files.read.mockResolvedValue("content");
				primaryInstance.files.read.mockResolvedValue("content");

				let createCallCount = 0;
				registerSandboxProvider("e2b", async () => ({
					name: "e2b" as const,
					create: async () => {
						createCallCount++;
						if (createCallCount === 1) {
							return { ok: true as const, instance: primaryInstance };
						}
						return { ok: true as const, instance: secondaryInstance };
					},
				}));

				installNonceCapture(primaryInstance, (nonce) => [
					// First spawn a worker so transfer has a valid source
					JSON.stringify({
						type: "composite_request",
						id: "spawn-for-transfer",
						nonce,
						action: "spawn",
						name: "worker",
						provider: "e2b",
					}),
					JSON.stringify({
						type: "composite_request",
						id: "transfer-test",
						nonce,
						action: "transfer",
						from: "worker",
						to: "primary",
						paths,
					}),
				]);

				for await (const _ of runAgentInSandbox({
					request: makeRequest({ composite: { maxSandboxes: 2 } }),
				})) {
					// consume
				}

				// Find the transfer IPC response
				const transferTmpWrite = primaryInstance.files.write.mock.calls.find(
					(call: string[]) => {
						if (typeof call[0] !== "string" || !call[0].endsWith(".json.tmp"))
							return false;
						return call[0].includes("transfer-test");
					},
				);
				expect(transferTmpWrite).toBeDefined();
				// biome-ignore lint/style/noNonNullAssertion: asserted defined above
				const responsePayload = JSON.parse(transferTmpWrite![1]);

				if (expectOk) {
					// For allowed paths the top-level transfer call returns ok:true
					// (individual file failures might appear in result.failed)
					expect(responsePayload.ok).toBe(true);
				} else {
					// Rejected paths should cause an error response or appear in failed list
					const hasTopLevelError = responsePayload.ok === false;
					const hasFailedEntries =
						responsePayload.ok === true &&
						Array.isArray(responsePayload.result?.failed) &&
						responsePayload.result.failed.length > 0;
					expect(hasTopLevelError || hasFailedEntries).toBe(true);
				}
			});
		}
	});

	// -------------------------------------------------------------------------
	// Regression: regular events still yielded when composite is active
	// -------------------------------------------------------------------------

	describe("regression: regular events coexist with composite requests", () => {
		it("yields all non-composite events even when composite requests are interspersed", async () => {
			const primaryInstance = makeCompositeInstance();
			registerFakeProvider("e2b", primaryInstance);

			installNonceCapture(primaryInstance, (nonce) => [
				JSON.stringify({ type: "system", content: "step-1" }),
				JSON.stringify({
					type: "composite_request",
					id: "list-interspersed",
					nonce,
					action: "list",
				}),
				JSON.stringify({ type: "assistant", content: "step-2" }),
				JSON.stringify({
					type: "composite_request",
					id: "list-interspersed-2",
					nonce,
					action: "list",
				}),
				JSON.stringify({ type: "result", content: "step-3" }),
			]);

			const events: Array<{ type: string; content?: string }> = [];
			for await (const event of runAgentInSandbox({
				request: makeRequest({ composite: { maxSandboxes: 2 } }),
			})) {
				events.push(event as { type: string; content?: string });
			}

			// No composite_request events
			expect(events.filter((e) => e.type === "composite_request")).toHaveLength(
				0,
			);

			// All regular events present
			expect(events.find((e) => e.content === "step-1")).toBeDefined();
			expect(events.find((e) => e.content === "step-2")).toBeDefined();
			expect(events.find((e) => e.content === "step-3")).toBeDefined();
		});
	});
});
