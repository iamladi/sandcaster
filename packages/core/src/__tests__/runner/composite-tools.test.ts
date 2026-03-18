import { describe, expect, it, vi } from "vitest";
import type { CompositeResponse } from "../../composite-ipc.js";
import { createCompositeTools } from "../../runner/composite-tools.js";
import type {
	IpcClientConfig,
	IpcClientDeps,
} from "../../runner/ipc-client.js";
import { IpcClient } from "../../runner/ipc-client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSuccessResponse(
	overrides: Partial<CompositeResponse> = {},
): CompositeResponse {
	return {
		type: "composite_response",
		id: "stub-id",
		ok: true,
		...overrides,
	};
}

function makeErrorResponse(error: string): CompositeResponse {
	return {
		type: "composite_response",
		id: "stub-id",
		ok: false,
		error,
	};
}

/**
 * Creates a test IpcClient that returns a fixed response for the next request.
 */
function makeIpcClient(response: CompositeResponse): IpcClient {
	const deps: IpcClientDeps = {
		emit: vi.fn(),
		readFile: vi.fn().mockResolvedValue(JSON.stringify(response)),
		deleteFile: vi.fn().mockResolvedValue(undefined),
		sleep: vi.fn().mockResolvedValue(undefined),
	};
	const config: IpcClientConfig = {
		nonce: "test-nonce",
		pollIntervalMs: 10,
		pollTimeoutMs: 1000,
	};
	return new IpcClient(deps, config);
}

/**
 * Creates a spy IpcClient that captures request calls and returns a fixed response.
 */
function makeSpyIpcClient(response: CompositeResponse): {
	client: IpcClient;
	emitted: Array<Record<string, unknown>>;
} {
	const emitted: Array<Record<string, unknown>> = [];
	const deps: IpcClientDeps = {
		emit: vi.fn().mockImplementation((line: string) => {
			emitted.push(JSON.parse(line));
		}),
		readFile: vi.fn().mockResolvedValue(JSON.stringify(response)),
		deleteFile: vi.fn().mockResolvedValue(undefined),
		sleep: vi.fn().mockResolvedValue(undefined),
	};
	const config: IpcClientConfig = {
		nonce: "test-nonce",
		pollIntervalMs: 10,
		pollTimeoutMs: 1000,
	};
	return { client: new IpcClient(deps, config), emitted };
}

// ---------------------------------------------------------------------------
// createCompositeTools — structure
// ---------------------------------------------------------------------------

describe("createCompositeTools — structure", () => {
	it("returns exactly 5 tools", () => {
		const client = makeIpcClient(makeSuccessResponse());
		const tools = createCompositeTools(client);
		expect(tools).toHaveLength(5);
	});

	it("returns tools with the expected names", () => {
		const client = makeIpcClient(makeSuccessResponse());
		const tools = createCompositeTools(client);
		const names = tools.map((t) => t.name);
		expect(names).toContain("spawn_sandbox");
		expect(names).toContain("exec_in");
		expect(names).toContain("transfer_files");
		expect(names).toContain("kill_sandbox");
		expect(names).toContain("list_sandboxes");
	});

	it("each tool has a non-empty description", () => {
		const client = makeIpcClient(makeSuccessResponse());
		const tools = createCompositeTools(client);
		for (const tool of tools) {
			expect(tool.description.length).toBeGreaterThan(0);
		}
	});

	it("each tool has a non-empty label", () => {
		const client = makeIpcClient(makeSuccessResponse());
		const tools = createCompositeTools(client);
		for (const tool of tools) {
			expect(tool.label.length).toBeGreaterThan(0);
		}
	});

	it("each tool has a parameters object", () => {
		const client = makeIpcClient(makeSuccessResponse());
		const tools = createCompositeTools(client);
		for (const tool of tools) {
			expect(tool.parameters).toBeDefined();
			expect(typeof tool.parameters).toBe("object");
		}
	});
});

// ---------------------------------------------------------------------------
// spawn_sandbox
// ---------------------------------------------------------------------------

describe("spawn_sandbox", () => {
	it("calls IPC with action 'spawn' and the provided params", async () => {
		const { client, emitted } = makeSpyIpcClient(
			makeSuccessResponse({ workDir: "/home/user" }),
		);
		const tools = createCompositeTools(client);
		const tool = tools.find((t) => t.name === "spawn_sandbox")!;

		await tool.execute("call-1", {
			name: "worker",
			provider: "e2b",
			template: "my-tmpl",
		});

		expect(emitted).toHaveLength(1);
		expect(emitted[0].action).toBe("spawn");
		expect(emitted[0].name).toBe("worker");
		expect(emitted[0].provider).toBe("e2b");
		expect(emitted[0].template).toBe("my-tmpl");
	});

	it("returns success text with sandbox name and workDir", async () => {
		const client = makeIpcClient(
			makeSuccessResponse({ workDir: "/home/user" }),
		);
		const tools = createCompositeTools(client);
		const tool = tools.find((t) => t.name === "spawn_sandbox")!;

		const result = await tool.execute("call-2", {
			name: "worker",
			provider: "e2b",
		});

		const text = (result.content[0] as { text: string }).text;
		expect(text).toContain("worker");
		expect(text).toContain("/home/user");
	});

	it("returns error text when response is not ok", async () => {
		const client = makeIpcClient(makeErrorResponse("Provider unavailable"));
		const tools = createCompositeTools(client);
		const tool = tools.find((t) => t.name === "spawn_sandbox")!;

		const result = await tool.execute("call-3", {
			name: "worker",
			provider: "e2b",
		});

		const text = (result.content[0] as { text: string }).text;
		expect(text).toContain("Provider unavailable");
	});
});

