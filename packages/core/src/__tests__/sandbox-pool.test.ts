import { describe, expect, it, vi } from "vitest";
import {
	resolveCompositeConfig,
	type SandboxFactory,
	SandboxPool,
	type SandboxPoolConfig,
} from "../sandbox-pool.js";
import type { SandboxInstance } from "../sandbox-provider.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCaps(
	overrides: Partial<SandboxInstance["capabilities"]> = {},
): SandboxInstance["capabilities"] {
	return {
		fileSystem: true,
		shellExec: true,
		envInjection: true,
		streaming: true,
		networkPolicy: false,
		snapshots: false,
		reconnect: true,
		customImage: true,
		...overrides,
	};
}

function makeFakeInstance(
	overrides: Partial<SandboxInstance> = {},
): SandboxInstance & {
	files: { write: ReturnType<typeof vi.fn>; read: ReturnType<typeof vi.fn> };
	commands: { run: ReturnType<typeof vi.fn> };
	kill: ReturnType<typeof vi.fn>;
} {
	return {
		workDir: "/home/user",
		capabilities: makeCaps(),
		files: {
			write: vi.fn().mockResolvedValue(undefined),
			read: vi.fn().mockResolvedValue(""),
		},
		commands: {
			run: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
		},
		kill: vi.fn().mockResolvedValue(undefined),
		...overrides,
	} as SandboxInstance & {
		files: { write: ReturnType<typeof vi.fn>; read: ReturnType<typeof vi.fn> };
		commands: { run: ReturnType<typeof vi.fn> };
		kill: ReturnType<typeof vi.fn>;
	};
}

function makeFactory(
	instance?: SandboxInstance,
	failWith?: Error,
): SandboxFactory {
	return vi.fn().mockImplementation(async () => {
		if (failWith) throw failWith;
		return instance ?? makeFakeInstance();
	});
}

