import {
	MAX_FILE_BYTES,
	MAX_TOTAL_BYTES,
	shellQuote,
	validateRelativePath,
} from "./files.js";
import type {
	CommandOptions,
	CommandResult,
	SandboxInstance,
	SandboxProviderName,
} from "./sandbox-provider.js";
import { SANDBOX_PROVIDER_NAMES } from "./sandbox-provider.js";
import type { QueryRequest, SandcasterConfig } from "./schemas.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SandboxFactory = (
	provider: SandboxProviderName,
	template?: string,
) => Promise<SandboxInstance>;

export interface SandboxPoolConfig {
	maxSandboxes: number;
	maxTotalSpawns: number;
	allowedProviders: SandboxProviderName[];
	requestId: string;
}

export interface TransferResult {
	transferred: string[];
	failed: Array<{ path: string; error: string }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Glob helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if a path pattern contains glob metacharacters.
 */
function isGlob(pattern: string): boolean {
	return (
		pattern.includes("*") || pattern.includes("?") || pattern.includes("[")
	);
}

/**
 * Converts a glob pattern into a RegExp.
 * Supports `*` (match within path segment), `**` (match across segments),
 * and `?` (match single char, not `/`).
 */
function globToRegex(pattern: string): RegExp {
	// Normalize to forward slashes and collapse consecutive globstars to prevent ReDoS
	const normalized = pattern
		.replace(/\\/g, "/")
		.replace(/(\*\*\/)+/g, "**/")
		.replace(/(\*\*)+/g, "**");
	let regexStr = "";

	let i = 0;
	while (i < normalized.length) {
		const ch = normalized[i];

		if (ch === "*" && normalized[i + 1] === "*") {
			// ** — match anything including slashes
			regexStr += ".*";
			i += 2;
			// skip trailing slash after ** if present
			if (normalized[i] === "/") i++;
		} else if (ch === "*") {
			// * — match anything except slash
			regexStr += "[^/]*";
			i++;
		} else if (ch === "?") {
			// ? — match single char except slash
			regexStr += "[^/]";
			i++;
		} else if (ch === ".") {
			regexStr += "\\.";
			i++;
		} else if (/[{}()+^$|[\]\\]/.test(ch)) {
			regexStr += `\\${ch}`;
			i++;
		} else {
			regexStr += ch;
			i++;
		}
	}

	return new RegExp(`^${regexStr}$`);
}

/**
 * Expand a glob pattern against file paths returned from the sandbox.
 * Uses `find` in the sandbox workDir to list all files, then filters by pattern.
 */
async function expandGlob(
	instance: SandboxInstance,
	pattern: string,
): Promise<string[]> {
	const wd = shellQuote(instance.workDir);
	const { stdout } = await instance.commands.run(
		`find ${wd} -type f | sed "s|${instance.workDir}/||"`,
	);

	const allFiles = stdout
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);

	const regex = globToRegex(pattern);
	const matched = allFiles.filter((f) => regex.test(f));

	// Validate expanded paths to prevent traversal via crafted filenames
	const validated: string[] = [];
	for (const p of matched) {
		validateRelativePath(p); // throws on traversal/absolute
		validated.push(p);
	}
	return validated;
}

// ---------------------------------------------------------------------------
// SandboxPool
// ---------------------------------------------------------------------------

interface SandboxEntry {
	instance: SandboxInstance;
	provider: SandboxProviderName;
	status: "active";
}

export class SandboxPool {
	private readonly _primary: SandboxInstance;
	private readonly _config: SandboxPoolConfig;
	private readonly _factory: SandboxFactory;
	private readonly _secondary: Map<string, SandboxEntry> = new Map();
	private readonly _pendingSpawns: Map<string, Promise<SandboxInstance>> =
		new Map();
	private _totalSpawnCount = 0;

	constructor(
		primary: SandboxInstance,
		config: SandboxPoolConfig,
		factory: SandboxFactory,
	) {
		this._primary = primary;
		this._config = config;
		this._factory = factory;
	}

	// -------------------------------------------------------------------------
	// Properties
	// -------------------------------------------------------------------------

	get size(): number {
		return this._secondary.size;
	}

	get names(): string[] {
		return Array.from(this._secondary.keys());
	}

	// -------------------------------------------------------------------------
	// get / has
	// -------------------------------------------------------------------------

