import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatDeps } from "../commands/chat.js";
import { executeChat } from "../commands/chat.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBot() {
	return {
		initialize: vi.fn().mockResolvedValue(undefined),
		shutdown: vi.fn().mockResolvedValue(undefined),
	};
}

function makePool() {
	return {
		removeBySessionId: vi.fn(),
	};
}

function makeSessionManager() {
	return {
		shutdown: vi.fn().mockResolvedValue(undefined),
	};
}

function makeDeps(overrides: Partial<ChatDeps> = {}): ChatDeps {
	const bot = makeBot();
	const pool = makePool();
	const sm = makeSessionManager();

	const defaultChatConfig = {
		slack: { botToken: "xoxb-1", appToken: "xapp-1", signingSecret: "s1" },
		sessionTimeoutMs: 600_000,
	};

	return {
		loadConfig: vi.fn().mockReturnValue({ sandboxProvider: "e2b" }),
		resolveChatConfig: vi.fn().mockReturnValue(defaultChatConfig),
		createChatBot: vi.fn().mockReturnValue({ bot, pool }),
		createSessionManager: vi.fn().mockReturnValue(sm),
		sandboxFactory: vi.fn(),
		runAgent: vi.fn(),
		stdout: { write: vi.fn().mockReturnValue(true) },
		exit: vi.fn(),
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Signal listener capture helpers
// ---------------------------------------------------------------------------

let sigtermListeners: Array<() => void> = [];
let sigintListeners: Array<() => void> = [];

beforeEach(() => {
	sigtermListeners = [];
	sigintListeners = [];

	vi.spyOn(process, "on").mockImplementation(
		(event: string | symbol, listener: (...args: unknown[]) => void) => {
			if (event === "SIGTERM") sigtermListeners.push(listener as () => void);
			if (event === "SIGINT") sigintListeners.push(listener as () => void);
			return process;
		},
	);
});

afterEach(() => {
	vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("executeChat", () => {
	it("loads config and resolves chat config", async () => {
		const deps = makeDeps();
		await executeChat({}, deps);

		expect(deps.loadConfig).toHaveBeenCalledOnce();
		expect(deps.resolveChatConfig).toHaveBeenCalledOnce();
	});

	it("calls resolveChatConfig with the chat section of the loaded config", async () => {
		const deps = makeDeps({
			loadConfig: vi.fn().mockReturnValue({
				sandboxProvider: "e2b",
				chat: { botName: "mybot" },
			}),
		});
		await executeChat({}, deps);

		expect(deps.resolveChatConfig).toHaveBeenCalledWith({ botName: "mybot" });
	});

	it("errors when no platforms configured", async () => {
		const deps = makeDeps({
			resolveChatConfig: vi.fn().mockReturnValue({
				sessionTimeoutMs: 600_000,
				// no slack, discord, telegram
			}),
		});
		await executeChat({}, deps);

		expect(deps.stdout.write).toHaveBeenCalledWith(
			expect.stringContaining("No chat platforms"),
		);
		expect(deps.exit).toHaveBeenCalledWith(1);
		expect(deps.createChatBot).not.toHaveBeenCalled();
	});

	it("creates SessionManager with sandboxFactory and runAgent", async () => {
		const deps = makeDeps();
		await executeChat({}, deps);

		expect(deps.createSessionManager).toHaveBeenCalledWith(
			expect.objectContaining({
				sandboxFactory: deps.sandboxFactory,
				runAgent: deps.runAgent,
			}),
		);
	});

	it("creates SessionManager with onSessionExpired callback that delegates to pool", async () => {
		const deps = makeDeps();
		await executeChat({}, deps);

		const smOpts = (deps.createSessionManager as ReturnType<typeof vi.fn>).mock
			.calls[0][0];
		expect(typeof smOpts.onSessionExpired).toBe("function");

		// Call the callback and verify it calls pool.removeBySessionId
		const pool = (deps.createChatBot as ReturnType<typeof vi.fn>).mock
			.results[0].value.pool;
		smOpts.onSessionExpired("sess_123");
		expect(pool.removeBySessionId).toHaveBeenCalledWith("sess_123");
	});

	it("creates chat bot with sessionManager, config, and chatConfig", async () => {
		const config = { sandboxProvider: "e2b" as const };
		const chatConfig = {
			slack: { botToken: "xoxb-1", appToken: "xapp-1", signingSecret: "s1" },
			sessionTimeoutMs: 600_000,
		};
		const deps = makeDeps({
			loadConfig: vi.fn().mockReturnValue(config),
			resolveChatConfig: vi.fn().mockReturnValue(chatConfig),
		});
		const sm = makeSessionManager();
		deps.createSessionManager = vi.fn().mockReturnValue(sm);

		await executeChat({}, deps);

		expect(deps.createChatBot).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionManager: sm,
				config,
				chatConfig,
			}),
		);
	});

	it("initializes the bot", async () => {
		const deps = makeDeps();
		await executeChat({}, deps);

		const { bot } = (deps.createChatBot as ReturnType<typeof vi.fn>).mock
			.results[0].value;
		expect(bot.initialize).toHaveBeenCalledOnce();
	});

	it("logs Slack as active platform when slack is configured", async () => {
		const deps = makeDeps({
			resolveChatConfig: vi.fn().mockReturnValue({
				slack: { botToken: "x", appToken: "y", signingSecret: "z" },
				sessionTimeoutMs: 600_000,
			}),
		});
		await executeChat({}, deps);

		expect(deps.stdout.write).toHaveBeenCalledWith(
			expect.stringContaining("Slack"),
		);
	});

	it("logs Discord as active platform when discord is configured", async () => {
		const deps = makeDeps({
			resolveChatConfig: vi.fn().mockReturnValue({
				discord: { botToken: "x", publicKey: "y" },
				sessionTimeoutMs: 600_000,
			}),
		});
		await executeChat({}, deps);

		expect(deps.stdout.write).toHaveBeenCalledWith(
			expect.stringContaining("Discord"),
		);
	});

	it("logs Telegram as active platform when telegram is configured", async () => {
		const deps = makeDeps({
			resolveChatConfig: vi.fn().mockReturnValue({
				telegram: { botToken: "x" },
				sessionTimeoutMs: 600_000,
			}),
		});
		await executeChat({}, deps);

		expect(deps.stdout.write).toHaveBeenCalledWith(
			expect.stringContaining("Telegram"),
		);
	});

	it("logs all three platforms when all are configured", async () => {
		const deps = makeDeps({
			resolveChatConfig: vi.fn().mockReturnValue({
				slack: { botToken: "x", appToken: "y", signingSecret: "z" },
				discord: { botToken: "x", publicKey: "y" },
				telegram: { botToken: "x" },
				sessionTimeoutMs: 600_000,
			}),
		});
		await executeChat({}, deps);

		const written = (deps.stdout.write as ReturnType<typeof vi.fn>).mock.calls
			.map((c: unknown[]) => c[0])
			.join("");
		expect(written).toContain("Slack");
		expect(written).toContain("Discord");
		expect(written).toContain("Telegram");
	});

	it("registers SIGTERM handler that calls bot.shutdown and sessionManager.shutdown then exits", async () => {
		const deps = makeDeps();
		await executeChat({}, deps);

		const { bot } = (deps.createChatBot as ReturnType<typeof vi.fn>).mock
			.results[0].value;
		const sm = (deps.createSessionManager as ReturnType<typeof vi.fn>).mock
			.results[0].value;

		expect(sigtermListeners).toHaveLength(1);
		await sigtermListeners[0]();

		expect(bot.shutdown).toHaveBeenCalledOnce();
		expect(sm.shutdown).toHaveBeenCalledOnce();
		expect(deps.exit).toHaveBeenCalledWith(0);
	});

	it("registers SIGINT handler that calls bot.shutdown and sessionManager.shutdown then exits", async () => {
		const deps = makeDeps();
		await executeChat({}, deps);

		const { bot } = (deps.createChatBot as ReturnType<typeof vi.fn>).mock
			.results[0].value;
		const sm = (deps.createSessionManager as ReturnType<typeof vi.fn>).mock
			.results[0].value;

		expect(sigintListeners).toHaveLength(1);
		await sigintListeners[0]();

		expect(bot.shutdown).toHaveBeenCalledOnce();
		expect(sm.shutdown).toHaveBeenCalledOnce();
		expect(deps.exit).toHaveBeenCalledWith(0);
	});

	it("writes shutdown message before shutting down on SIGTERM", async () => {
		const deps = makeDeps();
		await executeChat({}, deps);

		await sigtermListeners[0]();

		expect(deps.stdout.write).toHaveBeenCalledWith(
			expect.stringContaining("Shutting down"),
		);
	});
});
