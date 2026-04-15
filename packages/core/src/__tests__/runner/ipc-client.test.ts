import { describe, expect, it, vi } from "vitest";
import type { CompositeResponse } from "../../composite-ipc.js";
import { ipcResponsePath } from "../../composite-ipc.js";
import type {
	IpcClientConfig,
	IpcClientDeps,
} from "../../runner/ipc-client.js";
import { IpcClient } from "../../runner/ipc-client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(
	overrides: Partial<CompositeResponse> = {},
): CompositeResponse {
	return {
		type: "composite_response",
		id: "req-test",
		ok: true,
		...overrides,
	};
}

function makeDeps(overrides: Partial<IpcClientDeps> = {}): IpcClientDeps {
	return {
		emit: vi.fn(),
		readFile: vi.fn().mockResolvedValue(null),
		deleteFile: vi.fn().mockResolvedValue(undefined),
		sleep: vi.fn().mockResolvedValue(undefined),
		...overrides,
	};
}

function makeConfig(overrides: Partial<IpcClientConfig> = {}): IpcClientConfig {
	return {
		nonce: "test-nonce",
		pollIntervalMs: 10,
		pollTimeoutMs: 100,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// IpcClient.request — emitting
// ---------------------------------------------------------------------------

describe("IpcClient.request — emitting", () => {
	it("emits a JSON line to stdout with type composite_request", async () => {
		const emittedLines: string[] = [];
		const response = makeResponse({ id: "stub" });
		// readFile returns the response on first call
		const readFile = vi.fn().mockResolvedValueOnce(JSON.stringify(response));
		const deps = makeDeps({
			emit: (line) => emittedLines.push(line),
			readFile,
		});
		const client = new IpcClient(deps, makeConfig());

		await client.request("spawn", { name: "worker", provider: "e2b" });

		expect(emittedLines).toHaveLength(1);
		const parsed = JSON.parse(emittedLines[0]);
		expect(parsed.type).toBe("composite_request");
	});

	it("emits a request with the correct action", async () => {
		const emittedLines: string[] = [];
		const response = makeResponse({ id: "stub" });
		const readFile = vi.fn().mockResolvedValueOnce(JSON.stringify(response));
		const deps = makeDeps({
			emit: (line) => emittedLines.push(line),
			readFile,
		});
		const client = new IpcClient(deps, makeConfig());

		await client.request("exec", { name: "worker", command: "ls" });

		const parsed = JSON.parse(emittedLines[0]);
		expect(parsed.action).toBe("exec");
	});

	it("emits a request that includes the nonce from config", async () => {
		const emittedLines: string[] = [];
		const response = makeResponse({ id: "stub" });
		const readFile = vi.fn().mockResolvedValueOnce(JSON.stringify(response));
		const deps = makeDeps({
			emit: (line) => emittedLines.push(line),
			readFile,
		});
		const client = new IpcClient(
			deps,
			makeConfig({ nonce: "my-session-nonce" }),
		);

		await client.request("list", {});

		const parsed = JSON.parse(emittedLines[0]);
		expect(parsed.nonce).toBe("my-session-nonce");
	});

	it("emits a request that spreads the payload into the message", async () => {
		const emittedLines: string[] = [];
		const response = makeResponse({ id: "stub" });
		const readFile = vi.fn().mockResolvedValueOnce(JSON.stringify(response));
		const deps = makeDeps({
			emit: (line) => emittedLines.push(line),
			readFile,
		});
		const client = new IpcClient(deps, makeConfig());

		await client.request("spawn", {
			name: "worker",
			provider: "docker",
			template: "tmpl",
		});

		const parsed = JSON.parse(emittedLines[0]);
		expect(parsed.name).toBe("worker");
		expect(parsed.provider).toBe("docker");
		expect(parsed.template).toBe("tmpl");
	});

	it("does not allow payload to override id or nonce", async () => {
		const emittedLines: string[] = [];
		const response = makeResponse({ id: "stub" });
		const readFile = vi.fn().mockResolvedValueOnce(JSON.stringify(response));
		const deps = makeDeps({
			emit: (line) => emittedLines.push(line),
			readFile,
		});
		const client = new IpcClient(deps, makeConfig({ nonce: "real-nonce" }));

		await client.request("exec", {
			id: "evil-id",
			nonce: "evil-nonce",
			name: "worker",
			command: "ls",
		});

		const parsed = JSON.parse(emittedLines[0]);
		expect(parsed.nonce).toBe("real-nonce");
		expect(parsed.id).not.toBe("evil-id");
	});

	it("emits a request with a unique id each call", async () => {
		const emittedLines: string[] = [];
		// readFile: for each call, return a matching response
		let _callCount = 0;
		const readFile = vi.fn().mockImplementation(async (path: string) => {
			_callCount++;
			// Return a response matching whatever id is being polled
			const id = path.replace("/tmp/sandcaster-ipc-", "").replace(".json", "");
			return JSON.stringify(makeResponse({ id }));
		});
		const deps = makeDeps({
			emit: (line) => emittedLines.push(line),
			readFile,
		});
		const client = new IpcClient(deps, makeConfig());

		await client.request("list", {});
		await client.request("list", {});

		expect(emittedLines).toHaveLength(2);
		const id1 = JSON.parse(emittedLines[0]).id;
		const id2 = JSON.parse(emittedLines[1]).id;
		expect(id1).not.toBe(id2);
	});
});

// ---------------------------------------------------------------------------
// IpcClient.request — polling
// ---------------------------------------------------------------------------

describe("IpcClient.request — polling", () => {
	it("polls the correct IPC file path for the request id", async () => {
		const polledPaths: string[] = [];
		let requestId = "";
		const deps = makeDeps({
			emit: (line) => {
				requestId = JSON.parse(line).id;
			},
			readFile: vi.fn().mockImplementation(async (path: string) => {
				polledPaths.push(path);
				if (requestId && path === ipcResponsePath(requestId)) {
					return JSON.stringify(makeResponse({ id: requestId }));
				}
				return null;
			}),
		});
		const client = new IpcClient(deps, makeConfig());

		await client.request("list", {});

		expect(polledPaths.some((p) => p === ipcResponsePath(requestId))).toBe(
			true,
		);
	});

	it("sleeps between polls when response is not yet available", async () => {
		const sleepCalls: number[] = [];
		let requestId = "";
		let pollCount = 0;

		const deps = makeDeps({
			emit: (line) => {
				requestId = JSON.parse(line).id;
			},
			sleep: vi.fn().mockImplementation(async (ms: number) => {
				sleepCalls.push(ms);
			}),
			readFile: vi.fn().mockImplementation(async () => {
				pollCount++;
				// Return null for first 2 polls, then the response
				if (pollCount < 3) return null;
				return JSON.stringify(makeResponse({ id: requestId }));
			}),
		});
		const client = new IpcClient(
			deps,
			makeConfig({ pollIntervalMs: 50, pollTimeoutMs: 5000 }),
		);

		await client.request("list", {});

		// Should have slept at least twice (once for each null response)
		expect(sleepCalls.length).toBeGreaterThanOrEqual(2);
		expect(sleepCalls.every((ms) => ms === 50)).toBe(true);
	});

	it("throws on timeout when response file never appears", async () => {
		const deps = makeDeps({
			readFile: vi.fn().mockResolvedValue(null),
		});
		const client = new IpcClient(
			deps,
			makeConfig({ pollIntervalMs: 10, pollTimeoutMs: 50 }),
		);

		await expect(client.request("list", {})).rejects.toThrow();
	});

	it("timeout error message contains the request id", async () => {
		let requestId = "";
		const deps = makeDeps({
			emit: (line) => {
				requestId = JSON.parse(line).id;
			},
			readFile: vi.fn().mockResolvedValue(null),
		});
		const client = new IpcClient(
			deps,
			makeConfig({ pollIntervalMs: 10, pollTimeoutMs: 50 }),
		);

		await expect(client.request("list", {})).rejects.toThrow(
			expect.objectContaining({
				message: expect.stringContaining(requestId || ""),
			}),
		);
	});
});

// ---------------------------------------------------------------------------
// IpcClient.request — response consumption
// ---------------------------------------------------------------------------

describe("IpcClient.request — response consumption", () => {
	it("parses the response file as CompositeResponse and returns it", async () => {
		let requestId = "";
		const deps = makeDeps({
			emit: (line) => {
				requestId = JSON.parse(line).id;
			},
			readFile: vi.fn().mockImplementation(async () => {
				const response: CompositeResponse = {
					type: "composite_response",
					id: requestId,
					ok: true,
					workDir: "/home/user",
				};
				return JSON.stringify(response);
			}),
		});
		const client = new IpcClient(deps, makeConfig());

		const result = await client.request("spawn", {
			name: "w",
			provider: "e2b",
		});

		expect(result.type).toBe("composite_response");
		expect(result.ok).toBe(true);
		expect(result.workDir).toBe("/home/user");
	});

	it("deletes the response file after reading it", async () => {
		const deletedPaths: string[] = [];
		let requestId = "";
		const deps = makeDeps({
			emit: (line) => {
				requestId = JSON.parse(line).id;
			},
			readFile: vi.fn().mockImplementation(async () => {
				return JSON.stringify(makeResponse({ id: requestId }));
			}),
			deleteFile: vi.fn().mockImplementation(async (path: string) => {
				deletedPaths.push(path);
			}),
		});
		const client = new IpcClient(deps, makeConfig());

		await client.request("kill", { name: "worker" });

		expect(deletedPaths).toHaveLength(1);
		expect(deletedPaths[0]).toBe(ipcResponsePath(requestId));
	});

	it("returns error response (ok: false) without throwing", async () => {
		const deps = makeDeps({
			readFile: vi
				.fn()
				.mockResolvedValue(
					JSON.stringify(
						makeResponse({ ok: false, error: "Sandbox not found" }),
					),
				),
		});
		const client = new IpcClient(deps, makeConfig());

		const result = await client.request("kill", { name: "missing" });

		expect(result.ok).toBe(false);
		expect(result.error).toBe("Sandbox not found");
	});
});
