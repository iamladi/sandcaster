import type { SandcasterConfig } from "@sandcaster/core";
import { beforeEach, describe, expect, type Mock, test, vi } from "vitest";
import { createChatBot } from "../bot.js";
import type { ChatConfig } from "../config.js";
import { SessionPool } from "../session-pool.js";

// ---------------------------------------------------------------------------
// External boundary mocks
// ---------------------------------------------------------------------------

vi.mock("chat", () => {
	const Chat = vi.fn(function ChatCtor(this: any) {
		this.onNewMention = vi.fn((handler: any) => {
			this._mentionHandler = handler;
		});
		this.onSubscribedMessage = vi.fn((handler: any) => {
			this._subscribedHandler = handler;
		});
		this.initialize = vi.fn();
		this.shutdown = vi.fn();
		this.webhooks = {};
		return this;
	});
	return { Chat };
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

function createMockThread(overrides?: Partial<any>) {
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

function createMockMessage(overrides?: Partial<any>) {
	return {
		id: `msg-${Math.random().toString(36).slice(2)}`,
		text: "Hello agent",
		author: {
			userId: "U123",
			fullName: "Test User",
			isBot: false,
			userName: "testuser",
			isMe: false,
		},
		...overrides,
	};
}

function createMockSessionManager(overrides?: Partial<any>) {
	const defaultEvents = async function* () {
		yield { type: "assistant", subtype: "delta", content: "Hello " };
		yield { type: "assistant", subtype: "delta", content: "world" };
		yield { type: "result", content: "Done" };
	};
	return {
		createSession: vi.fn().mockResolvedValue({
			sessionId: "sess-1",
			events: defaultEvents(),
		}),
		sendMessage: vi.fn().mockResolvedValue(defaultEvents()),
		shutdown: vi.fn(),
		...overrides,
	};
}

/** Collect all text chunks posted to thread.post from its AsyncIterable argument */
function captureStreamedPost(thread: ReturnType<typeof createMockThread>) {
	const chunks: string[][] = [];
	(thread.post as Mock).mockImplementation(
		async (arg: AsyncIterable<string> | string) => {
			if (typeof arg === "string") {
				chunks.push([arg]);
			} else {
				const collected: string[] = [];
				for await (const chunk of arg) {
					collected.push(chunk);
				}
				chunks.push(collected);
			}
			return { id: "sent-1" };
		},
	);
	return chunks;
}

function makeBaseConfig(chatConfigOverrides?: Partial<ChatConfig>): {
	sessionManager: ReturnType<typeof createMockSessionManager>;
	config: SandcasterConfig;
	chatConfig: ChatConfig;
} {
	return {
		sessionManager: createMockSessionManager(),
		config: {} as SandcasterConfig,
		chatConfig: {
			sessionTimeoutMs: 600_000,
			slack: {
				botToken: "xoxb-test",
				appToken: "xapp-test",
				signingSecret: "secret",
			},
			...chatConfigOverrides,
		},
	};
}

/** Get the captured handlers from the most recently instantiated Chat mock */
async function getHandlers() {
	const { Chat } = await import("chat");
	const instance = (Chat as Mock).mock.results[0]?.value;
	if (!instance) throw new Error("Chat was not instantiated");
	const mentionHandler = instance._mentionHandler;
	const subscribedHandler = instance._subscribedHandler;
	if (!mentionHandler) throw new Error("onNewMention handler not registered");
	if (!subscribedHandler)
		throw new Error("onSubscribedMessage handler not registered");
	return { mentionHandler, subscribedHandler };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("integration: full mention → session → stream → post flow", () => {
	let _Chat: Mock;

	beforeEach(async () => {
		vi.clearAllMocks();
		const chatMod = await import("chat");
		_Chat = chatMod.Chat as Mock;
	});

	// -------------------------------------------------------------------------
	// Scenario 1: Full mention flow
	// -------------------------------------------------------------------------

	test("scenario 1 — full mention flow: subscribe, session created, streamed text posted", async () => {
		const opts = makeBaseConfig();
		const { pool } = createChatBot(opts as any);
		const { mentionHandler } = await getHandlers();

		const thread = createMockThread();
		const chunks = captureStreamedPost(thread);
		const message = createMockMessage({ text: "Hello agent" });

		await mentionHandler(thread, message);

		// thread.subscribe() called
		expect(thread.subscribe).toHaveBeenCalledOnce();

		// pool has the session registered
		const threadKey = SessionPool.makeKey("slack", thread.channelId, thread.id);
		expect(pool.resolve(threadKey)).toBe("sess-1");

		// thread.post received streamed text
		expect(thread.post).toHaveBeenCalledOnce();
		expect(chunks[0]).toEqual(["Hello ", "world"]);
	});

	// -------------------------------------------------------------------------
	// Scenario 2: Full subscribed message flow (existing session)
	// -------------------------------------------------------------------------

	test("scenario 2 — subscribed message with existing session: sendMessage called, text posted", async () => {
		const sessionManager = createMockSessionManager();
		const sendEvents = async function* () {
			yield { type: "assistant", subtype: "delta", content: "Reply text" };
			yield { type: "result", content: "Done" };
		};
		sessionManager.sendMessage = vi.fn().mockResolvedValue(sendEvents());

		const opts = { ...makeBaseConfig(), sessionManager };
		const { pool } = createChatBot(opts as any);
		const { subscribedHandler } = await getHandlers();

		const thread = createMockThread();
		const chunks = captureStreamedPost(thread);

		// Pre-register session
		const threadKey = SessionPool.makeKey("slack", thread.channelId, thread.id);
		pool.register(threadKey, "existing-sess");

		const message = createMockMessage({ text: "follow-up question" });
		await subscribedHandler(thread, message);

		// sendMessage called with correct sessionId
		expect(sessionManager.sendMessage).toHaveBeenCalledWith(
			"existing-sess",
			expect.objectContaining({ prompt: "follow-up question" }),
		);

		// thread.post received streamed text
		expect(thread.post).toHaveBeenCalledOnce();
		expect(chunks[0]).toEqual(["Reply text"]);
	});

	// -------------------------------------------------------------------------
	// Scenario 3: Re-engagement after timeout
	// -------------------------------------------------------------------------

	test("scenario 3 — re-engagement: history fetched, createSession called with context, pool re-registered", async () => {
		const sessionManager = createMockSessionManager();
		const opts = { ...makeBaseConfig(), sessionManager };
		createChatBot(opts as any);
		const { subscribedHandler: _subscribedHandler } = await getHandlers();

		// Thread history to iterate
		const historyMessages = [
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
				for (const m of historyMessages) yield m;
			})(),
		});

		const { pool } = createChatBot(opts as any);
		// Ensure no session in pool for this thread
		const threadKey = SessionPool.makeKey("slack", thread.channelId, thread.id);
		expect(pool.resolve(threadKey)).toBeUndefined();

		// Re-instantiate to use fresh handlers after second createChatBot call
		const { Chat: ChatMod } = await import("chat");
		const instance = (ChatMod as Mock).mock.results[
			(ChatMod as Mock).mock.results.length - 1
		]?.value;
		const reEngageSubscribedHandler = instance._subscribedHandler;

		const message = createMockMessage({ text: "continuing chat" });
		await reEngageSubscribedHandler(thread, message);

		// createSession called with context prefix + message
		expect(sessionManager.createSession).toHaveBeenCalled();
		const callArg = (sessionManager.createSession as Mock).mock.calls[0][0];
		expect(callArg.prompt).toContain("Previous conversation:");
		expect(callArg.prompt).toContain("continuing chat");

		// Pool re-registered
		expect(pool.resolve(threadKey)).toBe("sess-1");
	});

	// -------------------------------------------------------------------------
	// Scenario 4: Duplicate event delivery
	// -------------------------------------------------------------------------

	test("scenario 4 — duplicate message ID: createSession called exactly once", async () => {
		const sessionManager = createMockSessionManager();
		// Need separate event generators for each potential call
		const makeEvents = () =>
			(async function* () {
				yield { type: "assistant", subtype: "delta", content: "Hi" };
				yield { type: "result", content: "Done" };
			})();
		sessionManager.createSession = vi
			.fn()
			.mockResolvedValueOnce({ sessionId: "sess-1", events: makeEvents() })
			.mockResolvedValueOnce({ sessionId: "sess-2", events: makeEvents() });

		const opts = { ...makeBaseConfig(), sessionManager };
		createChatBot(opts as any);
		const { mentionHandler } = await getHandlers();

		const fixedId = "dedup-msg-999";
		const message = createMockMessage({ id: fixedId, text: "hello" });

		const thread1 = createMockThread({ id: "thread-a" });
		const thread2 = createMockThread({ id: "thread-b" });

		// First call
		await mentionHandler(thread1, message);
		// Second call with same message ID
		await mentionHandler(thread2, message);

		// createSession called exactly once
		expect(sessionManager.createSession).toHaveBeenCalledOnce();
	});

	// -------------------------------------------------------------------------
	// Scenario 5: Concurrent messages in expired thread
	// -------------------------------------------------------------------------

	test("scenario 5 — concurrent messages in expired thread: mutex ensures only one session created", async () => {
		const sessionManager = createMockSessionManager();

		const makeEvents = () =>
			(async function* () {
				yield { type: "assistant", subtype: "delta", content: "Hi" };
				yield { type: "result", content: "Done" };
			})();

		// Resolve function set when createSession is actually called
		let resolveCreateSession:
			| ((value: { sessionId: string; events: AsyncGenerator<any> }) => void)
			| undefined;
		sessionManager.createSession = vi.fn().mockImplementation(
			() =>
				new Promise<{ sessionId: string; events: AsyncGenerator<any> }>(
					(resolve) => {
						resolveCreateSession = resolve;
					},
				),
		);

		const opts = { ...makeBaseConfig(), sessionManager };
		createChatBot(opts as any);
		const { subscribedHandler } = await getHandlers();

		const thread = createMockThread();

		// Fire two simultaneous calls
		const p1 = subscribedHandler(
			thread,
			createMockMessage({ id: "concurrent-1", text: "msg1" }),
		);
		const p2 = subscribedHandler(
			thread,
			createMockMessage({ id: "concurrent-2", text: "msg2" }),
		);

		// Yield to the event loop until createSession is called by the first handler
		// (which acquires the mutex first), then resolve it so both promises complete
		for (let i = 0; i < 20; i++) {
			await Promise.resolve();
			if (resolveCreateSession) break;
		}
		resolveCreateSession?.({
			sessionId: "sess-concurrent",
			events: makeEvents(),
		});

		await Promise.all([p1, p2]);

		// Only one createSession call — mutex serialized them, second found the session
		expect(sessionManager.createSession).toHaveBeenCalledOnce();
	});

	// -------------------------------------------------------------------------
	// Scenario 6: Access control enforcement
	// -------------------------------------------------------------------------

	test("scenario 6 — access control: blocked channel does not trigger createSession or thread.post", async () => {
		const sessionManager = createMockSessionManager();
		const opts = {
			...makeBaseConfig({ allowedChannels: ["C123"] }),
			sessionManager,
		};
		createChatBot(opts as any);
		const { mentionHandler } = await getHandlers();

		const blockedThread = createMockThread({ channelId: "C999" });
		const message = createMockMessage();

		await mentionHandler(blockedThread, message);

		expect(sessionManager.createSession).not.toHaveBeenCalled();
		expect(blockedThread.post).not.toHaveBeenCalled();
	});

	// -------------------------------------------------------------------------
	// Scenario 7: Session creation failure
	// -------------------------------------------------------------------------

	test("scenario 7 — createSession throws: error message posted to thread, no crash", async () => {
		const sessionManager = createMockSessionManager();
		sessionManager.createSession = vi
			.fn()
			.mockRejectedValue(new Error("sandbox boot failed"));

		const opts = { ...makeBaseConfig(), sessionManager };
		createChatBot(opts as any);
		const { mentionHandler } = await getHandlers();

		const thread = createMockThread();

		await expect(
			mentionHandler(thread, createMockMessage()),
		).resolves.not.toThrow();

		expect(thread.post).toHaveBeenCalledWith(
			expect.stringContaining("sandbox boot failed"),
		);
	});

	// -------------------------------------------------------------------------
	// Scenario 8: Streaming error mid-response
	// -------------------------------------------------------------------------

	test("scenario 8 — error event mid-stream: error text posted, no crash", async () => {
		const sessionManager = createMockSessionManager();
		const eventsWithError = async function* () {
			yield { type: "assistant", subtype: "delta", content: "Partial" };
			yield { type: "error", content: "something went wrong" };
		};
		sessionManager.createSession = vi.fn().mockResolvedValue({
			sessionId: "sess-err",
			events: eventsWithError(),
		});

		const opts = { ...makeBaseConfig(), sessionManager };
		createChatBot(opts as any);
		const { mentionHandler } = await getHandlers();

		const thread = createMockThread();
		const chunks = captureStreamedPost(thread);

		await expect(
			mentionHandler(thread, createMockMessage()),
		).resolves.not.toThrow();

		expect(thread.post).toHaveBeenCalledOnce();
		// The stream should include partial text and the error
		const allText = chunks[0]?.join("") ?? "";
		expect(allText).toContain("Partial");
		expect(allText).toContain("something went wrong");
	});
});
