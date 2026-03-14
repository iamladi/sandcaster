import { describe, expect, it } from "vitest";
import {
	resolveProviderCredential,
	resolveSandboxProvider,
} from "../sandbox-resolver.js";

// ---------------------------------------------------------------------------
// resolveSandboxProvider — resolution chain
// ---------------------------------------------------------------------------

describe("resolveSandboxProvider", () => {
	it("request provider takes precedence over config and env", () => {
		const result = resolveSandboxProvider({
			requestProvider: "vercel",
			configProvider: "docker",
			env: { VERCEL_TOKEN: "tok", E2B_API_KEY: "key" },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.name).toBe("vercel");
		}
	});

	it("config provider takes precedence over env auto-detect", () => {
		const result = resolveSandboxProvider({
			configProvider: "docker",
			env: { E2B_API_KEY: "key" },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.name).toBe("docker");
		}
	});

	it("auto-detects e2b from E2B_API_KEY", () => {
		const result = resolveSandboxProvider({
			env: { E2B_API_KEY: "mykey" },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.name).toBe("e2b");
		}
	});

	it("auto-detects vercel from VERCEL_TOKEN", () => {
		const result = resolveSandboxProvider({
			env: { VERCEL_TOKEN: "mytoken" },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.name).toBe("vercel");
		}
	});

	it("auto-detects cloudflare from CLOUDFLARE_API_TOKEN", () => {
		const result = resolveSandboxProvider({
			env: { CLOUDFLARE_API_TOKEN: "mytoken" },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.name).toBe("cloudflare");
		}
	});

	it("e2b takes priority when both E2B_API_KEY and VERCEL_TOKEN are present", () => {
		const result = resolveSandboxProvider({
			env: { E2B_API_KEY: "key", VERCEL_TOKEN: "tok" },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.name).toBe("e2b");
		}
	});

	it("defaults to e2b when no keys and no explicit provider", () => {
		const result = resolveSandboxProvider({ env: {} });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.name).toBe("e2b");
		}
	});

	it("returns PROVIDER_UNKNOWN for an unknown provider name", () => {
		const result = resolveSandboxProvider({
			requestProvider: "unknown-sandbox",
			env: {},
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("PROVIDER_UNKNOWN");
			expect(result.hint).toMatch(/known providers/i);
		}
	});

	it("returns PROVIDER_UNKNOWN for an unknown config provider", () => {
		const result = resolveSandboxProvider({
			configProvider: "my-custom-cloud",
			env: {},
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("PROVIDER_UNKNOWN");
		}
	});
});

// ---------------------------------------------------------------------------
// resolveProviderCredential — credential resolution
// ---------------------------------------------------------------------------

describe("resolveProviderCredential", () => {
	it("request apiKeys take precedence over env", () => {
		const cred = resolveProviderCredential("e2b", {
			requestApiKeys: { e2b: "from-request" },
			env: { E2B_API_KEY: "from-env" },
		});
		expect(cred).toBe("from-request");
	});

	it("falls back to env var when no request key", () => {
		const cred = resolveProviderCredential("e2b", {
			requestApiKeys: {},
			env: { E2B_API_KEY: "from-env" },
		});
		expect(cred).toBe("from-env");
	});

	it("returns undefined when no credential exists", () => {
		const cred = resolveProviderCredential("e2b", {
			requestApiKeys: {},
			env: {},
		});
		expect(cred).toBeUndefined();
	});

	it("resolves vercel credential from VERCEL_TOKEN", () => {
		const cred = resolveProviderCredential("vercel", {
			requestApiKeys: {},
			env: { VERCEL_TOKEN: "tok" },
		});
		expect(cred).toBe("tok");
	});

	it("resolves cloudflare credential from CLOUDFLARE_API_TOKEN", () => {
		const cred = resolveProviderCredential("cloudflare", {
			requestApiKeys: {},
			env: { CLOUDFLARE_API_TOKEN: "cftok" },
		});
		expect(cred).toBe("cftok");
	});

	it("resolves docker credential returns undefined (docker has no API key)", () => {
		const cred = resolveProviderCredential("docker", {
			requestApiKeys: {},
			env: {},
		});
		// Docker doesn't need an API key
		expect(cred).toBeUndefined();
	});
});
