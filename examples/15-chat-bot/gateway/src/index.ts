import { serve } from "@hono/node-server";
import {
	createChatBot,
	createChatWebhookRoutes,
	resolveChatConfig,
} from "@sandcaster/chat";
import type {
	ISessionStore,
	SessionManagerOptions,
	SessionRecord,
	SessionSandboxFactory,
} from "@sandcaster/core";
import {
	getSandboxProvider,
	loadConfig,
	runAgentOnInstance,
	SessionManager,
} from "@sandcaster/core";
import { Hono } from "hono";

// ---------------------------------------------------------------------------
// Sandbox factory (same pattern as CLI)
// ---------------------------------------------------------------------------

const sandboxFactory: SessionSandboxFactory = async (opts) => {
	const result = await getSandboxProvider(opts.provider);
	if (!result.ok) {
		throw new Error(`Sandbox provider error: ${result.message}`);
	}
	const createResult = await result.provider.create({
		template: opts.template,
		timeoutMs: opts.timeoutMs,
		envs: opts.envs,
		apiKey: opts.apiKey,
		metadata: opts.metadata,
	});
	if (!createResult.ok) {
		throw new Error(`Failed to create sandbox: ${createResult.message}`);
	}
	return createResult.instance;
};

// ---------------------------------------------------------------------------
// In-memory session store
// ---------------------------------------------------------------------------

const ACTIVE_STATUSES = new Set(["initializing", "active", "running"]);

function createInMemorySessionStore(): ISessionStore {
	const records = new Map<string, SessionRecord>();
	return {
		create(record: SessionRecord): void {
			records.set(record.id, { ...record });
		},
		get(id: string): SessionRecord | undefined {
			return records.get(id);
		},
		update(id: string, updates: Partial<SessionRecord>): void {
			const existing = records.get(id);
			if (existing) {
				records.set(id, { ...existing, ...updates });
			}
		},
		list(limit?: number): SessionRecord[] {
			const all = [...records.values()];
			return limit !== undefined ? all.slice(0, limit) : all;
		},
		delete(id: string): void {
			records.delete(id);
		},
		getActiveRecords(): SessionRecord[] {
			return [...records.values()].filter((r) => ACTIVE_STATUSES.has(r.status));
		},
		activeCount(): number {
			return this.getActiveRecords().length;
		},
	};
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// loadConfig() checks cwd first, then falls back to parent directory
// (sandcaster.json lives in examples/15-chat-bot/, one level above gateway/)
const config = loadConfig() ?? loadConfig("..");
if (!config) {
	console.error(
		"No sandcaster.json found in current directory or parent. Run from examples/15-chat-bot/ or examples/15-chat-bot/gateway/.",
	);
	process.exit(1);
}

const chatConfig = resolveChatConfig(
	((config as Record<string, unknown>).chat as Record<string, unknown>) ?? {},
);

const hasPlatform =
	chatConfig.slack || chatConfig.discord || chatConfig.telegram;
if (!hasPlatform) {
	console.error(
		"No chat platforms configured. Set SLACK_BOT_TOKEN, DISCORD_BOT_TOKEN, or TELEGRAM_BOT_TOKEN.",
	);
	process.exit(1);
}

// Session manager with pool cleanup callback
let poolRef: ReturnType<typeof createChatBot>["pool"] | null = null;
const onSessionExpired = (sessionId: string) => {
	poolRef?.removeBySessionId(sessionId);
};

const sessionManager = new SessionManager({
	store: createInMemorySessionStore(),
	sandboxFactory,
	runAgent: runAgentOnInstance,
	onSessionExpired,
} satisfies SessionManagerOptions);

const { bot, pool } = createChatBot({
	sessionManager,
	config,
	chatConfig,
});
poolRef = pool;

// ---------------------------------------------------------------------------
// Hono app
// ---------------------------------------------------------------------------

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok" }));

const webhookRoutes = createChatWebhookRoutes(bot);
app.route("/webhooks", webhookRoutes);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

const port = Number.parseInt(process.env.PORT ?? "8080", 10);

await bot.initialize();

const platforms: string[] = [];
if (chatConfig.slack) platforms.push("Slack");
if (chatConfig.discord) platforms.push("Discord");
if (chatConfig.telegram) platforms.push("Telegram");

serve({ fetch: app.fetch, port }, () => {
	console.log(`Chat gateway listening on http://localhost:${port}`);
	console.log(`Active platforms: ${platforms.join(", ")}`);
	console.log(`Webhook URL: http://localhost:${port}/webhooks/:platform`);
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

const shutdown = async () => {
	console.log("Shutting down...");
	await bot.shutdown();
	await sessionManager.shutdown();
	process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
