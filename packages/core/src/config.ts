import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { z } from "zod";
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
 * Unwrap ZodOptional to get the inner schema (Zod v4 introspection).
 */
function unwrapOptional(schema: z.ZodTypeAny): z.ZodTypeAny {
	// biome-ignore lint/suspicious/noExplicitAny: Zod v4 internal introspection
	const def = (schema as any)._zod?.def;
	if (def?.type === "optional") {
		return def.innerType;
	}
	return schema;
}

/**
 * If the schema is an object type, return its shape. Otherwise null.
 */
function getObjectShape(
	schema: z.ZodTypeAny,
): Record<string, z.ZodTypeAny> | null {
	// biome-ignore lint/suspicious/noExplicitAny: Zod v4 internal introspection
	const def = (schema as any)._zod?.def;
	if (def?.type === "object" && "shape" in schema) {
		return (schema as unknown as { shape: Record<string, z.ZodTypeAny> }).shape;
	}
	return null;
}

/**
 * Validates a single field value against its Zod schema shape.
 * For nested object fields, validates sub-fields individually so one invalid
 * sub-field doesn't discard valid siblings.
 */
function validateField(
	key: string,
	value: unknown,
): { ok: true; value: unknown } | { ok: false; reason: string } {
	const fieldSchema =
		SandcasterConfigSchema.shape[
			key as keyof typeof SandcasterConfigSchema.shape
		];
	if (!fieldSchema) {
		return { ok: false, reason: "unknown field" };
	}
	const result = fieldSchema.safeParse(value);
	if (result.success) {
		return { ok: true, value: result.data };
	}

	// For nested objects, try partial validation of sub-fields
	const inner = unwrapOptional(fieldSchema);
	const shape = getObjectShape(inner);
	if (
		shape &&
		value !== null &&
		typeof value === "object" &&
		!Array.isArray(value)
	) {
		const partial: Record<string, unknown> = {};
		for (const [subKey, subValue] of Object.entries(
			value as Record<string, unknown>,
		)) {
			const subSchema = shape[subKey];
			if (!subSchema) {
				console.warn(
					`sandcaster.json: field "${key}.${subKey}" unknown — ignoring`,
				);
				continue;
			}
			const subResult = subSchema.safeParse(subValue);
			if (subResult.success) {
				partial[subKey] = subResult.data;
			} else {
				const reason = subResult.error.issues[0]?.message ?? "invalid value";
				console.warn(
					`sandcaster.json: field "${key}.${subKey}" invalid (${reason}) — ignoring`,
				);
			}
		}
		// Re-parse the partial object so defaults fill in
		const reparsed = fieldSchema.safeParse(partial);
		if (reparsed.success) {
			return { ok: true, value: reparsed.data };
		}
	}

	const reason = result.error.issues[0]?.message ?? "invalid value";
	return { ok: false, reason };
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
		if (!fieldResult.ok) {
			console.warn(
				`sandcaster.json: field "${key}" invalid (${fieldResult.reason}) — ignoring`,
			);
			continue;
		}
		validated[key] = fieldResult.value;
	}

	// ── final schema parse ───────────────────────────────────────────────────
	const parsed = SandcasterConfigSchema.safeParse(validated);
	if (!parsed.success) {
		console.error(
			`sandcaster.json: config validation failed — ${parsed.error.message}`,
		);
		return null;
	}

	// ── update cache ──────────────────────────────────────────────────────────
	_configCache = parsed.data;
	_configMtime = mtime;
	_cacheDir = resolvedDir;

	return parsed.data;
}
