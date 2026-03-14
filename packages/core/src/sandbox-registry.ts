import {
	SANDBOX_PROVIDER_NAMES,
	type SandboxErrorCode,
	type SandboxProvider,
	type SandboxProviderName,
} from "./sandbox-provider.js";

// ---------------------------------------------------------------------------
// Registry internals
// ---------------------------------------------------------------------------

type ProviderFactory = () => Promise<SandboxProvider>;

export type ProviderResult =
	| { ok: true; provider: SandboxProvider }
	| { ok: false; code: SandboxErrorCode; message: string; hint: string };

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
	// Invalidate cache so the new factory is used on next get
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

	// Return from cache if available
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
				hint: `Install the provider SDK: bun add <package>`,
			};
		}
		throw err;
	}
}

// ---------------------------------------------------------------------------
// Built-in provider registrations (lazy dynamic import)
// ---------------------------------------------------------------------------

// Each factory dynamically imports the provider's SDK package.
// If the SDK is not installed, the import throws and getSandboxProvider
// returns { ok: false, code: "PROVIDER_SDK_MISSING" }.
// Full provider adapters will be implemented in Phase 3.

registerSandboxProvider("e2b", async () => {
	// Verify the e2b SDK is available; full adapter implemented in Phase 3
	await import("e2b");
	return {
		name: "e2b" as const,
		create: async (_config) => ({
			ok: false as const,
			code: "SANDBOX_ERROR" as const,
			message: "E2B provider adapter not yet implemented",
			hint: "Full implementation coming in Phase 3",
		}),
	};
});

registerSandboxProvider("vercel", async () => {
	// Verify the Vercel sandbox SDK is available; full adapter in Phase 3
	await import("@vercel/sandbox" as string);
	return {
		name: "vercel" as const,
		create: async (_config) => ({
			ok: false as const,
			code: "SANDBOX_ERROR" as const,
			message: "Vercel provider adapter not yet implemented",
		}),
	};
});

registerSandboxProvider("docker", async () => {
	// Verify dockerode is available; full adapter in Phase 3
	await import("dockerode" as string);
	return {
		name: "docker" as const,
		create: async (_config) => ({
			ok: false as const,
			code: "SANDBOX_ERROR" as const,
			message: "Docker provider adapter not yet implemented",
		}),
	};
});

registerSandboxProvider("cloudflare", async () => {
	// Verify the Cloudflare sandbox SDK is available; full adapter in Phase 3
	await import("@cloudflare/workers-sandbox" as string);
	return {
		name: "cloudflare" as const,
		create: async (_config) => ({
			ok: false as const,
			code: "SANDBOX_ERROR" as const,
			message: "Cloudflare provider adapter not yet implemented",
		}),
	};
});
