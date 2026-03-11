import { timingSafeEqual } from "node:crypto";

export const MIN_KEY_LENGTH = 32;

function safeCompare(a: string, b: string): boolean {
	const aBuf = Buffer.from(a, "utf8");
	const bBuf = Buffer.from(b, "utf8");
	if (aBuf.length !== bBuf.length) return false;
	return timingSafeEqual(aBuf, bBuf);
}

export function validateBearerToken(token: string, keys: string[]): boolean {
	if (token.length === 0) return false;
	if (keys.length === 0) return false;
	return keys.some((key) => safeCompare(token, key));
}

export function validateKeyLength(key: string): boolean {
	return key.length >= MIN_KEY_LENGTH;
}
