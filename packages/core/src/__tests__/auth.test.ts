import { describe, expect, it } from "vitest";
import {
	MIN_KEY_LENGTH,
	validateBearerToken,
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
