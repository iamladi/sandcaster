import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ChatConfigSchema, resolveChatConfig } from "../config.js";

describe("ChatConfigSchema", () => {
	test("parses valid config with all platforms", () => {
		const result = ChatConfigSchema.safeParse({
			slack: {
				botToken: "xoxb-test",
				appToken: "xapp-test",
				signingSecret: "secret",
			},
			discord: {
				botToken: "discord-token",
				publicKey: "discord-pubkey",
			},
			telegram: {
				botToken: "tg-token",
			},
			sessionTimeoutMs: 60_000,
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.slack?.botToken).toBe("xoxb-test");
			expect(result.data.discord?.botToken).toBe("discord-token");
			expect(result.data.telegram?.botToken).toBe("tg-token");
			expect(result.data.sessionTimeoutMs).toBe(60_000);
		}
	});

	test("parses config with only Slack", () => {
		const result = ChatConfigSchema.safeParse({
			slack: {
				botToken: "xoxb-test",
				appToken: "xapp-test",
				signingSecret: "secret",
			},
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.slack).toBeDefined();
			expect(result.data.discord).toBeUndefined();
			expect(result.data.telegram).toBeUndefined();
		}
	});

	test("applies default sessionTimeoutMs", () => {
		const result = ChatConfigSchema.safeParse({
			slack: {
				botToken: "xoxb-test",
				appToken: "xapp-test",
				signingSecret: "secret",
			},
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.sessionTimeoutMs).toBe(600_000);
		}
	});

	test("rejects empty config (no platforms)", () => {
		const result = ChatConfigSchema.safeParse({});
		expect(result.success).toBe(true);
		// Empty config is valid — no platforms configured
	});

	test("rejects invalid sessionTimeoutMs", () => {
		const result = ChatConfigSchema.safeParse({
			sessionTimeoutMs: -1,
		});
		expect(result.success).toBe(false);
	});

	test("parses access control config", () => {
		const result = ChatConfigSchema.safeParse({
			slack: {
				botToken: "xoxb-test",
				appToken: "xapp-test",
				signingSecret: "secret",
			},
			allowedChannels: ["C123", "C456"],
			allowedUsers: ["U789"],
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.allowedChannels).toEqual(["C123", "C456"]);
			expect(result.data.allowedUsers).toEqual(["U789"]);
		}
	});

	test("missing Slack botToken is rejected", () => {
		const result = ChatConfigSchema.safeParse({
			slack: {
				appToken: "xapp-test",
				signingSecret: "secret",
			},
		});
		expect(result.success).toBe(false);
	});
});

describe("resolveChatConfig", () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		// Clear all chat-related env vars
		for (const key of Object.keys(process.env)) {
			if (
				key.startsWith("SLACK_") ||
				key.startsWith("DISCORD_") ||
				key.startsWith("TELEGRAM_") ||
				key.startsWith("SANDCASTER_CHAT_")
			) {
				delete process.env[key];
			}
		}
	});

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	test("resolves config from env vars when no explicit config", () => {
		process.env.SLACK_BOT_TOKEN = "xoxb-env";
		process.env.SLACK_APP_TOKEN = "xapp-env";
		process.env.SLACK_SIGNING_SECRET = "secret-env";

		const config = resolveChatConfig({});
		expect(config.slack?.botToken).toBe("xoxb-env");
		expect(config.slack?.appToken).toBe("xapp-env");
		expect(config.slack?.signingSecret).toBe("secret-env");
	});

	test("explicit config takes precedence over env vars", () => {
		process.env.SLACK_BOT_TOKEN = "xoxb-env";
		process.env.SLACK_APP_TOKEN = "xapp-env";
		process.env.SLACK_SIGNING_SECRET = "secret-env";

		const config = resolveChatConfig({
			slack: {
				botToken: "xoxb-explicit",
				appToken: "xapp-explicit",
				signingSecret: "secret-explicit",
			},
		});
		expect(config.slack?.botToken).toBe("xoxb-explicit");
	});

	test("resolves Discord from env vars", () => {
		process.env.DISCORD_BOT_TOKEN = "discord-env";
		process.env.DISCORD_PUBLIC_KEY = "pubkey-env";

		const config = resolveChatConfig({});
		expect(config.discord?.botToken).toBe("discord-env");
		expect(config.discord?.publicKey).toBe("pubkey-env");
	});

	test("resolves Telegram from env vars", () => {
		process.env.TELEGRAM_BOT_TOKEN = "tg-env";

		const config = resolveChatConfig({});
		expect(config.telegram?.botToken).toBe("tg-env");
	});

	test("resolves sessionTimeoutMs from env var", () => {
		process.env.SANDCASTER_CHAT_SESSION_TIMEOUT_MS = "120000";

		const config = resolveChatConfig({});
		expect(config.sessionTimeoutMs).toBe(120_000);
	});

	test("returns no platforms when no env vars or config", () => {
		const config = resolveChatConfig({});
		expect(config.slack).toBeUndefined();
		expect(config.discord).toBeUndefined();
		expect(config.telegram).toBeUndefined();
	});

	test("partial env vars for a platform are ignored", () => {
		// Only botToken without appToken and signingSecret — insufficient for Slack
		process.env.SLACK_BOT_TOKEN = "xoxb-partial";

		const config = resolveChatConfig({});
		// Slack requires all three tokens
		expect(config.slack).toBeUndefined();
	});
});