	get(name: string): SandboxInstance | undefined {
		if (name === "primary") return this._primary;
		return this._secondary.get(name)?.instance;
	}

	has(name: string): boolean {
		if (name === "primary") return true;
		return this._secondary.has(name);
	}

	// -------------------------------------------------------------------------
	// spawn
	// -------------------------------------------------------------------------

	async spawn(
		name: string,
		provider: SandboxProviderName,
		template?: string,
	): Promise<SandboxInstance> {
		if (name.trim().toLowerCase() === "primary") {
			throw new Error(`Sandbox name "primary" is reserved`);
		}

		if (this._secondary.has(name) || this._pendingSpawns.has(name)) {
			throw new Error(`Sandbox with name "${name}" already exists`);
		}

		if (!this._config.allowedProviders.includes(provider)) {
			throw new Error(
				`Provider "${provider}" is not in allowedProviders: [${this._config.allowedProviders.join(", ")}]`,
			);
		}

		const activeAndPending = this._secondary.size + this._pendingSpawns.size;
		if (activeAndPending >= this._config.maxSandboxes) {
			throw new Error(
				`Cannot spawn: active + pending count (${activeAndPending}) has reached maxSandboxes (${this._config.maxSandboxes})`,
			);
		}

		if (this._totalSpawnCount >= this._config.maxTotalSpawns) {
			throw new Error(
				`Cannot spawn: total spawn count (${this._totalSpawnCount}) has reached maxTotalSpawns (${this._config.maxTotalSpawns})`,
			);
		}

		try {
			this._totalSpawnCount++;
			const spawnPromise = this._factory(provider, template);
			this._pendingSpawns.set(name, spawnPromise);

			const instance = await spawnPromise;
			this._secondary.set(name, { instance, provider, status: "active" });
			return instance;
		} catch (err) {
			this._totalSpawnCount--;
			throw err;
		} finally {
			this._pendingSpawns.delete(name);
		}
	}

	// -------------------------------------------------------------------------
	// execIn
	// -------------------------------------------------------------------------

	async execIn(
		name: string,
		cmd: string,
		opts?: CommandOptions,
	): Promise<CommandResult> {
		const instance = this.get(name);
		if (instance === undefined) {
			throw new Error(`Sandbox "${name}" not found`);
		}

		if (!instance.capabilities.shellExec) {
			throw new Error(`Sandbox "${name}" does not have shellExec capability`);
		}

		return instance.commands.run(cmd, opts);
	}

	// -------------------------------------------------------------------------
	// transferFiles
	// -------------------------------------------------------------------------

