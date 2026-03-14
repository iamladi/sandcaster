import { describe, expect, it } from "vitest";
import {
	resolveProviderCredential,
	resolveSandboxProvider,
} from "../sandbox-resolver.js";

// ---------------------------------------------------------------------------
// resolveSandboxProvider — resolution chain
// ---------------------------------------------------------------------------

describe("resolveSandboxProvider", () => {
	const noDocker = () => false;
	const hasDocker = () => true;

	it("request provider takes precedence over config and env", () => {
		const result = resolveSandboxProvider({
			requestProvider: "vercel",
			configProvider: "docker",
			env: { VERCEL_TOKEN: "tok", E2B_API_KEY: "key" },
			checkDockerSocket: noDocker,
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
			checkDockerSocket: noDocker,
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.name).toBe("docker");
		}
	});

	it("auto-detects e2b from E2B_API_KEY", () => {
		const result = resolveSandboxProvider({
			env: { E2B_API_KEY: "mykey" },
			checkDockerSocket: noDocker,
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.name).toBe("e2b");
		}
	});

	it("auto-detects vercel from VERCEL_TOKEN", () => {
		const result = resolveSandboxProvider({
			env: { VERCEL_TOKEN: "mytoken" },
			checkDockerSocket: noDocker,
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.name).toBe("vercel");
		}
	});

	it("auto-detects cloudflare from CLOUDFLARE_API_TOKEN", () => {
		const result = resolveSandboxProvider({
			env: { CLOUDFLARE_API_TOKEN: "mytoken" },
			checkDockerSocket: noDocker,
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.name).toBe("cloudflare");
		}
	});

	it("e2b takes priority when both E2B_API_KEY and VERCEL_TOKEN are present", () => {
		const result = resolveSandboxProvider({
			env: { E2B_API_KEY: "key", VERCEL_TOKEN: "tok" },
			checkDockerSocket: noDocker,
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.name).toBe("e2b");
		}
	});

	it("falls back to docker when no cloud keys and Docker socket is available", () => {
		const result = resolveSandboxProvider({
			env: {},
			checkDockerSocket: hasDocker,
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.name).toBe("docker");
		}
	});

	it("falls back to docker when no cloud keys and DOCKER_HOST is set", () => {
		const result = resolveSandboxProvider({
			env: { DOCKER_HOST: "unix:///var/run/docker.sock" },
			checkDockerSocket: noDocker,
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.name).toBe("docker");
		}
	});

	it("defaults to e2b when no cloud keys and Docker is unavailable", () => {
		const result = resolveSandboxProvider({
			env: {},
			checkDockerSocket: noDocker,
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.name).toBe("e2b");
		}
	});

	it("returns PROVIDER_UNKNOWN for an unknown provider name", () => {
		const result = resolveSandboxProvider({
			requestProvider: "unknown-sandbox",
			env: {},
			checkDockerSocket: noDocker,
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
			checkDockerSocket: noDocker,
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

	it("returns undefined for docker (no API key needed)", () => {
		const cred = resolveProviderCredential("docker", {
			requestApiKeys: {},
			env: {},
		});
		expect(cred).toBeUndefined();
	});
});
