// ---------------------------------------------------------------------------
// SandboxErrorCode — all known error codes for sandbox operations
// ---------------------------------------------------------------------------

export type SandboxErrorCode =
	| "PROVIDER_SDK_MISSING"
	| "PROVIDER_AUTH_MISSING"
	| "PROVIDER_UNKNOWN"
	| "CAPABILITY_MISSING"
	| "INVALID_TEMPLATE_FOR_PROVIDER"
	| "TEMPLATE_NOT_FOUND"
	| "TEMPLATE_INCOMPATIBLE"
	| "RATE_LIMIT"
	| "SANDBOX_TIMEOUT"
	| "SANDBOX_ERROR";

// ---------------------------------------------------------------------------
// SandboxOperationError — thrown by SandboxInstance methods (post-create failures)
// ---------------------------------------------------------------------------

export class SandboxOperationError extends Error {
	constructor(
		message: string,
		public readonly code: SandboxErrorCode,
		public readonly hint?: string,
	) {
		super(message);
		this.name = "SandboxOperationError";
	}
}

// ---------------------------------------------------------------------------
// CommandResult — returned by commands.run()
// ---------------------------------------------------------------------------

export interface CommandResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

// ---------------------------------------------------------------------------
// CommandOptions — options for commands.run()
// ---------------------------------------------------------------------------

export interface CommandOptions {
	timeoutMs?: number;
	signal?: AbortSignal;
	onStdout?: (data: string) => void;
	onStderr?: (data: string) => void;
}

// ---------------------------------------------------------------------------
// SandboxCapabilities — 8-boolean capability matrix
// ---------------------------------------------------------------------------

export interface SandboxCapabilities {
	// Hard-required (all providers must support these)
	fileSystem: boolean;
	shellExec: boolean;
	envInjection: boolean;
	// Degradable (fallback silently if missing)
	streaming: boolean;
	networkPolicy: boolean;
	snapshots: boolean;
	reconnect: boolean;
	customImage: boolean;
}

// ---------------------------------------------------------------------------
// SandboxInstance — represents a running sandbox
// ---------------------------------------------------------------------------

export interface SandboxInstance {
	readonly workDir: string;
	readonly capabilities: SandboxCapabilities;
	files: {
		write(path: string, content: string | Uint8Array): Promise<void>;
		read(
			path: string,
			opts?: { format?: "text" | "bytes" },
		): Promise<string | Uint8Array>;
	};
	commands: {
		run(cmd: string, opts?: CommandOptions): Promise<CommandResult>;
	};
	kill(): Promise<void>;
}

// ---------------------------------------------------------------------------
// CreateResult — Result type for provider.create() (no exceptions for expected failures)
// ---------------------------------------------------------------------------

export type CreateResult =
	| { ok: true; instance: SandboxInstance }
	| { ok: false; code: SandboxErrorCode; message: string; hint?: string };

// ---------------------------------------------------------------------------
// SandboxProviderConfig — passed to provider.create()
// ---------------------------------------------------------------------------

export interface SandboxProviderConfig {
	template?: string;
	timeoutMs?: number;
	envs?: Record<string, string>;
	metadata?: Record<string, string>;
	apiKey?: string;
}

// ---------------------------------------------------------------------------
// SANDBOX_PROVIDER_NAMES — const array of known provider names
// ---------------------------------------------------------------------------

export const SANDBOX_PROVIDER_NAMES = [
	"e2b",
	"vercel",
	"docker",
	"cloudflare",
] as const;
export type SandboxProviderName = (typeof SANDBOX_PROVIDER_NAMES)[number];

// ---------------------------------------------------------------------------
// SandboxProvider — the core interface each provider implements
// ---------------------------------------------------------------------------

export interface SandboxProvider {
	readonly name: SandboxProviderName;
	create(config: SandboxProviderConfig): Promise<CreateResult>;
}
