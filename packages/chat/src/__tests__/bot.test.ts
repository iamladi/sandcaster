import type { SandcasterConfig, SessionManager } from "@sandcaster/core";
import {
	beforeEach,
	describe,
	expect,
	type MockInstance,
	test,
	vi,
} from "vitest";
import { createChatBot } from "../bot.js";
import type { ChatConfig } from "../config.js";

// ---------------------------------------------------------------------------
// External mocks (system boundaries)
// ---------------------------------------------------------------------------

vi.mock("chat", () => {
	// biome-ignore lint: must be regular function for `new` support
	const ChatMock = vi.fn(function ChatCtor(this: {
		onNewMention: ReturnType<typeof vi.fn>;
		onSubscribedMessage: ReturnType<typeof vi.fn>;
		initialize: ReturnType<typeof vi.fn>;
		shutdown: ReturnType<typeof vi.fn>;
		webhooks: Record<string, unknown>;
	}) {
		this.onNewMention = vi.fn();
		this.onSubscribedMessage = vi.fn();
		this.initialize = vi.fn();
		this.shutdown = vi.fn();
		this.webhooks = {};
	});
	return { Chat: ChatMock };
});

vi.mock("@chat-adapter/slack", () => ({
	createSlackAdapter: vi.fn(() => ({ name: "slack" })),
}));

vi.mock("@chat-adapter/discord", () => ({
	createDiscordAdapter: vi.fn(() => ({ name: "discord" })),
}));

vi.mock("@chat-adapter/telegram", () => ({
	createTelegramAdapter: vi.fn(() => ({ name: "telegram" })),
}));

