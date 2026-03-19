import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock execa at the module boundary (system boundary — Docker CLI calls)
// vi.hoisted ensures mockExeca is available when the hoisted vi.mock factory runs
// ---------------------------------------------------------------------------

const { mockExeca } = vi.hoisted(() => ({ mockExeca: vi.fn() }));

vi.mock("execa", () => ({
	execa: mockExeca,
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { createDockerProvider } from "../../providers/docker.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockCall = [string, string[], Record<string, unknown>?];

function _callsFor(cmd: string): MockCall[] {
	return (mockExeca.mock.calls as MockCall[]).filter(
		([, args]) => args[0] === cmd,
	);
}

/**
 * Build a minimal execa result object for a successful docker command.
 */
function makeExecaResult(overrides?: {
	stdout?: string;
	stderr?: string;
	exitCode?: number;
	timedOut?: boolean;
}) {
	return {
		stdout: overrides?.stdout ?? "",
		stderr: overrides?.stderr ?? "",
		exitCode: overrides?.exitCode ?? 0,
		timedOut: overrides?.timedOut ?? false,
	};
}

/**
 * Configure mockExeca to succeed for all calls by default.
 * docker ps (orphan reap) → []
 * docker pull  → success
 * docker run   → container id
 */
function setupDefaultMocks(containerId = "abc123container") {
	mockExeca.mockImplementation(
		(_cmd: string, args: string[], _opts?: unknown) => {
			// docker ps -q --filter label=sandcaster=true → empty (no orphans)
			if (args[0] === "ps") {
				return Promise.resolve(makeExecaResult({ stdout: "" }));
			}
			// docker pull <image>
			if (args[0] === "pull") {
				return Promise.resolve(makeExecaResult());
			}
			// docker run -d ... → container id
			if (args[0] === "run") {
				return Promise.resolve(makeExecaResult({ stdout: containerId }));
			}
			// docker rm -f (orphan cleanup or kill)
			if (args[0] === "rm") {
				return Promise.resolve(makeExecaResult());
			}
			// docker exec
			if (args[0] === "exec") {
				return Promise.resolve(makeExecaResult({ stdout: "exec-output" }));
			}
			return Promise.resolve(makeExecaResult());
		},
	);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createDockerProvider", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// -------------------------------------------------------------------------
	// Provider identity
	// -------------------------------------------------------------------------

	it("has name 'docker'", () => {
		const provider = createDockerProvider();
		expect(provider.name).toBe("docker");
	});

	// -------------------------------------------------------------------------
	// Orphan reaping on create
	// -------------------------------------------------------------------------

	it("does not reap containers on create — relies on --rm and kill() for cleanup", async () => {
		setupDefaultMocks();

		const provider = createDockerProvider();
		await provider.create({ template: "node:20" });

		// Should not call docker ps or docker rm during create
		const psCalls = _callsFor("ps");
		const rmCalls = _callsFor("rm");
		expect(psCalls).toHaveLength(0);
		expect(rmCalls).toHaveLength(0);
	});

	// -------------------------------------------------------------------------
	// Template validation
	// -------------------------------------------------------------------------

	it("returns INVALID_TEMPLATE_FOR_PROVIDER for empty template", async () => {
		setupDefaultMocks();

		const provider = createDockerProvider();
		const result = await provider.create({ template: "" });

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("INVALID_TEMPLATE_FOR_PROVIDER");
	});

	it("returns INVALID_TEMPLATE_FOR_PROVIDER for template with spaces", async () => {
		setupDefaultMocks();

		const provider = createDockerProvider();
		const result = await provider.create({ template: "my image:latest" });

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("INVALID_TEMPLATE_FOR_PROVIDER");
	});

	it("accepts valid Docker image names", async () => {
		setupDefaultMocks();

		const provider = createDockerProvider();

		for (const template of [
			"node:20",
			"sandcaster-sandbox",
			"my-registry/image:v1",
		]) {
			vi.clearAllMocks();
			setupDefaultMocks();
			const result = await provider.create({ template });
			expect(result.ok).toBe(true);
		}
	});

	// -------------------------------------------------------------------------
	// Docker run args
	// -------------------------------------------------------------------------

	it("calls docker run with --rm and --label sandcaster=true", async () => {
		setupDefaultMocks("cid1");

		const provider = createDockerProvider();
		await provider.create({ template: "node:20" });

		const runCalls = _callsFor("run");
		expect(runCalls).toHaveLength(1);
		const runArgs: string[] = runCalls[0][1];
		expect(runArgs).toContain("--rm");
		expect(runArgs).toContain("--label");
		expect(runArgs).toContain("sandcaster=true");
		expect(runArgs).toContain("-d");
	});

	it("uses the template as the Docker image name in docker run", async () => {
		setupDefaultMocks("cid2");

		const provider = createDockerProvider();
		await provider.create({ template: "my-registry/image:v1" });

		const runCalls = _callsFor("run");
		const runArgs: string[] = runCalls[0][1];
		expect(runArgs).toContain("my-registry/image:v1");
	});

	it("passes --env KEY=VALUE for each entry in config.envs", async () => {
		setupDefaultMocks("cid3");

		const provider = createDockerProvider();
		await provider.create({
			template: "node:20",
			envs: { FOO: "bar", BAZ: "qux" },
		});

		const runCalls = _callsFor("run");
		const runArgs: string[] = runCalls[0][1];

		// Find --env pairs
		const envPairs: string[] = [];
		for (let i = 0; i < runArgs.length; i++) {
			if (runArgs[i] === "--env") {
				envPairs.push(runArgs[i + 1]);
			}
		}
		expect(envPairs).toContain("FOO=bar");
		expect(envPairs).toContain("BAZ=qux");
	});

	it("returns TEMPLATE_NOT_FOUND with hint when docker pull fails", async () => {
		mockExeca.mockImplementation((_cmd: string, args: string[]) => {
			if (args[0] === "ps") {
				return Promise.resolve(makeExecaResult({ stdout: "" }));
			}
			if (args[0] === "image" && args[1] === "inspect") {
				return Promise.reject(new Error("No such image"));
			}
			if (args[0] === "pull") {
				return Promise.reject(new Error("image not found"));
			}
			return Promise.resolve(makeExecaResult());
		});

		const provider = createDockerProvider();
		const result = await provider.create({ template: "nonexistent-image" });

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("TEMPLATE_NOT_FOUND");
		expect(result.hint).toBeDefined();
	});

	it("returns SANDBOX_ERROR when docker run fails", async () => {
		mockExeca.mockImplementation((_cmd: string, args: string[]) => {
			if (args[0] === "ps") {
				return Promise.resolve(makeExecaResult({ stdout: "" }));
			}
			if (args[0] === "image" && args[1] === "inspect") {
				return Promise.resolve(makeExecaResult());
			}
			if (args[0] === "run") {
				return Promise.reject(new Error("docker run failed"));
			}
			return Promise.resolve(makeExecaResult());
		});

		const provider = createDockerProvider();
		const result = await provider.create({ template: "node:20" });

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("SANDBOX_ERROR");
	});

	// -------------------------------------------------------------------------
	// SandboxInstance properties
	// -------------------------------------------------------------------------

	it("returns ok: true with a SandboxInstance on success", async () => {
		setupDefaultMocks("cid4");

		const provider = createDockerProvider();
		const result = await provider.create({ template: "node:20" });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");
		expect(result.instance).toBeDefined();
	});

	it("instance has workDir '/workspace'", async () => {
		setupDefaultMocks("cid5");

		const provider = createDockerProvider();
		const result = await provider.create({ template: "node:20" });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");
		expect(result.instance.workDir).toBe("/workspace");
	});

	it("instance has correct capabilities", async () => {
		setupDefaultMocks("cid6");

		const provider = createDockerProvider();
		const result = await provider.create({ template: "node:20" });

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
			customImage: true,
		});
	});

	// -------------------------------------------------------------------------
	// files.write
	// -------------------------------------------------------------------------

	it("files.write uses tee with path as argument (not shell interpolation)", async () => {
		const containerId = "write-container";
		setupDefaultMocks(containerId);

		const provider = createDockerProvider();
		const result = await provider.create({ template: "node:20" });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		vi.clearAllMocks();
		mockExeca.mockResolvedValue(makeExecaResult());

		await result.instance.files.write("/workspace/hello.txt", "hello world");

		expect(mockExeca).toHaveBeenCalledWith(
			"docker",
			["exec", "-i", containerId, "tee", "/workspace/hello.txt"],
			expect.objectContaining({ input: expect.anything(), stdout: "ignore" }),
		);
	});

	it("files.write converts string content to Buffer", async () => {
		const containerId = "write-str-container";
		setupDefaultMocks(containerId);

		const provider = createDockerProvider();
		const result = await provider.create({ template: "node:20" });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		vi.clearAllMocks();
		mockExeca.mockResolvedValue(makeExecaResult());

		await result.instance.files.write("/workspace/text.txt", "text content");

		// calls[0] is mkdir -p, calls[1] is tee
		const teeCall = mockExeca.mock.calls[1] as [
			string,
			string[],
			Record<string, unknown>,
		];
		expect(teeCall[2]?.input).toBeInstanceOf(Buffer);
	});

	// -------------------------------------------------------------------------
	// files.read
	// -------------------------------------------------------------------------

	it("files.read calls docker exec cat path and returns stdout", async () => {
		const containerId = "read-container";
		setupDefaultMocks(containerId);

		const provider = createDockerProvider();
		const result = await provider.create({ template: "node:20" });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		vi.clearAllMocks();
		mockExeca.mockResolvedValue(makeExecaResult({ stdout: "file content" }));

		const content = await result.instance.files.read("/workspace/file.txt");

		expect(mockExeca).toHaveBeenCalledWith("docker", [
			"exec",
			containerId,
			"cat",
			"/workspace/file.txt",
		]);
		expect(content).toBe("file content");
	});

	// -------------------------------------------------------------------------
	// commands.run
	// -------------------------------------------------------------------------

	it("commands.run calls docker exec sh -c cmd and returns stdout/stderr/exitCode", async () => {
		const containerId = "run-container";
		setupDefaultMocks(containerId);

		const provider = createDockerProvider();
		const result = await provider.create({ template: "node:20" });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		vi.clearAllMocks();
		mockExeca.mockResolvedValue(
			makeExecaResult({ stdout: "out", stderr: "err", exitCode: 0 }),
		);

		const cmdResult = await result.instance.commands.run("echo hello");

		expect(mockExeca).toHaveBeenCalledWith(
			"docker",
			["exec", containerId, "sh", "-c", "echo hello"],
			expect.objectContaining({ reject: false }),
		);
		expect(cmdResult).toMatchObject({
			stdout: "out",
			stderr: "err",
			exitCode: 0,
		});
	});

	it("commands.run passes timeoutMs as timeout option to execa", async () => {
		const containerId = "timeout-container";
		setupDefaultMocks(containerId);

		const provider = createDockerProvider();
		const result = await provider.create({ template: "node:20" });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		vi.clearAllMocks();
		mockExeca.mockResolvedValue(makeExecaResult({ exitCode: 0 }));

		await result.instance.commands.run("sleep 10", { timeoutMs: 5000 });

		expect(mockExeca).toHaveBeenCalledWith(
			"docker",
			["exec", containerId, "sh", "-c", "sleep 10"],
			expect.objectContaining({ timeout: 5000 }),
		);
	});

	it("commands.run returns exitCode -1 and timeout message when execa timedOut", async () => {
		const containerId = "timed-container";
		setupDefaultMocks(containerId);

		const provider = createDockerProvider();
		const result = await provider.create({ template: "node:20" });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		vi.clearAllMocks();
		// execa with reject:false returns a result with timedOut=true instead of throwing
		mockExeca.mockResolvedValue(
			makeExecaResult({ timedOut: true, stdout: "", stderr: "" }),
		);

		const cmdResult = await result.instance.commands.run("sleep 100", {
			timeoutMs: 100,
		});

		expect(cmdResult.exitCode).toBe(-1);
		expect(cmdResult.stderr).toMatch(/timeout/i);
	});

	// -------------------------------------------------------------------------
	// kill
	// -------------------------------------------------------------------------

	it("kill calls docker rm -f with the container id", async () => {
		const containerId = "kill-container";
		setupDefaultMocks(containerId);

		const provider = createDockerProvider();
		const result = await provider.create({ template: "node:20" });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		vi.clearAllMocks();
		mockExeca.mockResolvedValue(makeExecaResult());

		await result.instance.kill();

		expect(mockExeca).toHaveBeenCalledWith("docker", ["rm", "-f", containerId]);
	});

	// -------------------------------------------------------------------------
	// commands.run — streaming callbacks (non-streaming compatibility)
	// -------------------------------------------------------------------------

	it("commands.run calls onStdout and onStderr callbacks with buffered output", async () => {
		const containerId = "callback-container";
		setupDefaultMocks(containerId);

		const provider = createDockerProvider();
		const result = await provider.create({ template: "node:20" });
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		vi.clearAllMocks();
		mockExeca.mockResolvedValue(
			makeExecaResult({
				stdout: "hello world\n",
				stderr: "warning\n",
				exitCode: 0,
			}),
		);

		const onStdout = vi.fn();
		const onStderr = vi.fn();
		await result.instance.commands.run("echo hello", { onStdout, onStderr });

		expect(onStdout).toHaveBeenCalledWith("hello world\n");
		expect(onStderr).toHaveBeenCalledWith("warning\n");
	});

	it("commands.run does not call onStdout/onStderr when output is empty", async () => {
		const containerId = "no-callback-container";
		setupDefaultMocks(containerId);

		const provider = createDockerProvider();
		const result = await provider.create({ template: "node:20" });
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		vi.clearAllMocks();
		mockExeca.mockResolvedValue(makeExecaResult({ stdout: "", stderr: "" }));

		const onStdout = vi.fn();
		const onStderr = vi.fn();
		await result.instance.commands.run("true", { onStdout, onStderr });

		expect(onStdout).not.toHaveBeenCalled();
		expect(onStderr).not.toHaveBeenCalled();
	});

	// -------------------------------------------------------------------------
	// files.write — path safety
	// -------------------------------------------------------------------------

	it("files.write safely handles paths with special characters", async () => {
		const containerId = "safe-path-container";
		setupDefaultMocks(containerId);

		const provider = createDockerProvider();
		const result = await provider.create({ template: "node:20" });
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		vi.clearAllMocks();
		mockExeca.mockResolvedValue(makeExecaResult());

		// Path with single quotes should not break the command
		await result.instance.files.write("/workspace/user's file.txt", "content");

		// Should use tee with path as an argument, not shell interpolation
		expect(mockExeca).toHaveBeenCalledWith(
			"docker",
			["exec", "-i", containerId, "tee", "/workspace/user's file.txt"],
			expect.objectContaining({ input: expect.anything(), stdout: "ignore" }),
		);
	});

	it("files.write passes Uint8Array as Buffer input without string conversion", async () => {
		const containerId = "binary-container";
		setupDefaultMocks(containerId);

		const provider = createDockerProvider();
		const result = await provider.create({ template: "node:20" });
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		vi.clearAllMocks();
		mockExeca.mockResolvedValue(makeExecaResult());

		const bytes = new Uint8Array([0x00, 0xff, 0x80, 0x7f]);
		await result.instance.files.write("/workspace/binary.bin", bytes);

		// calls[0] is mkdir -p, calls[1] is tee
		const teeCall = mockExeca.mock.calls[1] as [
			string,
			string[],
			Record<string, unknown>,
		];
		const input = teeCall[2]?.input;
		// Should pass raw bytes, not decoded string
		expect(input).toBeInstanceOf(Buffer);
	});

	// -------------------------------------------------------------------------
	// files.read — bytes format
	// -------------------------------------------------------------------------

	it("files.read passes encoding 'buffer' to execa for bytes format", async () => {
		const containerId = "read-bytes-container";
		setupDefaultMocks(containerId);

		const provider = createDockerProvider();
		const result = await provider.create({ template: "node:20" });
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		vi.clearAllMocks();
		// When encoding: "buffer" is used, execa returns Buffer for stdout
		const binaryData = Buffer.from([0x00, 0xff, 0x80, 0x7f]);
		mockExeca.mockResolvedValue({
			stdout: binaryData,
			stderr: "",
			exitCode: 0,
		});

		const content = await result.instance.files.read("/workspace/binary.bin", {
			format: "bytes",
		});

		expect(content).toBeInstanceOf(Uint8Array);
		expect(Buffer.from(content as Uint8Array)).toEqual(binaryData);

		// Verify execa was called with encoding: "buffer"
		const callArgs = mockExeca.mock.calls[0] as [
			string,
			string[],
			Record<string, unknown>,
		];
		expect(callArgs[2]).toMatchObject({ encoding: "buffer" });
	});

	// -------------------------------------------------------------------------
	// Orphan reaping — should not kill concurrent sandboxes
	// -------------------------------------------------------------------------

	it("does not reap running containers on create (relies on --rm + kill)", async () => {
		setupDefaultMocks();

		const provider = createDockerProvider();
		await provider.create({ template: "node:20" });

		// Should NOT call docker ps or docker rm for reaping
		const psCalls = _callsFor("ps");
		expect(psCalls).toHaveLength(0);
	});

	// -------------------------------------------------------------------------
	// kill
	// -------------------------------------------------------------------------

	it("kill is idempotent — second kill does not throw even if docker rm -f fails", async () => {
		const containerId = "double-kill-container";
		setupDefaultMocks(containerId);

		const provider = createDockerProvider();
		const result = await provider.create({ template: "node:20" });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		vi.clearAllMocks();
		mockExeca
			.mockResolvedValueOnce(makeExecaResult())
			.mockRejectedValueOnce(new Error("No such container"));

		await result.instance.kill();
		await expect(result.instance.kill()).resolves.toBeUndefined();
	});
});