// ---------------------------------------------------------------------------
// exec_in
// ---------------------------------------------------------------------------

describe("exec_in", () => {
	it("calls IPC with action 'exec' and the sandbox name as 'name'", async () => {
		const { client, emitted } = makeSpyIpcClient(
			makeSuccessResponse({
				result: { stdout: "hello", stderr: "", exitCode: 0 },
			}),
		);
		const tools = createCompositeTools(client);
		const tool = tools.find((t) => t.name === "exec_in")!;

		await tool.execute("call-4", { sandbox: "worker", command: "echo hello" });

		expect(emitted[0].action).toBe("exec");
		expect(emitted[0].name).toBe("worker");
		expect(emitted[0].command).toBe("echo hello");
	});

	it("rejects execution in 'primary' sandbox with an error message", async () => {
		const client = makeIpcClient(makeSuccessResponse());
		const tools = createCompositeTools(client);
		const tool = tools.find((t) => t.name === "exec_in")!;

		const result = await tool.execute("call-5", {
			sandbox: "primary",
			command: "ls",
		});

		const text = (result.content[0] as { text: string }).text;
		expect(text.toLowerCase()).toContain("primary");
		expect((result as any).isError).toBe(true);
	});

	it("defaults timeout to 30000 when not provided", async () => {
		const { client, emitted } = makeSpyIpcClient(
			makeSuccessResponse({
				result: { stdout: "", stderr: "", exitCode: 0 },
			}),
		);
		const tools = createCompositeTools(client);
		const tool = tools.find((t) => t.name === "exec_in")!;

		await tool.execute("call-6", { sandbox: "worker", command: "ls" });

		expect(emitted[0].timeout).toBe(30000);
	});

	it("clamps timeout to 300000 maximum", async () => {
		const { client, emitted } = makeSpyIpcClient(
			makeSuccessResponse({
				result: { stdout: "", stderr: "", exitCode: 0 },
			}),
		);
		const tools = createCompositeTools(client);
		const tool = tools.find((t) => t.name === "exec_in")!;

		await tool.execute("call-7", {
			sandbox: "worker",
			command: "ls",
			timeout: 999999,
		});

		expect(emitted[0].timeout).toBe(300000);
	});

	it("passes through timeout when within the allowed range", async () => {
		const { client, emitted } = makeSpyIpcClient(
			makeSuccessResponse({
				result: { stdout: "", stderr: "", exitCode: 0 },
			}),
		);
		const tools = createCompositeTools(client);
		const tool = tools.find((t) => t.name === "exec_in")!;

		await tool.execute("call-8", {
			sandbox: "worker",
			command: "ls",
			timeout: 60000,
		});

		expect(emitted[0].timeout).toBe(60000);
	});

	it("returns stdout and stderr from CommandResult on success", async () => {
		const client = makeIpcClient(
			makeSuccessResponse({
				result: { stdout: "output text", stderr: "some warning", exitCode: 0 },
			}),
		);
		const tools = createCompositeTools(client);
		const tool = tools.find((t) => t.name === "exec_in")!;

		const result = await tool.execute("call-9", {
			sandbox: "worker",
			command: "ls",
		});

		const text = (result.content[0] as { text: string }).text;
		expect(text).toContain("output text");
	});

	it("returns error text when response is not ok", async () => {
		const client = makeIpcClient(makeErrorResponse("Sandbox not found"));
		const tools = createCompositeTools(client);
		const tool = tools.find((t) => t.name === "exec_in")!;

		const result = await tool.execute("call-10", {
			sandbox: "worker",
			command: "ls",
		});

		const text = (result.content[0] as { text: string }).text;
		expect(text).toContain("Sandbox not found");
	});
});

// ---------------------------------------------------------------------------
// transfer_files
// ---------------------------------------------------------------------------