function makeConfig(
	overrides: Partial<SandboxPoolConfig> = {},
): SandboxPoolConfig {
	return {
		maxSandboxes: 3,
		maxTotalSpawns: 10,
		allowedProviders: ["e2b", "docker"],
		requestId: "req-test",
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// SandboxPool — constructor + basic properties
// ---------------------------------------------------------------------------

describe("SandboxPool — construction and properties", () => {
	it("size returns 0 when no secondary sandboxes have been spawned", () => {
		const primary = makeFakeInstance();
		const pool = new SandboxPool(primary, makeConfig(), makeFactory());
		expect(pool.size).toBe(0);
	});

	it("names returns empty array when no secondary sandboxes have been spawned", () => {
		const primary = makeFakeInstance();
		const pool = new SandboxPool(primary, makeConfig(), makeFactory());
		expect(pool.names).toEqual([]);
	});

	it("has('primary') returns true", () => {
		const primary = makeFakeInstance();
		const pool = new SandboxPool(primary, makeConfig(), makeFactory());
		expect(pool.has("primary")).toBe(true);
	});

	it("has('unknown') returns false", () => {
		const primary = makeFakeInstance();
		const pool = new SandboxPool(primary, makeConfig(), makeFactory());
		expect(pool.has("unknown")).toBe(false);
	});

	it("get('primary') returns the primary instance", () => {
		const primary = makeFakeInstance();
		const pool = new SandboxPool(primary, makeConfig(), makeFactory());
		expect(pool.get("primary")).toBe(primary);
	});

	it("get('unknown') returns undefined", () => {
		const primary = makeFakeInstance();
		const pool = new SandboxPool(primary, makeConfig(), makeFactory());
		expect(pool.get("unknown")).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// SandboxPool — spawn
// ---------------------------------------------------------------------------

describe("SandboxPool — spawn", () => {
	it("spawns a secondary sandbox and increments size", async () => {
		const primary = makeFakeInstance();
		const secondary = makeFakeInstance();
		const factory = makeFactory(secondary);
		const pool = new SandboxPool(primary, makeConfig(), factory);

		await pool.spawn("worker", "e2b");

		expect(pool.size).toBe(1);
	});

	it("spawned sandbox is accessible by name", async () => {
		const primary = makeFakeInstance();
		const secondary = makeFakeInstance();
		const factory = makeFactory(secondary);
		const pool = new SandboxPool(primary, makeConfig(), factory);

		await pool.spawn("worker", "e2b");

		expect(pool.get("worker")).toBe(secondary);
		expect(pool.has("worker")).toBe(true);
	});

	it("names includes spawned sandbox name", async () => {
		const primary = makeFakeInstance();
		const factory = makeFactory();
		const pool = new SandboxPool(primary, makeConfig(), factory);

		await pool.spawn("worker", "e2b");

		expect(pool.names).toContain("worker");
	});

	it("calls factory with provider and template", async () => {
		const primary = makeFakeInstance();
		const factory = makeFactory();
		const pool = new SandboxPool(primary, makeConfig(), factory);

		await pool.spawn("worker", "e2b", "my-template");

		expect(factory).toHaveBeenCalledWith("e2b", "my-template");
	});

	it("calls factory with provider and undefined template when no template provided", async () => {
		const primary = makeFakeInstance();
		const factory = makeFactory();
		const pool = new SandboxPool(primary, makeConfig(), factory);

		await pool.spawn("worker", "e2b");

		expect(factory).toHaveBeenCalledWith("e2b", undefined);
	});

	it("rejects spawn with name 'primary' (reserved)", async () => {
		const primary = makeFakeInstance();
		const pool = new SandboxPool(primary, makeConfig(), makeFactory());

		await expect(pool.spawn("primary", "e2b")).rejects.toThrow();
	});

	it("rejects spawn with duplicate name", async () => {
		const primary = makeFakeInstance();
		const factory = makeFactory();
		const pool = new SandboxPool(primary, makeConfig(), factory);

		await pool.spawn("worker", "e2b");

		await expect(pool.spawn("worker", "e2b")).rejects.toThrow();
	});

	it("rejects spawn when provider not in allowedProviders", async () => {
		const primary = makeFakeInstance();
		const pool = new SandboxPool(
			primary,
			makeConfig({ allowedProviders: ["e2b"] }),
			makeFactory(),
		);

		await expect(pool.spawn("worker", "vercel")).rejects.toThrow();
	});

	it("rejects spawn when active count is at maxSandboxes", async () => {
		const primary = makeFakeInstance();
		const factory = makeFactory();
		const pool = new SandboxPool(
			primary,
			makeConfig({ maxSandboxes: 2 }),
			factory,
		);

		await pool.spawn("w1", "e2b");
		await pool.spawn("w2", "e2b");

		await expect(pool.spawn("w3", "e2b")).rejects.toThrow();
	});

	it("rejects spawn when totalSpawnCount reaches maxTotalSpawns", async () => {
		const primary = makeFakeInstance();
		const factory = makeFactory();
		const pool = new SandboxPool(
			primary,
			makeConfig({ maxSandboxes: 10, maxTotalSpawns: 2 }),
			factory,
		);

		await pool.spawn("w1", "e2b");
		// Kill w1 so active count doesn't block
		await pool.kill("w1");
		await pool.spawn("w2", "e2b");
		await pool.kill("w2");

		// Now totalSpawnCount == 2, should reject
		await expect(pool.spawn("w3", "e2b")).rejects.toThrow();
	});

	it("removes from pendingSpawns and throws when factory fails", async () => {
		const primary = makeFakeInstance();
		const factory = makeFactory(undefined, new Error("provision failed"));
		const pool = new SandboxPool(primary, makeConfig(), factory);

		await expect(pool.spawn("worker", "e2b")).rejects.toThrow(
			"provision failed",
		);

		// After failure, name should not exist
		expect(pool.has("worker")).toBe(false);
		expect(pool.size).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// SandboxPool — execIn
// ---------------------------------------------------------------------------

describe("SandboxPool — execIn", () => {
	it("runs a command in the named sandbox and returns CommandResult", async () => {
		const primary = makeFakeInstance();
		const secondary = makeFakeInstance();
		secondary.commands.run = vi.fn().mockResolvedValue({
			stdout: "hello",
			stderr: "",
			exitCode: 0,
		});
		const factory = makeFactory(secondary);
		const pool = new SandboxPool(primary, makeConfig(), factory);
		await pool.spawn("worker", "e2b");

		const result = await pool.execIn("worker", "echo hello");

		expect(result).toEqual({ stdout: "hello", stderr: "", exitCode: 0 });
		expect(secondary.commands.run).toHaveBeenCalledWith(
			"echo hello",
			undefined,
		);
	});

	it("runs a command in the primary sandbox", async () => {
		const primary = makeFakeInstance();
		primary.commands.run = vi.fn().mockResolvedValue({
			stdout: "from primary",
			stderr: "",
			exitCode: 0,
		});
		const pool = new SandboxPool(primary, makeConfig(), makeFactory());

		const result = await pool.execIn("primary", "ls");

		expect(result.stdout).toBe("from primary");
	});

	it("passes opts to commands.run", async () => {
		const primary = makeFakeInstance();
		const secondary = makeFakeInstance();
		const factory = makeFactory(secondary);
		const pool = new SandboxPool(primary, makeConfig(), factory);
		await pool.spawn("worker", "e2b");

		const opts = { timeoutMs: 5000 };
		await pool.execIn("worker", "sleep 1", opts);

		expect(secondary.commands.run).toHaveBeenCalledWith("sleep 1", opts);
	});

	it("throws when sandbox not found", async () => {
		const primary = makeFakeInstance();
		const pool = new SandboxPool(primary, makeConfig(), makeFactory());

		await expect(pool.execIn("nonexistent", "ls")).rejects.toThrow();
	});

	it("throws when sandbox lacks shellExec capability", async () => {
		const primary = makeFakeInstance();
		const secondary = makeFakeInstance({
			capabilities: makeCaps({ shellExec: false }),
		});
		const factory = makeFactory(secondary);
		const pool = new SandboxPool(primary, makeConfig(), factory);
		await pool.spawn("worker", "e2b");

		await expect(pool.execIn("worker", "ls")).rejects.toThrow();
	});
});

// ---------------------------------------------------------------------------
// SandboxPool — kill
// ---------------------------------------------------------------------------

describe("SandboxPool — kill", () => {
	it("kills a secondary sandbox and removes it from the pool", async () => {
		const primary = makeFakeInstance();
		const secondary = makeFakeInstance();
		const factory = makeFactory(secondary);
		const pool = new SandboxPool(primary, makeConfig(), factory);
		await pool.spawn("worker", "e2b");

		await pool.kill("worker");

		expect(secondary.kill).toHaveBeenCalledOnce();
		expect(pool.has("worker")).toBe(false);
		expect(pool.size).toBe(0);
	});

	it("throws when killing 'primary' (host-owned)", async () => {
		const primary = makeFakeInstance();
		const pool = new SandboxPool(primary, makeConfig(), makeFactory());

		await expect(pool.kill("primary")).rejects.toThrow();
	});

	it("throws when sandbox not found", async () => {
		const primary = makeFakeInstance();
		const pool = new SandboxPool(primary, makeConfig(), makeFactory());

		await expect(pool.kill("nonexistent")).rejects.toThrow();
	});
});

// ---------------------------------------------------------------------------
// SandboxPool — killAll
// ---------------------------------------------------------------------------

describe("SandboxPool — killAll", () => {
	it("kills all secondary sandboxes and then primary", async () => {
		const primary = makeFakeInstance();
		const s1 = makeFakeInstance();
		const s2 = makeFakeInstance();
		let factoryCallCount = 0;
		const factory: SandboxFactory = vi.fn().mockImplementation(async () => {
			return factoryCallCount++ === 0 ? s1 : s2;
		});
		const pool = new SandboxPool(primary, makeConfig(), factory);
		await pool.spawn("w1", "e2b");
		await pool.spawn("w2", "e2b");

		await pool.killAll();

		expect(s1.kill).toHaveBeenCalledOnce();
		expect(s2.kill).toHaveBeenCalledOnce();
		expect(primary.kill).toHaveBeenCalledOnce();
	});

	it("kills primary even if a secondary kill fails", async () => {
		const primary = makeFakeInstance();
		const secondary = makeFakeInstance();
		secondary.kill = vi.fn().mockRejectedValue(new Error("kill failed"));
		const factory = makeFactory(secondary);
		const pool = new SandboxPool(primary, makeConfig(), factory);
		await pool.spawn("worker", "e2b");

		// Should not throw
		await pool.killAll();

		expect(primary.kill).toHaveBeenCalledOnce();
	});

	it("kills primary when there are no secondaries", async () => {
		const primary = makeFakeInstance();
		const pool = new SandboxPool(primary, makeConfig(), makeFactory());

		await pool.killAll();

		expect(primary.kill).toHaveBeenCalledOnce();
	});
});

// ---------------------------------------------------------------------------
// SandboxPool — listSandboxes
// ---------------------------------------------------------------------------

describe("SandboxPool — listSandboxes", () => {
	it("includes primary in the list", () => {
		const primary = makeFakeInstance();
		const pool = new SandboxPool(primary, makeConfig(), makeFactory());

		const list = pool.listSandboxes();

		expect(list.some((s) => s.name === "primary")).toBe(true);
	});

	it("lists all active sandboxes including spawned ones", async () => {
		const primary = makeFakeInstance();
		const factory = makeFactory();
		const pool = new SandboxPool(primary, makeConfig(), factory);
		await pool.spawn("worker", "e2b");

		const list = pool.listSandboxes();

		expect(list).toHaveLength(2);
		expect(list.some((s) => s.name === "primary")).toBe(true);
		expect(list.some((s) => s.name === "worker")).toBe(true);
	});

	it("each entry has name, provider, and status", async () => {
		const primary = makeFakeInstance();
		const factory = makeFactory();
		const pool = new SandboxPool(
			primary,
			makeConfig({ allowedProviders: ["e2b", "docker"] }),
			factory,
		);
		await pool.spawn("worker", "docker");

		const list = pool.listSandboxes();
		const workerEntry = list.find((s) => s.name === "worker");

		expect(workerEntry).toBeDefined();
		expect(workerEntry).toHaveProperty("name", "worker");
		expect(workerEntry).toHaveProperty("provider");
		expect(workerEntry).toHaveProperty("status");
	});
});

// ---------------------------------------------------------------------------
// SandboxPool — transferFiles
// ---------------------------------------------------------------------------

describe("SandboxPool — transferFiles", () => {
	it("reads from source and writes to destination", async () => {
		const primary = makeFakeInstance();
		const s1 = makeFakeInstance();
		const s2 = makeFakeInstance();
		s1.files.read = vi.fn().mockResolvedValue("file content");
		s2.files.write = vi.fn().mockResolvedValue(undefined);

		let callCount = 0;
		const factory: SandboxFactory = vi.fn().mockImplementation(async () => {
			return callCount++ === 0 ? s1 : s2;
		});

		const pool = new SandboxPool(primary, makeConfig(), factory);
		await pool.spawn("src", "e2b");
		await pool.spawn("dst", "e2b");

		const result = await pool.transferFiles("src", "dst", ["file.txt"]);

		expect(s1.files.read).toHaveBeenCalledWith(
			expect.stringContaining("file.txt"),
			expect.anything(),
		);
		expect(s2.files.write).toHaveBeenCalledWith(
			expect.stringContaining("file.txt"),
			"file content",
		);
		expect(result.transferred).toContain("file.txt");
		expect(result.failed).toHaveLength(0);
	});

	it("supports Uint8Array content transfer", async () => {
		const primary = makeFakeInstance();
		const s1 = makeFakeInstance();
		const s2 = makeFakeInstance();
		const binaryData = new Uint8Array([1, 2, 3]);
		s1.files.read = vi.fn().mockResolvedValue(binaryData);
		s2.files.write = vi.fn().mockResolvedValue(undefined);

		let callCount = 0;
		const factory: SandboxFactory = vi.fn().mockImplementation(async () => {
			return callCount++ === 0 ? s1 : s2;
		});

		const pool = new SandboxPool(primary, makeConfig(), factory);
		await pool.spawn("src", "e2b");
		await pool.spawn("dst", "e2b");

		const result = await pool.transferFiles("src", "dst", ["data.bin"]);

		expect(s2.files.write).toHaveBeenCalledWith(
			expect.stringContaining("data.bin"),
			binaryData,
		);
		expect(result.transferred).toContain("data.bin");
	});

	it("rejects absolute paths", async () => {
		const primary = makeFakeInstance();
		const pool = new SandboxPool(primary, makeConfig(), makeFactory());

		await expect(
			pool.transferFiles("primary", "primary", ["/etc/passwd"]),
		).rejects.toThrow();
	});

	it("rejects traversal paths", async () => {
		const primary = makeFakeInstance();
		const pool = new SandboxPool(primary, makeConfig(), makeFactory());

		await expect(
			pool.transferFiles("primary", "primary", ["../escape"]),
		).rejects.toThrow();
	});

	it("records partial failures in the result", async () => {
		const primary = makeFakeInstance();
		const s1 = makeFakeInstance();
		const s2 = makeFakeInstance();
		// First file succeeds, second file fails to read
		s1.files.read = vi
			.fn()
			.mockResolvedValueOnce("ok")
			.mockRejectedValueOnce(new Error("not found"));
		s2.files.write = vi.fn().mockResolvedValue(undefined);

		let callCount = 0;
		const factory: SandboxFactory = vi.fn().mockImplementation(async () => {
			return callCount++ === 0 ? s1 : s2;
		});

		const pool = new SandboxPool(primary, makeConfig(), factory);
		await pool.spawn("src", "e2b");
		await pool.spawn("dst", "e2b");

		const result = await pool.transferFiles("src", "dst", [
			"good.txt",
			"bad.txt",
		]);

		expect(result.transferred).toContain("good.txt");
		expect(result.failed.some((f) => f.path === "bad.txt")).toBe(true);
	});

	it("throws when source sandbox not found", async () => {
		const primary = makeFakeInstance();
		const pool = new SandboxPool(primary, makeConfig(), makeFactory());

		await expect(
			pool.transferFiles("nonexistent", "primary", ["file.txt"]),
		).rejects.toThrow();
	});

	it("throws when destination sandbox not found", async () => {
		const primary = makeFakeInstance();
		const pool = new SandboxPool(primary, makeConfig(), makeFactory());

		await expect(
			pool.transferFiles("primary", "nonexistent", ["file.txt"]),
		).rejects.toThrow();
	});

	it("matches glob patterns for file transfer", async () => {
		const primary = makeFakeInstance();
		const s1 = makeFakeInstance();
		const s2 = makeFakeInstance();
		s1.files.read = vi.fn().mockResolvedValue("content");
		s2.files.write = vi.fn().mockResolvedValue(undefined);
		// s1 lists files when the path is a glob
		s1.commands.run = vi.fn().mockResolvedValue({
			stdout: "a.sql\nb.sql\nc.txt\n",
			stderr: "",
			exitCode: 0,
		});

		let callCount = 0;
		const factory: SandboxFactory = vi.fn().mockImplementation(async () => {
			return callCount++ === 0 ? s1 : s2;
		});

		const pool = new SandboxPool(primary, makeConfig(), factory);
		await pool.spawn("src", "e2b");
		await pool.spawn("dst", "e2b");

		const result = await pool.transferFiles("src", "dst", ["*.sql"]);

		expect(result.transferred).toContain("a.sql");
		expect(result.transferred).toContain("b.sql");
		expect(result.transferred).not.toContain("c.txt");
	});

	it("handles consecutive globstars without catastrophic backtracking", async () => {
		const primary = makeFakeInstance();
		const s1 = makeFakeInstance();
		const s2 = makeFakeInstance();
		s1.files.read = vi.fn().mockResolvedValue("content");
		s2.files.write = vi.fn().mockResolvedValue(undefined);
		// Generate a realistic file listing
		const paths = Array.from(
			{ length: 100 },
			(_, i) => `src/deep/nested/dir/file${i}.js`,
		);
		paths.push("README.md", "package.json");
		s1.commands.run = vi.fn().mockResolvedValue({
			stdout: paths.join("\n"),
			stderr: "",
			exitCode: 0,
		});

		let callCount = 0;
		const factory: SandboxFactory = vi.fn().mockImplementation(async () => {
			return callCount++ === 0 ? s1 : s2;
		});

		const pool = new SandboxPool(primary, makeConfig(), factory);
		await pool.spawn("src", "e2b");
		await pool.spawn("dst", "e2b");

		// Pattern with consecutive globstars — should behave like a single **
		const start = performance.now();
		const result = await pool.transferFiles("src", "dst", ["**/**/**/*.js"]);
		const elapsed = performance.now() - start;

		// Must match .js files and complete quickly (< 500ms, not seconds)
		expect(result.transferred.length).toBe(100);
		expect(result.transferred).not.toContain("README.md");
		expect(elapsed).toBeLessThan(500);
	});

	it("handles consecutive bare globstars without slashes (ReDoS prevention)", async () => {
		const primary = makeFakeInstance();
		const s1 = makeFakeInstance();
		const s2 = makeFakeInstance();
		s1.files.read = vi.fn().mockResolvedValue("content");
		s2.files.write = vi.fn().mockResolvedValue(undefined);
		// Generate file listing with many long non-matching paths to stress
		// regex backtracking — consecutive `.*` quantifiers cause O(n^k) matching
		// on strings that almost-but-don't-quite match
		const paths = Array.from(
			{ length: 50 },
			(_, i) => `src/deep/nested/dir/file${i}.js`,
		);
		// Add long non-matching paths that trigger backtracking in unpatched regex
		for (let i = 0; i < 50; i++) {
			paths.push(`a/${"b/".repeat(30)}file${i}.txt`);
		}
		paths.push("README.md", "package.json");
		s1.commands.run = vi.fn().mockResolvedValue({
			stdout: paths.join("\n"),
			stderr: "",
			exitCode: 0,
		});

		let callCount = 0;
		const factory: SandboxFactory = vi.fn().mockImplementation(async () => {
			return callCount++ === 0 ? s1 : s2;
		});

		const pool = new SandboxPool(primary, makeConfig(), factory);
		await pool.spawn("src", "e2b");
		await pool.spawn("dst", "e2b");

		// Pattern with consecutive bare ** (no slashes between them) — should
		// collapse to a single ** and not cause catastrophic backtracking
		const start = performance.now();
		const result = await pool.transferFiles("src", "dst", ["******.js"]);
		const elapsed = performance.now() - start;

		// Must match .js files and complete quickly (< 500ms, not seconds)
		expect(result.transferred.length).toBe(50);
		expect(result.transferred).not.toContain("README.md");
		expect(result.transferred).not.toContain("package.json");
		expect(elapsed).toBeLessThan(500);
	});
});

// ---------------------------------------------------------------------------
// SandboxPool — isCompositeCapable (static)
// ---------------------------------------------------------------------------

describe("SandboxPool.isCompositeCapable", () => {
	it("returns true when instance has fileSystem and shellExec", () => {
		const instance = makeFakeInstance({
			capabilities: makeCaps({ fileSystem: true, shellExec: true }),
		});
		expect(SandboxPool.isCompositeCapable(instance)).toBe(true);
	});

	it("returns false when fileSystem is false", () => {
		const instance = makeFakeInstance({
			capabilities: makeCaps({ fileSystem: false, shellExec: true }),
		});
		expect(SandboxPool.isCompositeCapable(instance)).toBe(false);
	});

	it("returns false when shellExec is false", () => {
		const instance = makeFakeInstance({
			capabilities: makeCaps({ fileSystem: true, shellExec: false }),
		});
		expect(SandboxPool.isCompositeCapable(instance)).toBe(false);
	});

	it("returns false when both are false", () => {
		const instance = makeFakeInstance({
			capabilities: makeCaps({ fileSystem: false, shellExec: false }),
		});
		expect(SandboxPool.isCompositeCapable(instance)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// resolveCompositeConfig
// ---------------------------------------------------------------------------

describe("resolveCompositeConfig", () => {
	it("returns defaults when neither config nor request provided", () => {
		const result = resolveCompositeConfig(undefined, undefined);

		expect(result.maxSandboxes).toBe(3);
		expect(result.maxTotalSpawns).toBe(10);
		expect(result.allowedProviders).toEqual(
			expect.arrayContaining(["e2b", "vercel", "docker", "cloudflare"]),
		);
		expect(result.pollIntervalMs).toBe(50);
	});

	it("uses config values when request not provided", () => {
		const result = resolveCompositeConfig(
			{
				maxSandboxes: 5,
				maxTotalSpawns: 20,
				allowedProviders: ["e2b"],
				pollIntervalMs: 100,
			},
			undefined,
		);

		expect(result.maxSandboxes).toBe(5);
		expect(result.maxTotalSpawns).toBe(20);
		expect(result.allowedProviders).toEqual(["e2b"]);
		expect(result.pollIntervalMs).toBe(100);
	});

	it("request tightens maxSandboxes (takes min)", () => {
		const result = resolveCompositeConfig(
			{
				maxSandboxes: 5,
				maxTotalSpawns: 20,
				allowedProviders: ["e2b", "docker"],
				pollIntervalMs: 50,
			},
			{ maxSandboxes: 2 },
		);

		expect(result.maxSandboxes).toBe(2);
	});

	it("request cannot expand maxSandboxes beyond config", () => {
		const result = resolveCompositeConfig(
			{
				maxSandboxes: 3,
				maxTotalSpawns: 10,
				allowedProviders: ["e2b"],
				pollIntervalMs: 50,
			},
			{ maxSandboxes: 10 },
		);

		expect(result.maxSandboxes).toBe(3);
	});

	it("request tightens maxTotalSpawns (takes min)", () => {
		const result = resolveCompositeConfig(
			{
				maxSandboxes: 5,
				maxTotalSpawns: 20,
				allowedProviders: ["e2b"],
				pollIntervalMs: 50,
			},
			{ maxTotalSpawns: 5 },
		);

		expect(result.maxTotalSpawns).toBe(5);
	});

	it("request cannot expand maxTotalSpawns beyond config", () => {
		const result = resolveCompositeConfig(
			{
				maxSandboxes: 5,
				maxTotalSpawns: 10,
				allowedProviders: ["e2b"],
				pollIntervalMs: 50,
			},
			{ maxTotalSpawns: 50 },
		);

		expect(result.maxTotalSpawns).toBe(10);
	});

	it("allowedProviders is intersection of config and request", () => {
		const result = resolveCompositeConfig(
			{
				maxSandboxes: 5,
				maxTotalSpawns: 10,
				allowedProviders: ["e2b", "docker"],
				pollIntervalMs: 50,
			},
			{ allowedProviders: ["e2b", "vercel"] },
		);

		expect(result.allowedProviders).toEqual(["e2b"]);
	});

	it("allowedProviders is empty when intersection is empty", () => {
		const result = resolveCompositeConfig(
			{
				maxSandboxes: 5,
				maxTotalSpawns: 10,
				allowedProviders: ["docker"],
				pollIntervalMs: 50,
			},
			{ allowedProviders: ["e2b"] },
		);

		expect(result.allowedProviders).toEqual([]);
	});

	it("uses config allowedProviders when request does not specify", () => {
		const result = resolveCompositeConfig(
			{
				maxSandboxes: 5,
				maxTotalSpawns: 10,
				allowedProviders: ["e2b", "docker"],
				pollIntervalMs: 50,
			},
			{},
		);

		expect(result.allowedProviders).toEqual(["e2b", "docker"]);
	});

	it("uses defaults when config is undefined but request has values", () => {
		const result = resolveCompositeConfig(undefined, { maxSandboxes: 2 });

		// request tightens defaults (min of 2 and default 3)
		expect(result.maxSandboxes).toBe(2);
	});
});
