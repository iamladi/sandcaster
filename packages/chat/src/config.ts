import * as z from "zod";

// ---------------------------------------------------------------------------
// Platform credential schemas
// ---------------------------------------------------------------------------

const SlackConfigSchema = z.object({
	botToken: z.string().min(1),
	appToken: z.string().min(1),
	signingSecret: z.string().min(1),
});

const DiscordConfigSchema = z.object({
	botToken: z.string().min(1),
	publicKey: z.string().min(1),
});

const TelegramConfigSchema = z.object({
	botToken: z.string().min(1),
});

// ---------------------------------------------------------------------------
// ChatConfigSchema
// ---------------------------------------------------------------------------

export const ChatConfigSchema = z.object({
	slack: SlackConfigSchema.optional(),
	discord: DiscordConfigSchema.optional(),
	telegram: TelegramConfigSchema.optional(),
	sessionTimeoutMs: z.number().int().gte(1_000).default(600_000),
	allowedChannels: z.array(z.string()).optional(),
	allowedUsers: z.array(z.string()).optional(),
	botName: z.string().optional(),
});

export type ChatConfig = z.infer<typeof ChatConfigSchema>;

// ---------------------------------------------------------------------------
// resolveChatConfig — merge explicit config with env var fallbacks
// ---------------------------------------------------------------------------

export function resolveChatConfig(
	explicit: Record<string, unknown>,
): ChatConfig {
	const merged: Record<string, unknown> = { ...explicit };

	// Resolve Slack from env if not explicitly set
	if (!merged.slack) {
		const botToken = process.env.SLACK_BOT_TOKEN;
		const appToken = process.env.SLACK_APP_TOKEN;
		const signingSecret = process.env.SLACK_SIGNING_SECRET;
		if (botToken && appToken && signingSecret) {
			merged.slack = { botToken, appToken, signingSecret };
		}
	}

	// Resolve Discord from env if not explicitly set
	if (!merged.discord) {
		const botToken = process.env.DISCORD_BOT_TOKEN;
		const publicKey = process.env.DISCORD_PUBLIC_KEY;
		if (botToken && publicKey) {
			merged.discord = { botToken, publicKey };
		}
	}

	// Resolve Telegram from env if not explicitly set
	if (!merged.telegram) {
		const botToken = process.env.TELEGRAM_BOT_TOKEN;
		if (botToken) {
			merged.telegram = { botToken };
		}
	}

	// Resolve sessionTimeoutMs from env if not explicitly set
	if (merged.sessionTimeoutMs === undefined) {
		const envTimeout = process.env.SANDCASTER_CHAT_SESSION_TIMEOUT_MS;
		if (envTimeout) {
			const parsed = Number.parseInt(envTimeout, 10);
			if (Number.isFinite(parsed) && parsed >= 1_000) {
				merged.sessionTimeoutMs = parsed;
			}
		}
	}

	const result = ChatConfigSchema.parse(merged);
	return result;
}
