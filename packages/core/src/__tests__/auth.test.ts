import { describe, expect, it } from "vitest";
import {
	MIN_KEY_LENGTH,
	validateBearerToken,
	validateKeyFormat,
	validateKeyLength,
} from "../auth.js";

describe("validateBearerToken", () => {
	const validKey = "a".repeat(32);
	const validToken = "a".repeat(32);

	it("returns true for matching token and single key", () => {
		expect(validateBearerToken(validToken, [validKey])).toBe(true);
	});

	it("returns true when token matches second key (key rotation)", () => {
		const firstKey = "b".repeat(32);
		expect(validateBearerToken(validToken, [firstKey, validKey])).toBe(true);
	});

	it("returns false for non-matching token", () => {
		const differentToken = "z".repeat(32);
		expect(validateBearerToken(differentToken, [validKey])).toBe(false);
	});

	it("returns false for empty keys array", () => {
		expect(validateBearerToken(validToken, [])).toBe(false);
	});

	it("returns false for empty token", () => {
		expect(validateBearerToken("", [validKey])).toBe(false);
	});

	it("returns false when token length differs from key length", () => {
		const shortToken = "a".repeat(16);
		expect(validateBearerToken(shortToken, [validKey])).toBe(false);
	});

	it("returns false for different-length tokens without leaking length info (HMAC comparison)", () => {
		// Ensure tokens of varying lengths all correctly reject
		const lengths = [1, 16, 31, 33, 64, 128];
		for (const len of lengths) {
			const token = "x".repeat(len);
			expect(validateBearerToken(token, [validKey])).toBe(false);
		}
	});
});

describe("validateKeyLength", () => {
	it("returns true for key exactly at MIN_KEY_LENGTH", () => {
		expect(validateKeyLength("a".repeat(MIN_KEY_LENGTH))).toBe(true);
	});

	it("returns true for key longer than MIN_KEY_LENGTH", () => {
		expect(validateKeyLength("a".repeat(MIN_KEY_LENGTH + 1))).toBe(true);
	});

	it("returns false for key shorter than MIN_KEY_LENGTH", () => {
		expect(validateKeyLength("a".repeat(MIN_KEY_LENGTH - 1))).toBe(false);
	});

	it("returns false for empty key", () => {
		expect(validateKeyLength("")).toBe(false);
	});
});

describe("MIN_KEY_LENGTH", () => {
	it("is 32", () => {
		expect(MIN_KEY_LENGTH).toBe(32);
	});
});

describe("validateKeyFormat", () => {
	// Hono's bearerAuth applies RFC 6750 §2.1 `b64token` validation
	// (`[A-Za-z0-9._~+/-]+=*`) before invoking verifyToken. Any configured key
	// that fails this check produces a permanent 400 on every request.
	it("accepts RFC 6750 b64token characters", () => {
		expect(validateKeyFormat("a".repeat(32))).toBe(true);
		expect(validateKeyFormat("ABC._~+/-abcDEF0123456789abcdef01")).toBe(true);
		expect(validateKeyFormat(`${"a".repeat(30)}==`)).toBe(true);
	});

	it("rejects characters outside the RFC 6750 b64token set", () => {
		// `]`, `#`, `$`, `@`, space — all forbidden by Hono's bearerAuth regex
		expect(validateKeyFormat("a]d3f5g6h7j8k9l0m1n2o3p4q5r6s7t8")).toBe(false);
		expect(validateKeyFormat(`a${"#".padEnd(31, "a")}`)).toBe(false);
		expect(validateKeyFormat(`a${"$".padEnd(31, "a")}`)).toBe(false);
		expect(validateKeyFormat(`a${"@".padEnd(31, "a")}`)).toBe(false);
		expect(validateKeyFormat(`a${" ".padEnd(31, "a")}`)).toBe(false);
	});

	it("rejects empty string", () => {
		expect(validateKeyFormat("")).toBe(false);
	});
});
