import {
	type CreateResult,
	SANDBOX_PROVIDER_NAMES,
	type SandboxErrorCode,
	type SandboxProvider,
	type SandboxProviderConfig,
	type SandboxProviderName,
} from "./sandbox-provider.js";

// ---------------------------------------------------------------------------
// Registry internals
// ---------------------------------------------------------------------------

type ProviderFactory = () => Promise<SandboxProvider>;

export type ProviderResult =
	| { ok: true; provider: SandboxProvider }
	| { ok: false; code: SandboxErrorCode; message: string; hint?: string };

const factories = new Map<SandboxProviderName, ProviderFactory>();
const cache = new Map<SandboxProviderName, SandboxProvider>();

// ---------------------------------------------------------------------------
// registerSandboxProvider — register a provider factory
// ---------------------------------------------------------------------------

export function registerSandboxProvider(
	name: SandboxProviderName,
	factory: ProviderFactory,
): void {
	factories.set(name, factory);
	cache.delete(name);
}

// ---------------------------------------------------------------------------
// getSandboxProvider — get a provider, calling the factory on first access
// ---------------------------------------------------------------------------

export async function getSandboxProvider(
	name: SandboxProviderName,
): Promise<ProviderResult> {
	if (!(SANDBOX_PROVIDER_NAMES as readonly string[]).includes(name)) {
		return {
			ok: false,
			code: "PROVIDER_UNKNOWN",
			message: `Unknown sandbox provider: "${name}"`,
			hint: `Known providers: ${SANDBOX_PROVIDER_NAMES.join(", ")}`,
		};
	}

	const cached = cache.get(name);
	if (cached) {
		return { ok: true, provider: cached };
	}

	const factory = factories.get(name);
	if (!factory) {
		return {
			ok: false,
			code: "PROVIDER_UNKNOWN",
			message: `No factory registered for provider: "${name}"`,
			hint: `Known providers: ${SANDBOX_PROVIDER_NAMES.join(", ")}`,
		};
	}

	try {
		const provider = await factory();
		cache.set(name, provider);
		return { ok: true, provider };
	} catch (err) {
		const nodeErr = err as NodeJS.ErrnoException & { message: string };
		if (
			nodeErr.code === "MODULE_NOT_FOUND" ||
			nodeErr.code === "ERR_MODULE_NOT_FOUND" ||
			nodeErr.message?.includes("Cannot find module") ||
			nodeErr.message?.includes("Cannot find package") ||
			nodeErr.message?.includes("Failed to resolve") ||
			nodeErr.message?.includes("Could not resolve")
		) {
			return {
				ok: false,
				code: "PROVIDER_SDK_MISSING",
				message: `Provider SDK for "${name}" is not installed`,
				hint: "Install the provider SDK: bun add <package>",
			};
		}
		throw err;
	}
}

// ---------------------------------------------------------------------------
// resetRegistry — test-only: clear all registrations and cache
// ---------------------------------------------------------------------------

export function resetRegistry(): void {
	factories.clear();
	cache.clear();
	registerBuiltInProviders();
}

// ---------------------------------------------------------------------------
// Built-in provider registrations (lazy dynamic import)
// ---------------------------------------------------------------------------

function stubProvider(name: SandboxProviderName): SandboxProvider {
	return {
		name,
		create: async (_config: SandboxProviderConfig): Promise<CreateResult> => ({
			ok: false,
			code: "SANDBOX_ERROR",
			message: `${name} provider adapter not yet implemented`,
		}),
	};
}

function registerBuiltInProviders(): void {
	registerSandboxProvider("e2b", async () => {
		await import("e2b"); // verify SDK available
		const { createE2BProvider } = await import("./providers/e2b.js");
		return createE2BProvider();
	});

	registerSandboxProvider("vercel", async () => {
		const pkg = "@vercel/sandbox";
		await import(pkg); // verify SDK available
		const { createVercelProvider } = await import("./providers/vercel.js");
		return createVercelProvider();
	});

	registerSandboxProvider("docker", async () => {
		const { createDockerProvider } = await import("./providers/docker.js");
		return createDockerProvider();
	});

	registerSandboxProvider("cloudflare", async () => {
		const pkg = "@cloudflare/workers-sandbox";
		await import(pkg);
		return stubProvider("cloudflare");
	});
}

registerBuiltInProviders();