describe("transfer_files", () => {
	it("calls IPC with action 'transfer' and the provided params", async () => {
		const { client, emitted } = makeSpyIpcClient(
			makeSuccessResponse({
				result: {
					transferred: ["output.txt"],
					failed: [],
				},
			}),
		);
		const tools = createCompositeTools(client);
		const tool = tools.find((t) => t.name === "transfer_files")!;

		await tool.execute("call-11", {
			from: "worker",
			to: "primary",
			paths: ["output.txt"],
		});

		expect(emitted[0].action).toBe("transfer");
		expect(emitted[0].from).toBe("worker");
		expect(emitted[0].to).toBe("primary");
		expect(emitted[0].paths).toEqual(["output.txt"]);
	});

	it("returns a summary containing transferred file counts", async () => {
		const client = makeIpcClient(
			makeSuccessResponse({
				result: {
					transferred: ["a.txt", "b.txt"],
					failed: [],
				},
			}),
		);
		const tools = createCompositeTools(client);
		const tool = tools.find((t) => t.name === "transfer_files")!;

		const result = await tool.execute("call-12", {
			from: "worker",
			to: "primary",
			paths: ["a.txt", "b.txt"],
		});

		const text = (result.content[0] as { text: string }).text;
		expect(text).toBeTruthy();
		expect(text.length).toBeGreaterThan(0);
	});

	it("includes failed files in the summary when present", async () => {
		const client = makeIpcClient(
			makeSuccessResponse({
				result: {
					transferred: ["a.txt"],
					failed: ["b.txt"],
				},
			}),
		);
		const tools = createCompositeTools(client);
		const tool = tools.find((t) => t.name === "transfer_files")!;

		const result = await tool.execute("call-13", {
			from: "worker",
			to: "primary",
			paths: ["a.txt", "b.txt"],
		});

		const text = (result.content[0] as { text: string }).text;
		expect(text).toContain("b.txt");
	});

	it("returns error text when response is not ok", async () => {
		const client = makeIpcClient(makeErrorResponse("Transfer failed"));
		const tools = createCompositeTools(client);
		const tool = tools.find((t) => t.name === "transfer_files")!;

		const result = await tool.execute("call-14", {
			from: "worker",
			to: "primary",
			paths: ["x.txt"],
		});

		const text = (result.content[0] as { text: string }).text;
		expect(text).toContain("Transfer failed");
	});
});

// ---------------------------------------------------------------------------
// kill_sandbox
// ---------------------------------------------------------------------------

describe("kill_sandbox", () => {
	it("calls IPC with action 'kill' and the sandbox name", async () => {
		const { client, emitted } = makeSpyIpcClient(makeSuccessResponse());
		const tools = createCompositeTools(client);
		const tool = tools.find((t) => t.name === "kill_sandbox")!;

		await tool.execute("call-15", { name: "worker" });

		expect(emitted[0].action).toBe("kill");
		expect(emitted[0].name).toBe("worker");
	});

	it("returns success text with the sandbox name", async () => {
		const client = makeIpcClient(makeSuccessResponse());
		const tools = createCompositeTools(client);
		const tool = tools.find((t) => t.name === "kill_sandbox")!;

		const result = await tool.execute("call-16", { name: "worker" });

		const text = (result.content[0] as { text: string }).text;
		expect(text).toContain("worker");
	});

	it("rejects killing the 'primary' sandbox with an error message", async () => {
		const client = makeIpcClient(makeSuccessResponse());
		const tools = createCompositeTools(client);
		const tool = tools.find((t) => t.name === "kill_sandbox")!;

		const result = await tool.execute("call-17", { name: "primary" });

		const text = (result.content[0] as { text: string }).text;
		expect(text.toLowerCase()).toContain("primary");
		expect((result as any).isError).toBe(true);
	});

	it("returns error text when response is not ok", async () => {
		const client = makeIpcClient(makeErrorResponse("Not found"));
		const tools = createCompositeTools(client);
		const tool = tools.find((t) => t.name === "kill_sandbox")!;

		const result = await tool.execute("call-18", { name: "worker" });

		const text = (result.content[0] as { text: string }).text;
		expect(text).toContain("Not found");
	});
});

// ---------------------------------------------------------------------------
// list_sandboxes
// ---------------------------------------------------------------------------

describe("list_sandboxes", () => {
	it("calls IPC with action 'list' and empty payload", async () => {
		const { client, emitted } = makeSpyIpcClient(
			makeSuccessResponse({ result: [] }),
		);
		const tools = createCompositeTools(client);
		const tool = tools.find((t) => t.name === "list_sandboxes")!;

		await tool.execute("call-19", {});

		expect(emitted[0].action).toBe("list");
	});

	it("returns a formatted list of active sandboxes", async () => {
		const client = makeIpcClient(
			makeSuccessResponse({
				result: [
					{ name: "worker-1", provider: "e2b" },
					{ name: "worker-2", provider: "docker" },
				],
			}),
		);
		const tools = createCompositeTools(client);
		const tool = tools.find((t) => t.name === "list_sandboxes")!;

		const result = await tool.execute("call-20", {});

		const text = (result.content[0] as { text: string }).text;
		expect(text).toBeTruthy();
		expect(text.length).toBeGreaterThan(0);
	});

	it("returns error text when response is not ok", async () => {
		const client = makeIpcClient(makeErrorResponse("List failed"));
		const tools = createCompositeTools(client);
		const tool = tools.find((t) => t.name === "list_sandboxes")!;

		const result = await tool.execute("call-21", {});

		const text = (result.content[0] as { text: string }).text;
		expect(text).toContain("List failed");
	});
});
