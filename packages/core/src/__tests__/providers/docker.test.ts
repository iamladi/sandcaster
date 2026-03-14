import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

	afterEach(() => {
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

	it("reaps orphaned containers on create by calling docker ps then docker rm -f", async () => {
		// Simulate two orphaned containers
		mockExeca.mockImplementation((_cmd: string, args: string[]) => {
			if (args[0] === "ps") {
				return Promise.resolve(makeExecaResult({ stdout: "orphan1\norphan2" }));
			}
			if (args[0] === "rm") {
				return Promise.resolve(makeExecaResult());
			}
			if (args[0] === "pull") {
				return Promise.resolve(makeExecaResult());
			}
			if (args[0] === "run") {
				return Promise.resolve(makeExecaResult({ stdout: "newcontainer" }));
			}
			return Promise.resolve(makeExecaResult());
		});

		const provider = createDockerProvider();
		await provider.create({ template: "node:20" });

		const psCalls = mockExeca.mock.calls.filter(
			([, args]: [string, string[]]) => args[0] === "ps",
		);
		expect(psCalls.length).toBeGreaterThanOrEqual(1);

		// Verify docker ps was called with label filter
		const psCall = psCalls[0];
		expect(psCall[1]).toContain("--filter");
		expect(psCall[1]).toContain("label=sandcaster=true");

		// Verify docker rm -f was called for each orphan
		const rmCalls = mockExeca.mock.calls.filter(
			([, args]: [string, string[]]) => args[0] === "rm",
		);
		expect(rmCalls.length).toBeGreaterThanOrEqual(2);
	});

	it("does not call docker rm -f if no orphans found", async () => {
		setupDefaultMocks(); // ps returns ""

		const provider = createDockerProvider();
		await provider.create({ template: "node:20" });

		const rmCalls = mockExeca.mock.calls.filter(
			([, args]: [string, string[]]) => args[0] === "rm",
		);
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

		const runCalls = mockExeca.mock.calls.filter(
			([, args]: [string, string[]]) => args[0] === "run",
		);
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

		const runCalls = mockExeca.mock.calls.filter(
			([, args]: [string, string[]]) => args[0] === "run",
		);
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

		const runCalls = mockExeca.mock.calls.filter(
			([, args]: [string, string[]]) => args[0] === "run",
		);
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
			if (args[0] === "pull") {
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

	it("files.write calls docker exec with cat > path and pipes content as input", async () => {
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
			["exec", "-i", containerId, "sh", "-c", "cat > '/workspace/hello.txt'"],
			expect.objectContaining({ input: "hello world" }),
		);
	});

	it("files.write converts Uint8Array content to string", async () => {
		const containerId = "write-bytes-container";
		setupDefaultMocks(containerId);

		const provider = createDockerProvider();
		const result = await provider.create({ template: "node:20" });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");

		vi.clearAllMocks();
		mockExeca.mockResolvedValue(makeExecaResult());

		const bytes = new TextEncoder().encode("byte content");
		await result.instance.files.write("/workspace/bytes.txt", bytes);

		expect(mockExeca).toHaveBeenCalledWith(
			"docker",
			["exec", "-i", containerId, "sh", "-c", "cat > '/workspace/bytes.txt'"],
			expect.objectContaining({ input: expect.any(String) }),
		);
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
