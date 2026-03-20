import type {
	ChatBotOptions,
	ChatBotResult,
	ChatConfig,
} from "@sandcaster/chat";
import {
	createChatBot as coreCreateChatBot,
	resolveChatConfig as coreResolveChatConfig,
} from "@sandcaster/chat";
import type {
	ISessionStore,
	SandcasterConfig,
	SessionManagerOptions,
	SessionRecord,
	SessionSandboxFactory,
} from "@sandcaster/core";
import {
	loadConfig as coreLoadConfig,
	getSandboxProvider,
	runAgentOnInstance,
	SessionManager,
} from "@sandcaster/core";
import { defineCommand } from "citty";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChatArgs = {};

export interface ChatDeps {
	loadConfig: (dir?: string) => SandcasterConfig | null;
	resolveChatConfig: (explicit: Record<string, unknown>) => ChatConfig;
	createChatBot: (options: ChatBotOptions) => ChatBotResult;
	createSessionManager: (opts: SessionManagerOptions) => SessionManager;
	createSessionStore: () => ISessionStore;
	sandboxFactory: SessionSandboxFactory;
	runAgent: SessionManagerOptions["runAgent"];
	stdout: { write: (data: string) => boolean };
	exit: (code: number) => void;
}

// ---------------------------------------------------------------------------
// Core logic (injectable for testing)
// ---------------------------------------------------------------------------

export async function executeChat(
	_args: ChatArgs,
	deps: ChatDeps,
): Promise<void> {
	// 1. Load config
	const config = deps.loadConfig();

	// 2. Resolve chat config
	const chatConfig = deps.resolveChatConfig(
		((config as Record<string, unknown> | null)?.chat as Record<
			string,
			unknown
		>) ?? {},
	);

	// 3. Check at least one platform configured
	const hasPlatform =
		chatConfig.slack || chatConfig.discord || chatConfig.telegram;
	if (!hasPlatform) {
		deps.stdout.write(
			"No chat platforms configured. Set SLACK_BOT_TOKEN, DISCORD_BOT_TOKEN, or TELEGRAM_BOT_TOKEN.\n",
		);
		deps.exit(1);
		return;
	}

	// 4. Create SessionManager with callback holder (filled after createChatBot)
	let poolRef: ChatBotResult["pool"] | null = null;
	const onSessionExpired = (sessionId: string) => {
		poolRef?.removeBySessionId(sessionId);
	};

	const sessionManager = deps.createSessionManager({
		store: deps.createSessionStore(),
		sandboxFactory: deps.sandboxFactory,
		runAgent: deps.runAgent,
		onSessionExpired,
	});

	// 5. Create chat bot
	const result = deps.createChatBot({
		sessionManager,
		config: config ?? ({} as SandcasterConfig),
		chatConfig,
	});
	poolRef = result.pool;

	const { bot } = result;

	// 6. Initialize
	await bot.initialize();

	// 7. Log active platforms
	const platforms: string[] = [];
	if (chatConfig.slack) platforms.push("Slack");
	if (chatConfig.discord) platforms.push("Discord");
	if (chatConfig.telegram) platforms.push("Telegram");
	deps.stdout.write(`Chat bot started on: ${platforms.join(", ")}\n`);

	// 8. Graceful shutdown handlers (FR-9)
	const shutdown = async () => {
		deps.stdout.write("Shutting down...\n");
		await bot.shutdown();
		await sessionManager.shutdown();
		deps.exit(0);
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
}

// ---------------------------------------------------------------------------
// Production sandbox factory
// ---------------------------------------------------------------------------

const prodSandboxFactory: SessionSandboxFactory = async (opts) => {
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
// In-memory session store (ephemeral — no disk I/O, no stale-record risk)
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
// Production deps
// ---------------------------------------------------------------------------

const prodDeps: ChatDeps = {
	loadConfig: coreLoadConfig,
	resolveChatConfig: coreResolveChatConfig,
	createChatBot: coreCreateChatBot,
	createSessionManager: (opts: SessionManagerOptions) =>
		new SessionManager(opts),
	createSessionStore: createInMemorySessionStore,
	sandboxFactory: prodSandboxFactory,
	runAgent: runAgentOnInstance,
	stdout: process.stdout,
	exit: (code: number) => process.exit(code),
};

// ---------------------------------------------------------------------------
// citty command definition
// ---------------------------------------------------------------------------

const startSubcommand = defineCommand({
	meta: {
		name: "start",
		description: "Start the Sandcaster chat bot",
	},
	async run() {
		await executeChat({}, prodDeps);
	},
});

export const chatCommand = defineCommand({
	meta: {
		name: "chat",
		description: "Manage the Sandcaster chat bot",
	},
	subCommands: {
		start: startSubcommand,
	},
});
