import type {
	SandboxInstance,
	SandboxProviderName,
} from "../sandbox-provider.js";
import type { SandcasterEvent, Session, SessionCommand } from "../schemas.js";

/** A single conversation turn */
export interface ConversationTurn {
	role: "user" | "assistant";
	content: string;
	/** If true, this is a tool_use or tool_result and must be kept paired */
	isToolCall?: boolean;
}

/** Internal representation of a live session */
export interface ActiveSession {
	session: Session;
	instance: SandboxInstance | null;
	history: ConversationTurn[];
	idleTimer: ReturnType<typeof setTimeout> | null;
	abortController: AbortController | null;
	/** Set of attached SSE client write functions */
	clients: Set<(event: SandcasterEvent) => boolean>;
	/** Conversation summary from /compact */
	conversationSummary?: string;
}

/** Options for creating a session manager */
export interface SessionManagerOptions {
	store: ISessionStore;
	sandboxFactory: SessionSandboxFactory;
	runAgent?: (
		instance: SandboxInstance,
		request: import("../schemas.js").QueryRequest,
		config?: import("../schemas.js").SandcasterConfig,
		signal?: AbortSignal,
	) => AsyncGenerator<SandcasterEvent>;
	summarizer?: LlmSummarizer;
	idleTimeoutMs?: number;
	maxActiveSessions?: number;
	maxHistoryTurns?: number;
}

/** Factory function for creating sandbox instances */
export type SessionSandboxFactory = (opts: {
	provider: SandboxProviderName;
	template?: string;
	timeoutMs: number;
	envs: Record<string, string>;
	apiKey?: string;
	metadata?: Record<string, string>;
}) => Promise<SandboxInstance>;

/** Interface for session store */
export interface ISessionStore {
	create(record: import("../schemas.js").SessionRecord): void;
	get(id: string): import("../schemas.js").SessionRecord | undefined;
	update(
		id: string,
		updates: Partial<import("../schemas.js").SessionRecord>,
	): void;
	list(limit?: number): import("../schemas.js").SessionRecord[];
	delete(id: string): void;
	/** Returns all records with active/running status (for startup cleanup) */
	getActiveRecords(): import("../schemas.js").SessionRecord[];
	/** Current count of non-expired/ended sessions in memory */
	activeCount(): number;
}

/** Function signature for LLM summarization (injected dependency for /compact) */
export type LlmSummarizer = (
	turns: ConversationTurn[],
	model?: string,
) => Promise<string>;

/** Session command executor function */
export type CommandExecutor = (
	session: ActiveSession,
	command: SessionCommand,
) => AsyncGenerator<SandcasterEvent>;

// ---------------------------------------------------------------------------
// Session ID generator
// ---------------------------------------------------------------------------

const ADJECTIVES = [
	"bright",
	"calm",
	"dark",
	"eager",
	"fast",
	"glad",
	"happy",
	"keen",
	"lively",
	"neat",
	"proud",
	"quick",
	"sharp",
	"warm",
	"bold",
	"cool",
	"fair",
	"grand",
	"just",
	"kind",
	"mild",
	"open",
	"pure",
	"rich",
	"safe",
	"tall",
	"vast",
	"wise",
	"young",
	"zesty",
];

const NOUNS = [
	"fox",
	"owl",
	"elk",
	"bee",
	"ant",
	"cat",
	"dog",
	"ram",
	"yak",
	"emu",
	"jay",
	"cod",
	"hen",
	"bat",
	"ray",
	"ape",
	"gnu",
	"koi",
	"pug",
	"boa",
	"cub",
	"doe",
	"ewe",
	"kit",
	"orb",
	"pod",
	"sun",
	"arc",
	"gem",
	"oak",
];

export function generateSessionId(): string {
	const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
	const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
	const num = Math.floor(1000 + Math.random() * 9000); // 4-digit number
	return `sess_${adj}-${noun}-${num}`;
}
