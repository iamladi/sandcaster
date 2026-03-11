import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SandcasterConfig } from "./schemas.js";
import { SandcasterConfigSchema } from "./schemas.js";

// ---------------------------------------------------------------------------
// Module-level mtime cache (mirrors Sandstorm's _config_cache / _config_mtime)
// ---------------------------------------------------------------------------

let _configCache: SandcasterConfig | null = null;
let _configMtime: number = 0;
let _cacheDir: string | null = null;

const CONFIG_FILE = "sandcaster.json";

// The set of known top-level field names from SandcasterConfigSchema
const KNOWN_FIELDS = new Set(Object.keys(SandcasterConfigSchema.shape));

// ---------------------------------------------------------------------------
// Field-level partial validation
// ---------------------------------------------------------------------------

/**
 * Validates a single field value against its Zod schema shape.
 * Returns the parsed value if valid, or undefined + a warning if not.
 */
function validateField(
	key: string,
	value: unknown,
): { ok: true; value: unknown } | { ok: false } {
	const fieldSchema =
		SandcasterConfigSchema.shape[
			key as keyof typeof SandcasterConfigSchema.shape
		];
	if (!fieldSchema) {
		return { ok: false };
	}
	const result = fieldSchema.safeParse(value);
	if (result.success) {
		return { ok: true, value: result.data };
	}
	return { ok: false };
}

// ---------------------------------------------------------------------------
// loadConfig
// ---------------------------------------------------------------------------

/**
 * Load `sandcaster.json` from `dir` (defaults to `process.cwd()`).
 *
 * Behaviour:
 * - Returns null (silently) when the file is absent.
 * - Returns null + console.error on invalid JSON or non-object JSON.
 * - Strips unknown fields with console.warn.
 * - Strips invalid-typed known fields with console.warn.
 * - Uses mtime-based module-level caching.
 * - Returns cached value on stat error; clears cache when file is deleted.
 */
export function loadConfig(dir?: string): SandcasterConfig | null {
	const resolvedDir = dir ?? process.cwd();
	const configPath = join(resolvedDir, CONFIG_FILE);

	// ── stat the file ──────────────────────────────────────────────────────────
	let mtime: number;
	try {
		const st = statSync(configPath);
		mtime = st.mtimeMs;
	} catch (err: unknown) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			// File gone — clear cache
			if (_cacheDir === resolvedDir) {
				_configCache = null;
				_configMtime = 0;
				_cacheDir = null;
			}
			return null;
		}
		// Other stat error — return stale cache if we have one for this dir
		if (_cacheDir === resolvedDir) {
			return _configCache;
		}
		return null;
	}

	// ── cache hit ──────────────────────────────────────────────────────────────
	if (
		_cacheDir === resolvedDir &&
		_configCache !== null &&
		mtime === _configMtime
	) {
		return _configCache;
	}

	// ── read + parse ──────────────────────────────────────────────────────────
	let raw: unknown;
	try {
		const text = readFileSync(configPath, "utf-8");
		raw = JSON.parse(text);
	} catch (err: unknown) {
		console.error(`sandcaster.json: failed to read or parse — ${String(err)}`);
		return null;
	}

	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		console.error(
			`sandcaster.json: expected a JSON object, got ${Array.isArray(raw) ? "array" : typeof raw}`,
		);
		return null;
	}

	// ── strip and validate fields ─────────────────────────────────────────────
	const rawObj = raw as Record<string, unknown>;
	const validated: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(rawObj)) {
		if (!KNOWN_FIELDS.has(key)) {
			console.warn(`sandcaster.json: unknown field "${key}" — ignoring`);
			continue;
		}
		const fieldResult = validateField(key, value);
		if (fieldResult.ok) {
			validated[key] = fieldResult.value;
		} else {
			console.warn(
				`sandcaster.json: field "${key}" has an invalid value — ignoring`,
			);
		}
	}

	// ── final schema parse (should always succeed given field-level validation) ─
	const parsed = SandcasterConfigSchema.safeParse(validated);
	const config = parsed.success ? parsed.data : (validated as SandcasterConfig);

	// ── update cache ──────────────────────────────────────────────────────────
	_configCache = config;
	_configMtime = mtime;
	_cacheDir = resolvedDir;

	return config;
}