vi.mock("@chat-adapter/state-memory", () => ({
	createMemoryState: vi.fn(() => ({})),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockThread(
	overrides?: Partial<{
		id: string;
		channelId: string;
		adapter: { name: string };
		allMessages: AsyncIterable<MockMessage>;
		subscribe: MockInstance;
		post: MockInstance;
	}>,
) {
	return {
		id: "thread-1",
		channelId: "C123",
		adapter: { name: "slack" },
		allMessages: (async function* () {})(),
		subscribe: vi.fn().mockResolvedValue(undefined),
		post: vi.fn().mockResolvedValue({ id: "sent-1" }),
		...overrides,
	};
}

interface MockAuthor {
	userId: string;
	fullName: string;
	userName: string;
	isBot: boolean | "unknown";
	isMe: boolean;
}

interface MockMessage {
	id: string;
	text: string;
	author: MockAuthor;
	isMention?: boolean;
}

function createMockMessage(overrides?: Partial<MockMessage>): MockMessage {
	return {
		id: "msg-1",
		text: "Hello agent!",
		author: {
			userId: "U123",
			fullName: "Alice",
			userName: "alice",
			isBot: false,
			isMe: false,
		},
		isMention: true,
		...overrides,
	};
}

async function* makeEvents(deltas: string[]) {
	for (const delta of deltas) {
		yield {
			type: "assistant" as const,
			subtype: "delta" as const,
			content: delta,
		};
	}
	yield {
		type: "result" as const,
		content: "done",
		costUsd: 0.001,
		numTurns: 1,
		durationSecs: 1,
	};
}

function makeMockSessionManager(
	eventsGen?: AsyncGenerator<{
		type: string;
		subtype?: string;
		content: string;
		[k: string]: unknown;
	}>,
) {
	const events = eventsGen ?? makeEvents(["Hello!"]);
	return {
		createSession: vi.fn().mockResolvedValue({ sessionId: "sess-1", events }),
		sendMessage: vi.fn().mockResolvedValue(makeEvents(["Response!"])),
		shutdown: vi.fn().mockResolvedValue(undefined),
	} as unknown as SessionManager;
}

function makeOptions(chatConfigOverrides?: Partial<ChatConfig>): {
	sessionManager: SessionManager;
	config: SandcasterConfig;
	chatConfig: ChatConfig;
} {
	return {
		sessionManager: makeMockSessionManager(),
		config: {} as SandcasterConfig,
		chatConfig: {
			slack: {
				botToken: "xoxb-test",
				appToken: "xapp-test",
				signingSecret: "secret",
			},
			sessionTimeoutMs: 600_000,
			...chatConfigOverrides,
		},
	};
}

// Extract captured handlers from the mocked Chat instance
function getCapturedHandlers(ChatMock: ReturnType<typeof vi.fn>) {
	const instance = ChatMock.mock.results[0]?.value;
	if (!instance) throw new Error("Chat not instantiated");

	let mentionHandler:
		| ((
				thread: ReturnType<typeof createMockThread>,
				message: MockMessage,
		  ) => Promise<void>)
		| undefined;
	let subscribedHandler:
		| ((
				thread: ReturnType<typeof createMockThread>,
				message: MockMessage,
		  ) => Promise<void>)
		| undefined;

	for (const call of (instance.onNewMention as MockInstance).mock.calls) {
		mentionHandler = call[0];
	}
	for (const call of (instance.onSubscribedMessage as MockInstance).mock
		.calls) {
		subscribedHandler = call[0];
	}

	if (!mentionHandler) throw new Error("onNewMention handler not registered");
	if (!subscribedHandler)
		throw new Error("onSubscribedMessage handler not registered");

	return { mentionHandler, subscribedHandler };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createChatBot", () => {
	let Chat: ReturnType<typeof vi.fn>;
	let createSlackAdapter: MockInstance;
	let createDiscordAdapter: MockInstance;
	let createTelegramAdapter: MockInstance;

	beforeEach(async () => {
		vi.clearAllMocks();
		const chatMod = await import("chat");
		Chat = chatMod.Chat as ReturnType<typeof vi.fn>;
		const slackMod = await import("@chat-adapter/slack");
		createSlackAdapter = slackMod.createSlackAdapter as unknown as MockInstance;
		const discordMod = await import("@chat-adapter/discord");
		createDiscordAdapter =
			discordMod.createDiscordAdapter as unknown as MockInstance;
		const telegramMod = await import("@chat-adapter/telegram");
		createTelegramAdapter =
			telegramMod.createTelegramAdapter as unknown as MockInstance;
	});

	// -------------------------------------------------------------------------
	// Adapter wiring
	// -------------------------------------------------------------------------

	describe("adapter wiring", () => {
		test("creates Chat instance with Slack adapter when slack config present", () => {
			const opts = makeOptions({
				slack: { botToken: "xoxb", appToken: "xapp", signingSecret: "sig" },
			});
			createChatBot(opts);

			expect(createSlackAdapter).toHaveBeenCalledOnce();
			expect(Chat).toHaveBeenCalledOnce();
			const chatCallArgs = Chat.mock.calls[0][0];
			expect(chatCallArgs.adapters).toHaveProperty("slack");
		});

		test("creates Chat instance with no adapters when no platform config", () => {
			const opts = makeOptions({ slack: undefined });
			createChatBot(opts);

			expect(createSlackAdapter).not.toHaveBeenCalled();
			expect(createDiscordAdapter).not.toHaveBeenCalled();
			expect(createTelegramAdapter).not.toHaveBeenCalled();
			const chatCallArgs = Chat.mock.calls[0][0];
			expect(chatCallArgs.adapters).toEqual({});
		});

		test("creates Chat instance with Discord adapter when discord config present", () => {
			const opts = makeOptions({
				slack: undefined,
				discord: { botToken: "dbot", publicKey: "pubkey" },
			});
			createChatBot(opts);

			expect(createDiscordAdapter).toHaveBeenCalledOnce();
			const chatCallArgs = Chat.mock.calls[0][0];
			expect(chatCallArgs.adapters).toHaveProperty("discord");
		});

		test("creates Chat instance with Telegram adapter when telegram config present", () => {
			const opts = makeOptions({
				slack: undefined,
				telegram: { botToken: "tbot" },
			});
			createChatBot(opts);

			expect(createTelegramAdapter).toHaveBeenCalledOnce();
			const chatCallArgs = Chat.mock.calls[0][0];
			expect(chatCallArgs.adapters).toHaveProperty("telegram");
		});
	});

	// -------------------------------------------------------------------------
	// Return value
	// -------------------------------------------------------------------------

	describe("return value", () => {
		test("returns bot and pool", () => {
			const result = createChatBot(makeOptions());
			expect(result).toHaveProperty("bot");
			expect(result).toHaveProperty("pool");
		});
	});

	// -------------------------------------------------------------------------
	// onNewMention handler
	// -------------------------------------------------------------------------

	describe("onNewMention handler", () => {
		test("creates session and streams response to thread", async () => {
			const sessionManager = makeMockSessionManager(
				makeEvents(["Hi", " there"]),
			);
			const opts = { ...makeOptions(), sessionManager };
			createChatBot(opts);

			const { mentionHandler } = getCapturedHandlers(Chat);
			const thread = createMockThread();
			const message = createMockMessage();

			await mentionHandler(thread, message);

			expect(sessionManager.createSession).toHaveBeenCalledWith(
				expect.objectContaining({ prompt: "Hello agent!" }),
				expect.anything(),
			);
			expect(thread.post).toHaveBeenCalledOnce();
		});

		test("subscribes to thread on new mention", async () => {
			createChatBot(makeOptions());
			const { mentionHandler } = getCapturedHandlers(Chat);
			const thread = createMockThread();

			await mentionHandler(thread, createMockMessage());

			expect(thread.subscribe).toHaveBeenCalledOnce();
		});

		test("registers session in pool after creation", async () => {
			const opts = makeOptions();
			const { pool } = createChatBot(opts);
			const { mentionHandler } = getCapturedHandlers(Chat);
			const thread = createMockThread();

			await mentionHandler(thread, createMockMessage());

			const threadKey = `slack:${thread.channelId}:${thread.id}`;
			expect(pool.resolve(threadKey)).toBe("sess-1");
		});

		test("posts error to thread when session creation fails", async () => {
			const sessionManager = {
				createSession: vi.fn().mockRejectedValue(new Error("sandbox failed")),
				sendMessage: vi.fn(),
				shutdown: vi.fn(),
			} as unknown as SessionManager;
			const opts = { ...makeOptions(), sessionManager };
			createChatBot(opts);

			const { mentionHandler } = getCapturedHandlers(Chat);
			const thread = createMockThread();

			// Should not throw
			await expect(
				mentionHandler(thread, createMockMessage()),
			).resolves.not.toThrow();
			expect(thread.post).toHaveBeenCalledWith(
				expect.stringContaining("sandbox failed"),
			);
		});
	});

	// -------------------------------------------------------------------------
	// onSubscribedMessage handler
	// -------------------------------------------------------------------------

	describe("onSubscribedMessage handler", () => {
		test("sends message to existing session and streams response", async () => {
			const sessionManager = makeMockSessionManager();
			const opts = { ...makeOptions(), sessionManager };
			const { pool } = createChatBot(opts);

			// Pre-register a session
			const thread = createMockThread();
			const threadKey = `slack:${thread.channelId}:${thread.id}`;
			pool.register(threadKey, "existing-session");

			const { subscribedHandler } = getCapturedHandlers(Chat);
			const message = createMockMessage({ id: "msg-sub-1", text: "follow-up" });

			await subscribedHandler(thread, message);

			expect(sessionManager.sendMessage).toHaveBeenCalledWith(
				"existing-session",
				expect.objectContaining({ prompt: "follow-up" }),
			);
			expect(thread.post).toHaveBeenCalledOnce();
		});

		test("creates new session with thread context on re-engagement (expired session)", async () => {
			const sessionManager = makeMockSessionManager();
			const opts = { ...makeOptions(), sessionManager };
			createChatBot(opts);

			// No session registered → re-engagement flow
			const previousMessages = [
				{
					id: "prev-1",
					text: "first message",
					author: {
						userId: "U1",
						fullName: "Alice",
						userName: "alice",
						isBot: false,
						isMe: false,
					},
				},
				{
					id: "prev-2",
					text: "bot reply",
					author: {
						userId: "B1",
						fullName: "Sandcaster",
						userName: "sandcaster",
						isBot: true,
						isMe: true,
					},
				},
			];
			const thread = createMockThread({
				allMessages: (async function* () {
					for (const m of previousMessages) yield m;
				})(),
			});

			const { subscribedHandler } = getCapturedHandlers(Chat);
			const message = createMockMessage({
				id: "msg-re-1",
				text: "continuing chat",
			});

			await subscribedHandler(thread, message);

			// createSession should be called (re-engagement path)
			expect(sessionManager.createSession).toHaveBeenCalledOnce();
			const createArgs = (sessionManager.createSession as MockInstance).mock
				.calls[0][0];
			// Context should include "Previous conversation:" header
			expect(createArgs.prompt).toContain("Previous conversation:");
			expect(createArgs.prompt).toContain("continuing chat");
		});

		test("re-registers new session in pool after re-engagement", async () => {
			const sessionManager = makeMockSessionManager();
			const opts = { ...makeOptions(), sessionManager };
			const { pool } = createChatBot(opts);

			const thread = createMockThread();
			const threadKey = `slack:${thread.channelId}:${thread.id}`;

			const { subscribedHandler } = getCapturedHandlers(Chat);
			await subscribedHandler(
				thread,
				createMockMessage({ id: "msg-re-2", text: "hi" }),
			);

			expect(pool.resolve(threadKey)).toBe("sess-1");
		});
	});

	// -------------------------------------------------------------------------
	// Access control (FR-5a)
	// -------------------------------------------------------------------------

	describe("access control", () => {
		test("rejects unauthorized channel silently", async () => {
			const sessionManager = makeMockSessionManager();
			const opts = {
				...makeOptions({ allowedChannels: ["C-ALLOWED"] }),
				sessionManager,
			};
			createChatBot(opts);

			const { mentionHandler } = getCapturedHandlers(Chat);
			const thread = createMockThread({ channelId: "C-BLOCKED" });

			await mentionHandler(thread, createMockMessage());

			expect(sessionManager.createSession).not.toHaveBeenCalled();
			expect(thread.post).not.toHaveBeenCalled();
		});

		test("rejects unauthorized user silently", async () => {
			const sessionManager = makeMockSessionManager();
			const opts = {
				...makeOptions({ allowedUsers: ["U-ALLOWED"] }),
				sessionManager,
			};
			createChatBot(opts);

			const { mentionHandler } = getCapturedHandlers(Chat);
			const thread = createMockThread();
			const message = createMockMessage({
				author: {
					userId: "U-BLOCKED",
					fullName: "Eve",
					userName: "eve",
					isBot: false,
					isMe: false,
				},
			});

			await mentionHandler(thread, message);

			expect(sessionManager.createSession).not.toHaveBeenCalled();
			expect(thread.post).not.toHaveBeenCalled();
		});

		test("allows all when no allowlist configured", async () => {
			const sessionManager = makeMockSessionManager();
			const opts = {
				...makeOptions({ allowedChannels: undefined, allowedUsers: undefined }),
				sessionManager,
			};
			createChatBot(opts);

			const { mentionHandler } = getCapturedHandlers(Chat);
			await mentionHandler(createMockThread(), createMockMessage());

			expect(sessionManager.createSession).toHaveBeenCalledOnce();
		});
	});

	// -------------------------------------------------------------------------
	// Deduplication (FR-5)
	// -------------------------------------------------------------------------

	describe("deduplication", () => {
		test("rejects duplicate message IDs silently", async () => {
			const sessionManager = makeMockSessionManager();
			const opts = { ...makeOptions(), sessionManager };
			createChatBot(opts);

			const { mentionHandler } = getCapturedHandlers(Chat);
			const thread = createMockThread();
			const message = createMockMessage({ id: "dup-msg-1" });

			// First call should succeed
			await mentionHandler(thread, message);
			expect(sessionManager.createSession).toHaveBeenCalledOnce();

			// Second call with same message ID should be silently ignored
			const thread2 = createMockThread({ id: "thread-2" });
			await mentionHandler(thread2, message);
			expect(sessionManager.createSession).toHaveBeenCalledOnce(); // still once
		});
	});
});
