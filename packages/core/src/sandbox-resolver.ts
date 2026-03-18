import { existsSync } from "node:fs";
import {
	SANDBOX_PROVIDER_NAMES,
	type SandboxErrorCode,
	type SandboxProviderName,
} from "./sandbox-provider.js";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type ResolveResult =
	| { ok: true; name: SandboxProviderName }
	| { ok: false; code: SandboxErrorCode; message: string; hint: string };

// ---------------------------------------------------------------------------
// Provider-to-env-var mapping
// ---------------------------------------------------------------------------

export const PROVIDER_ENV_VARS: Record<
	SandboxProviderName,
	string | undefined
> = {
	e2b: "E2B_API_KEY",
	vercel: "VERCEL_TOKEN",
	cloudflare: "CLOUDFLARE_API_TOKEN",
	docker: undefined, // Docker uses local daemon, no API key needed
};

// Auto-detection priority order: first match wins
// Auto-detection requires all necessary env vars for a provider to be usable
const AUTO_DETECT_ORDER: Array<{
	provider: SandboxProviderName;
	envVars: string[];
}> = [
	{ provider: "e2b", envVars: ["E2B_API_KEY"] },
	{ provider: "vercel", envVars: ["VERCEL_TOKEN"] },
	{
		provider: "cloudflare",
		envVars: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_SANDBOX_WORKER_URL"],
	},
];

const DOCKER_SOCKET_PATHS = ["/var/run/docker.sock", "/run/docker.sock"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isKnownProvider(name: string): name is SandboxProviderName {
	return (SANDBOX_PROVIDER_NAMES as readonly string[]).includes(name);
}

function unknownProviderError(name: string): ResolveResult {
	return {
		ok: false,
		code: "PROVIDER_UNKNOWN",
		message: `Unknown sandbox provider: "${name}"`,
		hint: `Known providers: ${SANDBOX_PROVIDER_NAMES.join(", ")}`,
	};
}

function isDockerSocketAvailable(): boolean {
	return DOCKER_SOCKET_PATHS.some((p) => existsSync(p));
}

// ---------------------------------------------------------------------------
// resolveSandboxProvider
//
// Resolution chain:
//   request.sandboxProvider > config.sandboxProvider > env auto-detect > "e2b"
// ---------------------------------------------------------------------------

export function resolveSandboxProvider(opts: {
	requestProvider?: string;
	configProvider?: string;
	env?: Record<string, string | undefined>;
	checkDockerSocket?: () => boolean;
}): ResolveResult {
	const env = opts.env ?? process.env;
	const checkDocker = opts.checkDockerSocket ?? isDockerSocketAvailable;

	// 1. Request-level provider takes top priority
	if (opts.requestProvider !== undefined) {
		if (!isKnownProvider(opts.requestProvider)) {
			return unknownProviderError(opts.requestProvider);
		}
		return { ok: true, name: opts.requestProvider };
	}

	// 2. Config-level provider
	if (opts.configProvider !== undefined) {
		if (!isKnownProvider(opts.configProvider)) {
			return unknownProviderError(opts.configProvider);
		}
		return { ok: true, name: opts.configProvider };
	}

	// 3. Auto-detect from env vars (first match where ALL required vars are set)
	for (const { provider, envVars } of AUTO_DETECT_ORDER) {
		if (envVars.every((v) => env[v])) {
			return { ok: true, name: provider };
		}
	}

	// 4. No cloud keys found — try Docker if available, then fall back to e2b
	if (env.DOCKER_HOST || checkDocker()) {
		return { ok: true, name: "docker" };
	}

	return { ok: true, name: "e2b" };
}

// ---------------------------------------------------------------------------
// resolveProviderCredential
//
// Credential resolution:
//   request.apiKeys.<provider> > env var for that provider
// ---------------------------------------------------------------------------

export function resolveProviderCredential(
	provider: SandboxProviderName,
	opts: {
		requestApiKeys?: Record<string, string | undefined>;
		env?: Record<string, string | undefined>;
	},
): string | undefined {
	const env = opts.env ?? process.env;

	// 1. Request-level key takes priority
	const requestKey = opts.requestApiKeys?.[provider];
	if (requestKey) {
		return requestKey;
	}

	// 2. Env var for this provider
	const envVar = PROVIDER_ENV_VARS[provider];
	if (envVar) {
		const envVal = env[envVar];
		if (envVal) {
			return envVal;
		}
	}

	return undefined;
}
