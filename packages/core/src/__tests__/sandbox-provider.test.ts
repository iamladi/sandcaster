import { describe, expect, it } from "vitest";
import {
	type CommandOptions,
	type CommandResult,
	type CreateResult,
	SANDBOX_PROVIDER_NAMES,
	type SandboxCapabilities,
	type SandboxInstance,
	SandboxOperationError,
	type SandboxProvider,
	type SandboxProviderConfig,
	type SandboxProviderName,
} from "../sandbox-provider.js";

// ---------------------------------------------------------------------------
// SandboxOperationError
// ---------------------------------------------------------------------------

describe("SandboxOperationError", () => {
	it("has correct name", () => {
		const err = new SandboxOperationError("sandbox failed", "SANDBOX_ERROR");
		expect(err.name).toBe("SandboxOperationError");
	});

	it("has correct message", () => {
		const err = new SandboxOperationError("sandbox failed", "SANDBOX_ERROR");
		expect(err.message).toBe("sandbox failed");
	});

	it("has correct code", () => {
		const err = new SandboxOperationError("sandbox failed", "SANDBOX_ERROR");
		expect(err.code).toBe("SANDBOX_ERROR");
	});

	it("has no hint when omitted", () => {
		const err = new SandboxOperationError("sandbox failed", "SANDBOX_TIMEOUT");
		expect(err.hint).toBeUndefined();
	});

	it("stores hint when provided", () => {
		const err = new SandboxOperationError(
			"sandbox failed",
			"SANDBOX_TIMEOUT",
			"Try reducing the timeout",
		);
		expect(err.hint).toBe("Try reducing the timeout");
	});

	it("is instanceof Error", () => {
		const err = new SandboxOperationError("sandbox failed", "SANDBOX_ERROR");
		expect(err).toBeInstanceOf(Error);
	});

	it("accepts all valid error codes", () => {
		const codes = [
			"PROVIDER_SDK_MISSING",
			"PROVIDER_AUTH_MISSING",
			"PROVIDER_UNKNOWN",
			"CAPABILITY_MISSING",
			"INVALID_TEMPLATE_FOR_PROVIDER",
			"TEMPLATE_NOT_FOUND",
			"TEMPLATE_INCOMPATIBLE",
			"RATE_LIMIT",
			"SANDBOX_TIMEOUT",
			"SANDBOX_ERROR",
		] as const;
		for (const code of codes) {
			const err = new SandboxOperationError("msg", code);
			expect(err.code).toBe(code);
		}
	});
});

// ---------------------------------------------------------------------------
// SANDBOX_PROVIDER_NAMES
// ---------------------------------------------------------------------------

describe("SANDBOX_PROVIDER_NAMES", () => {
	it("contains e2b", () => {
		expect(SANDBOX_PROVIDER_NAMES).toContain("e2b");
	});

	it("contains vercel", () => {
		expect(SANDBOX_PROVIDER_NAMES).toContain("vercel");
	});

	it("contains docker", () => {
		expect(SANDBOX_PROVIDER_NAMES).toContain("docker");
	});

	it("contains cloudflare", () => {
		expect(SANDBOX_PROVIDER_NAMES).toContain("cloudflare");
	});

	it("has exactly 4 entries", () => {
		expect(SANDBOX_PROVIDER_NAMES).toHaveLength(4);
	});
});

// ---------------------------------------------------------------------------
// Type-level assertions (structural tests using TypeScript)
// ---------------------------------------------------------------------------

// These compile-time tests verify that the interfaces are structurally correct.
// They will cause a type error (= compile failure = test failure) if wrong.

describe("SandboxInstance interface shape", () => {
	it("accepts a valid SandboxInstance implementation", () => {
		const instance: SandboxInstance = {
			workDir: "/workspace",
			capabilities: {
				fileSystem: true,
				shellExec: true,
				envInjection: true,
				streaming: false,
				networkPolicy: false,
				snapshots: false,
				reconnect: false,
				customImage: false,
			},
			files: {
				write: async (_path: string, _content: string | Uint8Array) => {},
				read: async (_path: string) => "content",
			},
			commands: {
				run: async (_cmd: string) => ({
					stdout: "",
					stderr: "",
					exitCode: 0,
				}),
			},
			kill: async () => {},
		};
		expect(instance.workDir).toBe("/workspace");
		expect(instance.capabilities.fileSystem).toBe(true);
	});
});

describe("SandboxProvider interface shape", () => {
	it("accepts a valid SandboxProvider implementation", () => {
		const provider: SandboxProvider = {
			name: "e2b" as SandboxProviderName,
			create: async (
				_config: SandboxProviderConfig,
			): Promise<CreateResult> => ({
				ok: false,
				code: "SANDBOX_ERROR",
				message: "not implemented",
			}),
		};
		expect(provider.name).toBe("e2b");
	});
});

describe("CommandResult shape", () => {
	it("accepts a valid CommandResult", () => {
		const result: CommandResult = {
			stdout: "hello",
			stderr: "",
			exitCode: 0,
		};
		expect(result.exitCode).toBe(0);
	});
});

describe("CommandOptions shape", () => {
	it("accepts a valid CommandOptions", () => {
		const opts: CommandOptions = {
			timeoutMs: 5000,
			onStdout: (_data: string) => {},
			onStderr: (_data: string) => {},
		};
		expect(opts.timeoutMs).toBe(5000);
	});
});

describe("SandboxCapabilities shape", () => {
	it("accepts a valid SandboxCapabilities", () => {
		const caps: SandboxCapabilities = {
			fileSystem: true,
			shellExec: true,
			envInjection: true,
			streaming: true,
			networkPolicy: false,
			snapshots: false,
			reconnect: false,
			customImage: false,
		};
		expect(caps.fileSystem).toBe(true);
	});
});
