import { createHmac, timingSafeEqual } from "node:crypto";

export const MIN_KEY_LENGTH = 32;

const HMAC_KEY = "sandcaster-safe-compare";

function safeCompare(a: string, b: string): boolean {
	const aHash = createHmac("sha256", HMAC_KEY).update(a).digest();
	const bHash = createHmac("sha256", HMAC_KEY).update(b).digest();
	return timingSafeEqual(aHash, bHash);
}

export function validateBearerToken(token: string, keys: string[]): boolean {
	if (token.length === 0) return false;
	if (keys.length === 0) return false;
	return keys.some((key) => safeCompare(token, key));
}

export function validateKeyLength(key: string): boolean {
	return key.length >= MIN_KEY_LENGTH;
}

// Hono's `bearerAuth` validates the bearer token against RFC 6750 §2.1
// `b64token` syntax (`1*( ALPHA / DIGIT / "-" / "." / "_" / "~" / "+" / "/" ) *"="`)
// before invoking the configured verifyToken. Any configured key that fails
// this check causes every request to fail with 400 — the verifyToken
// callback never runs. Validating the configured key against the same regex
// at startup converts this silent runtime failure into an early, actionable
// error.
const RFC_6750_TOKEN_REGEX = /^[A-Za-z0-9._~+/-]+=*$/;

export function validateKeyFormat(key: string): boolean {
	return RFC_6750_TOKEN_REGEX.test(key);
}
