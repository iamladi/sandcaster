import { describe, expect, test } from "vitest";
import type { ThreadMessage } from "../thread-context.js";
import { buildThreadContext } from "../thread-context.js";

describe("buildThreadContext", () => {
	test("returns empty string for empty array", () => {
		expect(buildThreadContext([])).toBe("");
	});

	test("formats single user message correctly", () => {
		const messages: ThreadMessage[] = [
			{ authorName: "Alice", text: "Hello there", isBot: false },
		];
		const result = buildThreadContext(messages);
		expect(result).toBe("Previous conversation:\n[Alice] Hello there");
	});

	test("formats single bot message with default label", () => {
		const messages: ThreadMessage[] = [
			{ authorName: "Mybot", text: "I can help.", isBot: true },
		];
		const result = buildThreadContext(messages);
		expect(result).toBe("Previous conversation:\n[Bot] I can help.");
	});

	test("formats single bot message with custom botName", () => {
		const messages: ThreadMessage[] = [
			{ authorName: "Mybot", text: "I can help.", isBot: true },
		];
		const result = buildThreadContext(messages, "Sandcaster");
		expect(result).toBe("Previous conversation:\n[Sandcaster] I can help.");
	});

	test("formats multi-message thread preserving order", () => {
		const messages: ThreadMessage[] = [
			{ authorName: "Alice", text: "What's the weather?", isBot: false },
			{ authorName: "Bot", text: "It's sunny today.", isBot: true },
			{ authorName: "Bob", text: "Thanks!", isBot: false },
		];
		const result = buildThreadContext(messages, "Bot");
		expect(result).toBe(
			"Previous conversation:\n[Alice] What's the weather?\n[Bot] It's sunny today.\n[Bob] Thanks!",
		);
	});

	test("includes 'Previous conversation:' header", () => {
		const messages: ThreadMessage[] = [
			{ authorName: "Alice", text: "Hello", isBot: false },
		];
		expect(buildThreadContext(messages)).toMatch(/^Previous conversation:\n/);
	});

	test("truncates to last 20 messages with omission prefix", () => {
		const messages: ThreadMessage[] = Array.from({ length: 25 }, (_, i) => ({
			authorName: "User",
			text: `Message ${String(i + 1).padStart(3, "0")}`,
			isBot: false,
		}));
		const result = buildThreadContext(messages);
		expect(result).toContain("[... 5 earlier messages omitted]");
		expect(result).toContain("[User] Message 025");
		expect(result).not.toContain("[User] Message 001");
		expect(result).not.toContain("[User] Message 005");
		expect(result).toContain("[User] Message 006");
	});

	test("does not add omission prefix when messages fit within 20", () => {
		const messages: ThreadMessage[] = Array.from({ length: 20 }, (_, i) => ({
			authorName: "User",
			text: `Message ${i + 1}`,
			isBot: false,
		}));
		const result = buildThreadContext(messages);
		expect(result).not.toContain("omitted");
		expect(result).toContain("[User] Message 1");
		expect(result).toContain("[User] Message 20");
	});

	test("truncates at 4000 character limit", () => {
		// Each message is ~50 chars: "[User] " (7) + 43 chars of text + "\n" (1) = ~51 chars
		// To exceed 4000 chars with <20 messages, use long messages
		const longText = "x".repeat(300);
		const messages: ThreadMessage[] = Array.from({ length: 15 }, (_, i) => ({
			authorName: "User",
			text: `${longText}${i}`,
			isBot: false,
		}));
		const result = buildThreadContext(messages);
		expect(result.length).toBeLessThanOrEqual(
			4000 +
				"[... 10 earlier messages omitted]\n".length +
				"Previous conversation:\n".length,
		);
		expect(result).toContain("[... ");
		expect(result).toContain("omitted]");
	});

	test("handles messages that are exactly at the 20-message limit", () => {
		const messages: ThreadMessage[] = Array.from({ length: 20 }, (_, i) => ({
			authorName: "Alice",
			text: `msg${i}`,
			isBot: false,
		}));
		const result = buildThreadContext(messages);
		expect(result).not.toContain("omitted");
		expect(result).toContain("[Alice] msg0");
		expect(result).toContain("[Alice] msg19");
	});
});