	async transferFiles(
		from: string,
		to: string,
		paths: string[],
	): Promise<TransferResult> {
		const src = this.get(from);
		if (src === undefined) {
			throw new Error(`Source sandbox "${from}" not found`);
		}

		const dst = this.get(to);
		if (dst === undefined) {
			throw new Error(`Destination sandbox "${to}" not found`);
		}

		// Expand globs and validate non-glob paths
		const expandedPaths: string[] = [];
		for (const rawPath of paths) {
			if (isGlob(rawPath)) {
				const matched = await expandGlob(src, rawPath);
				for (const p of matched) {
					expandedPaths.push(p);
				}
			} else {
				// Validate (throws on bad path) before adding
				const validated = validateRelativePath(rawPath);
				expandedPaths.push(validated);
			}
		}

		// Transfer files
		const transferred: string[] = [];
		const failed: Array<{ path: string; error: string }> = [];
		let totalBytes = 0;

		for (const relativePath of expandedPaths) {
			try {
				const srcPath = `${src.workDir}/${relativePath}`;
				const dstPath = `${dst.workDir}/${relativePath}`;

				const content = await src.files.read(srcPath, { format: "bytes" });

				// Size checks
				const byteSize =
					typeof content === "string"
						? Buffer.byteLength(content, "utf8")
						: content.byteLength;

				if (byteSize > MAX_FILE_BYTES) {
					failed.push({
						path: relativePath,
						error: `File exceeds per-file limit of 25MB (${byteSize} bytes)`,
					});
					continue;
				}

				if (totalBytes + byteSize > MAX_TOTAL_BYTES) {
					failed.push({
						path: relativePath,
						error: `Transfer would exceed total limit of 50MB`,
					});
					continue;
				}

				await dst.files.write(dstPath, content);
				transferred.push(relativePath);
				totalBytes += byteSize;
			} catch (err) {
				failed.push({
					path: relativePath,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}

		return { transferred, failed };
	}

	// -------------------------------------------------------------------------
	// kill
	// -------------------------------------------------------------------------

	async kill(name: string): Promise<void> {
		if (name === "primary") {
			throw new Error(`Cannot kill "primary": it is host-owned`);
		}

		const entry = this._secondary.get(name);
		if (entry === undefined) {
			throw new Error(`Sandbox "${name}" not found`);
		}

		await entry.instance.kill();
		this._secondary.delete(name);
	}

	// -------------------------------------------------------------------------
	// killAll
	// -------------------------------------------------------------------------

	async killAll(): Promise<void> {
		// Await any in-flight spawns, then kill their results
		const pendingNames = Array.from(this._pendingSpawns.keys());
		await Promise.allSettled(
			pendingNames.map(async (name) => {
				const p = this._pendingSpawns.get(name);
				if (p) {
					try {
						const instance = await p;
						await instance.kill();
					} catch {
						// ignore
					}
				}
			}),
		);

		// Kill all secondaries in parallel
		const secondaryKills = Array.from(this._secondary.values()).map(
			async (entry) => {
				try {
					await entry.instance.kill();
				} catch (err) {
					console.error(`Error killing secondary sandbox:`, err);
				}
			},
		);
		await Promise.allSettled(secondaryKills);
		this._secondary.clear();

		// Kill primary last
		await this._primary.kill();
	}

	// -------------------------------------------------------------------------
	// listSandboxes
	// -------------------------------------------------------------------------

	listSandboxes(): Array<{
		name: string;
		provider: SandboxProviderName | "primary";
		status: string;
	}> {
		const result: Array<{
			name: string;
			provider: SandboxProviderName | "primary";
			status: string;
		}> = [{ name: "primary", provider: "primary", status: "active" }];

		for (const [name, entry] of this._secondary) {
			result.push({ name, provider: entry.provider, status: entry.status });
		}

		return result;
	}

	// -------------------------------------------------------------------------
	// Static: isCompositeCapable
	// -------------------------------------------------------------------------

	static isCompositeCapable(instance: SandboxInstance): boolean {
		return instance.capabilities.fileSystem && instance.capabilities.shellExec;
	}
}

// ---------------------------------------------------------------------------
// resolveCompositeConfig
// ---------------------------------------------------------------------------

const ALL_PROVIDERS: SandboxProviderName[] = [...SANDBOX_PROVIDER_NAMES];

const DEFAULTS = {
	maxSandboxes: 3,
	maxTotalSpawns: 10,
	allowedProviders: ALL_PROVIDERS,
	pollIntervalMs: 50,
} as const;

export function resolveCompositeConfig(
	config?: SandcasterConfig["composite"],
	request?: QueryRequest["composite"],
): {
	maxSandboxes: number;
	maxTotalSpawns: number;
	allowedProviders: SandboxProviderName[];
	pollIntervalMs: number;
} {
	const baseMaxSandboxes = config?.maxSandboxes ?? DEFAULTS.maxSandboxes;
	const baseMaxTotalSpawns = config?.maxTotalSpawns ?? DEFAULTS.maxTotalSpawns;
	const baseAllowedProviders: SandboxProviderName[] =
		config?.allowedProviders ?? DEFAULTS.allowedProviders;
	const basePollIntervalMs = config?.pollIntervalMs ?? DEFAULTS.pollIntervalMs;

	const maxSandboxes =
		request?.maxSandboxes !== undefined
			? Math.min(baseMaxSandboxes, request.maxSandboxes)
			: baseMaxSandboxes;

	const maxTotalSpawns =
		request?.maxTotalSpawns !== undefined
			? Math.min(baseMaxTotalSpawns, request.maxTotalSpawns)
			: baseMaxTotalSpawns;

	const allowedProviders: SandboxProviderName[] =
		request?.allowedProviders !== undefined
			? baseAllowedProviders.filter((p) =>
					request.allowedProviders?.includes(p),
				)
			: baseAllowedProviders;

	return {
		maxSandboxes,
		maxTotalSpawns,
		allowedProviders,
		pollIntervalMs: basePollIntervalMs,
	};
}
