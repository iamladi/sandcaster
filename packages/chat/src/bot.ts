import { createDiscordAdapter } from "@chat-adapter/discord";
import { createSlackAdapter } from "@chat-adapter/slack";
import { createMemoryState } from "@chat-adapter/state-memory";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import type { SandcasterConfig, SessionManager } from "@sandcaster/core";
import type { Adapter, Message, Thread } from "chat";
import { Chat } from "chat";
import type { ChatConfig } from "./config.js";
import { eventToTextStream } from "./event-bridge.js";
import { SessionPool } from "./session-pool.js";
import { buildThreadContext } from "./thread-context.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatBotOptions {
	sessionManager: SessionManager;
	config: SandcasterConfig;
	chatConfig: ChatConfig;
}

export interface ChatBotResult {
	bot: Chat;
	pool: SessionPool;
}

// ---------------------------------------------------------------------------
// Dedup helpers
// ---------------------------------------------------------------------------

const DEDUP_TTL_MS = 10 * 60 * 1000; // 10 minutes

function makeDeduper(): {
	has: (id: string) => boolean;
	add: (id: string) => void;
} {
	const seen = new Set<string>();
	return {
		has(id: string): boolean {
			return seen.has(id);
		},
		add(id: string): void {
			seen.add(id);
			setTimeout(() => {
				seen.delete(id);
			}, DEDUP_TTL_MS);
		},
	};
}

// ---------------------------------------------------------------------------
// Access control helper
// ---------------------------------------------------------------------------

function isAllowed(
	channelId: string,
	userId: string,
	chatConfig: ChatConfig,
): boolean {
	if (
		chatConfig.allowedChannels !== undefined &&
		!chatConfig.allowedChannels.includes(channelId)
	) {
		return false;
	}
	if (
		chatConfig.allowedUsers !== undefined &&
		!chatConfig.allowedUsers.includes(userId)
	) {
		return false;
	}
	return true;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createChatBot(options: ChatBotOptions): ChatBotResult {
	const { sessionManager, config, chatConfig } = options;

	// Build adapters — only include platforms with credentials
	const adapters: Record<string, Adapter> = {};

	if (chatConfig.slack) {
		adapters.slack = createSlackAdapter(chatConfig.slack);
	}
	if (chatConfig.discord) {
		adapters.discord = createDiscordAdapter(chatConfig.discord);
	}
	if (chatConfig.telegram) {
		adapters.telegram = createTelegramAdapter(chatConfig.telegram);
	}

	const state = createMemoryState();
	const userName = chatConfig.botName ?? "sandcaster";

	const bot = new Chat({ adapters, state, userName });

	const pool = new SessionPool();
	const dedup = makeDeduper();

	// -------------------------------------------------------------------------
	// onNewMention handler
	// -------------------------------------------------------------------------

	bot.onNewMention(async (thread: Thread, message: Message) => {
		// Access control
		if (!isAllowed(thread.channelId, message.author.userId, chatConfig)) {
			return;
		}

		// Dedup
		if (dedup.has(message.id)) {
			return;
		}
		dedup.add(message.id);

		const threadKey = SessionPool.makeKey(
			thread.adapter.name,
			thread.channelId,
			thread.id,
		);

		const release = await pool.acquireMutex(threadKey);
		try {
			// Subscribe to thread for follow-up messages
			await thread.subscribe();

			// Create a new session
			const { sessionId, events } = await sessionManager.createSession(
				{ prompt: message.text },
				config,
			);

			// Register in pool
			pool.register(threadKey, sessionId);

			// Stream response
			await thread.post(eventToTextStream(events));
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			await thread.post(`Error: ${msg}`);
		} finally {
			release();
		}
	});

	// -------------------------------------------------------------------------
	// onSubscribedMessage handler
	// -------------------------------------------------------------------------

	bot.onSubscribedMessage(async (thread: Thread, message: Message) => {
		// Access control
		if (!isAllowed(thread.channelId, message.author.userId, chatConfig)) {
			return;
		}

		// Dedup
		if (dedup.has(message.id)) {
			return;
		}
		dedup.add(message.id);

		const threadKey = SessionPool.makeKey(
			thread.adapter.name,
			thread.channelId,
			thread.id,
		);

		const release = await pool.acquireMutex(threadKey);
		try {
			const existingSessionId = pool.resolve(threadKey);

			if (existingSessionId) {
				// Send to existing session
				const events = await sessionManager.sendMessage(existingSessionId, {
					prompt: message.text,
				});
				await thread.post(eventToTextStream(events));
			} else {
				// Re-engagement: session expired, rebuild context
				const previousMessages: {
					authorName: string;
					text: string;
					isBot: boolean;
				}[] = [];
				for await (const msg of thread.allMessages) {
					previousMessages.push({
						authorName: msg.author.fullName,
						text: msg.text,
						isBot: msg.author.isBot === true,
					});
				}

				const context = buildThreadContext(
					previousMessages,
					chatConfig.botName ?? "Sandcaster",
				);
				const prompt = context ? `${context}\n\n${message.text}` : message.text;

				const { sessionId, events } = await sessionManager.createSession(
					{ prompt },
					config,
				);

				pool.register(threadKey, sessionId);
				await thread.post(eventToTextStream(events));
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			await thread.post(`Error: ${msg}`);
		} finally {
			release();
		}
	});

	return { bot, pool };
}
