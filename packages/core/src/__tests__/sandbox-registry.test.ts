import { describe, expect, it } from "vitest";
import type {
	SandboxProvider,
	SandboxProviderName,
} from "../sandbox-provider.js";
import {
	getSandboxProvider,
	registerSandboxProvider,
} from "../sandbox-registry.js";

// ---------------------------------------------------------------------------
// Helper: create a minimal mock provider
// ---------------------------------------------------------------------------

function makeMockProvider(name: SandboxProviderName): SandboxProvider {
	return {
		name,
		create: async () => ({
			ok: false as const,
			code: "SANDBOX_ERROR" as const,
			message: "mock",
		}),
	};
}

// ---------------------------------------------------------------------------
// Registration and retrieval
// ---------------------------------------------------------------------------

describe("registerSandboxProvider / getSandboxProvider", () => {
	it("retrieves a registered provider by name", async () => {
		const mock = makeMockProvider("docker");
		registerSandboxProvider("docker", async () => mock);

		const result = await getSandboxProvider("docker");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.provider.name).toBe("docker");
		}
	});

	it("calls the factory only once on repeated gets (caching)", async () => {
		let callCount = 0;
		const mock = makeMockProvider("docker");
		registerSandboxProvider("docker", async () => {
			callCount++;
			return mock;
		});

		await getSandboxProvider("docker");
		await getSandboxProvider("docker");

		expect(callCount).toBe(1);
	});

	it("returns PROVIDER_UNKNOWN when requesting an unregistered provider name", async () => {
		// Cast to bypass TypeScript enforcement — simulates an unknown name at runtime
		const result = await getSandboxProvider(
			"unknown-provider" as SandboxProviderName,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("PROVIDER_UNKNOWN");
			expect(result.hint).toMatch(/known providers/i);
		}
	});

	it("returns PROVIDER_SDK_MISSING when factory throws MODULE_NOT_FOUND", async () => {
		registerSandboxProvider("vercel", async () => {
			const err = new Error("Cannot find module 'some-sdk'");
			(err as NodeJS.ErrnoException).code = "MODULE_NOT_FOUND";
			throw err;
		});

		const result = await getSandboxProvider("vercel");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("PROVIDER_SDK_MISSING");
			expect(result.hint).toMatch(/bun add/i);
		}
	});

	it("known providers are pre-registered (e2b)", async () => {
		// Reset by re-importing is not possible in vitest without module reset,
		// but we can at least verify that the initial pre-registration for e2b
		// results in PROVIDER_SDK_MISSING (since SDK likely isn't installed)
		// or ok:true if the SDK happens to be available.
		// The important thing is it does NOT return PROVIDER_UNKNOWN.
		const result = await getSandboxProvider("e2b");
		expect(
			result.ok === true ||
				(result.ok === false && result.code !== "PROVIDER_UNKNOWN"),
		).toBe(true);
		if (!result.ok) {
			expect(result.code).not.toBe("PROVIDER_UNKNOWN");
		}
	});
});
