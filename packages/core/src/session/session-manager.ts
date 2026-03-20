import type { SandboxInstance } from "../sandbox-provider.js";
import type {
	QueryRequest,
	SandcasterConfig,
	SandcasterEvent,
	Session,
	SessionCreateRequest,
	SessionRecord,
} from "../schemas.js";
import { executeCommand, parseSessionCommand } from "./commands.js";
import { addTurn, buildAgentContext } from "./conversation.js";
import {
	type ActiveSession,
	generateSessionId,
	type SessionManagerOptions,
} from "./types.js";

// ---------------------------------------------------------------------------
// SessionError
// ---------------------------------------------------------------------------

export class SessionError extends Error {
	constructor(
		message: string,
		public readonly code: string,
	) {
		super(message);
		this.name = "SessionError";
	}
}

// ---------------------------------------------------------------------------
// Mutex
// ---------------------------------------------------------------------------

export class Mutex {
	private locked = false;
	private waiters: Array<() => void> = [];

	async acquire(): Promise<void> {
		if (!this.locked) {
			this.locked = true;
			return;
		}
		return new Promise<void>((resolve) => this.waiters.push(resolve));
	}

	tryAcquire(): boolean {
		if (this.locked) return false;
		this.locked = true;
		return true;
	}

	release(): void {
		if (this.waiters.length > 0) {
			// biome-ignore lint/style/noNonNullAssertion: length checked above
			this.waiters.shift()!();
		} else {
			this.locked = false;
		}
	}

	get isLocked(): boolean {
		return this.locked;
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_IDLE_TIMEOUT_MS = 900_000; // 15 min
const DEFAULT_MAX_ACTIVE_SESSIONS = 100;
const DEFAULT_MAX_HISTORY_TURNS = 50;

function nowIso(): string {
	return new Date().toISOString();
}

function sessionRecordToSession(record: SessionRecord): Session {
	return {
		id: record.id,
		status: record.status,
		sandboxProvider: record.sandboxProvider,
		sandboxId: record.sandboxId,
		createdAt: record.createdAt,
		lastActivityAt: record.lastActivityAt,
		idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
		runs: [],
		totalCostUsd: record.totalCostUsd,
		totalTurns: record.totalTurns,
		name: record.name,
	};
}

/**
 * Eagerly runs an async generator and returns a buffered pull generator.
 * The inner generator starts executing immediately (not lazily).
 */
const MAX_EAGER_BUFFER = 1000;

function eagerBuffer<T>(source: AsyncGenerator<T>): AsyncGenerator<T> {
	const buffer: T[] = [];
	let done = false;
	let error: unknown;
	let cancelled = false;
	let notify: (() => void) | undefined;
	let drain: (() => void) | undefined;

	// Start consuming immediately
	(async () => {
		try {
			for await (const item of source) {
				if (cancelled) break;
				buffer.push(item);
				notify?.();
				notify = undefined;
				// Backpressure: pause producer when buffer hits high-water mark
				if (buffer.length >= MAX_EAGER_BUFFER) {
					await new Promise<void>((resolve) => {
						drain = resolve;
					});
					if (cancelled) break;
				}
			}
		} catch (err) {
			if (!cancelled) {
				error = err;
			}
			notify?.();
			notify = undefined;
		} finally {
			done = true;
			notify?.();
			notify = undefined;
		}
	})();

	return (async function* (): AsyncGenerator<T> {
		try {
			while (true) {
				if (buffer.length > 0) {
					// biome-ignore lint/style/noNonNullAssertion: length checked
					yield buffer.shift()!;
					// Resume producer if it was waiting on backpressure
					drain?.();
					drain = undefined;
				} else if (done) {
					if (error !== undefined) throw error;
					return;
				} else {
					await new Promise<void>((resolve) => {
						notify = resolve;
					});
				}
			}
		} finally {
			// Consumer disconnected — unblock producer and close source
			cancelled = true;
			drain?.();
			drain = undefined;
			await source.return(undefined as T);
		}
	})();
}

// ---------------------------------------------------------------------------
// SessionManager
// ---------------------------------------------------------------------------

export class SessionManager {
	private readonly activeSessions = new Map<string, ActiveSession>();
	private readonly mutexes = new Map<string, Mutex>();

	constructor(private readonly opts: SessionManagerOptions) {}

	// -------------------------------------------------------------------------
	// initialize
	// -------------------------------------------------------------------------

	async initialize(): Promise<void> {
		const activeRecords = this.opts.store.getActiveRecords();
		for (const record of activeRecords) {
			// Best-effort: mark as expired (no live sandbox handle at boot)
			this.opts.store.update(record.id, { status: "expired" });
		}
	}

	// -------------------------------------------------------------------------
	// createSession
	// -------------------------------------------------------------------------

	async createSession(
		request: SessionCreateRequest,
		config?: SandcasterConfig,
	): Promise<{
		sessionId: string;
		events: AsyncGenerator<SandcasterEvent>;
	}> {
		const maxActive =
			this.opts.maxActiveSessions ?? DEFAULT_MAX_ACTIVE_SESSIONS;

		if (this.activeSessions.size >= maxActive) {
			throw new SessionError(
				`Session capacity limit reached (max ${maxActive})`,
				"SESSION_CAPACITY_EXCEEDED",
			);
		}

		const sessionId = generateSessionId();
		const now = nowIso();

		const sandboxProvider =
			request.sandboxProvider ?? config?.sandboxProvider ?? ("e2b" as const);

		const record: SessionRecord = {
			id: sessionId,
			status: "initializing",
			sandboxProvider,
			sandboxId: null,
			createdAt: now,
			lastActivityAt: now,
			runsCount: 0,
			totalCostUsd: 0,
			totalTurns: 0,
			name: request.sessionConfig?.name,
		};
		this.opts.store.create(record);

		let instance: SandboxInstance | null = null;

		try {
			instance = await this.opts.sandboxFactory({
				provider: sandboxProvider,
				template: undefined,
				timeoutMs: (request.timeout ?? 600) * 1000,
				envs: {},
				apiKey: request.apiKeys?.e2b,
			});
		} catch (err) {
			this.opts.store.update(sessionId, { status: "failed" });
			throw err;
		}

		this.opts.store.update(sessionId, { status: "active" });

		const idleTimeoutMs =
			request.sessionConfig?.idleTimeoutSecs != null
				? request.sessionConfig.idleTimeoutSecs * 1000
				: (this.opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS);

		const maxHistoryTurns =
			request.sessionConfig?.maxHistoryTurns ??
			this.opts.maxHistoryTurns ??
			DEFAULT_MAX_HISTORY_TURNS;

		const session: Session = {
			id: sessionId,
			status: "active",
			sandboxProvider,
			sandboxId: null,
			createdAt: now,
			lastActivityAt: nowIso(),
			idleTimeoutMs,
			config,
			sessionConfig: request.sessionConfig,
			runs: [],
			totalCostUsd: 0,
			totalTurns: 0,
			name: record.name,
		};

		const activeSession: ActiveSession = {
			session,
			instance,
			history: [],
			idleTimer: null,
			abortController: null,
			clients: new Set(),
		};

		this.activeSessions.set(sessionId, activeSession);
		this.mutexes.set(sessionId, new Mutex());

		// Start idle timer
		this._startIdleTimer(sessionId, idleTimeoutMs);

		const hasPrompt = Boolean(request.prompt);

		// Build the outer event stream
		const self = this;

		const rawGen = (async function* (): AsyncGenerator<SandcasterEvent> {
			yield {
				type: "session_created",
				sessionId,
				content: `Session ${sessionId} created`,
			} satisfies SandcasterEvent;

			if (!hasPrompt || !self.opts.runAgent) {
				return;
			}

			// Run first message through agent (acquires mutex internally)
			for await (const event of self._runAgentForMessage(
				sessionId,
				{ prompt: request.prompt, files: request.files },
				maxHistoryTurns,
				config,
			)) {
				yield event;
			}
		})();

		return { sessionId, events: eagerBuffer(rawGen) };
	}

	// -------------------------------------------------------------------------
	// sendMessage
	// -------------------------------------------------------------------------

	async sendMessage(
		sessionId: string,
		message: { prompt: string; files?: Record<string, string> },
	): Promise<AsyncGenerator<SandcasterEvent>> {
		const activeSession = this.activeSessions.get(sessionId);

		if (!activeSession) {
			throw new SessionError(
				`Session ${sessionId} not found`,
				"SESSION_NOT_FOUND",
			);
		}

		if (
			activeSession.session.status === "expired" ||
			activeSession.session.status === "ended"
		) {
			throw new SessionError(
				`Session ${sessionId} is ${activeSession.session.status}`,
				"SESSION_EXPIRED",
			);
		}

		const mutex = this._getMutex(sessionId);

		if (!mutex.tryAcquire()) {
			throw new SessionError(`Session ${sessionId} is busy`, "SESSION_BUSY");
		}

		const maxHistoryTurns =
			activeSession.session.sessionConfig?.maxHistoryTurns ??
			this.opts.maxHistoryTurns ??
			DEFAULT_MAX_HISTORY_TURNS;
		const config = activeSession.session.config;

		// Eagerly start agent run, return buffered generator
		const rawGen = this._runAgentForMessage(
			sessionId,
			message,
			maxHistoryTurns,
			config,
			mutex,
		);

		return eagerBuffer(rawGen);
	}

	// -------------------------------------------------------------------------
	// deleteSession
	// -------------------------------------------------------------------------

	async deleteSession(sessionId: string): Promise<void> {
		const activeSession = this.activeSessions.get(sessionId);
		if (!activeSession) return;

		// Abort any active run
		if (activeSession.abortController) {
			activeSession.abortController.abort();
		}

		// Wait for mutex
		const mutex = this._getMutex(sessionId);
		await mutex.acquire();

		try {
			// Re-check after lock — expire may have already cleaned up
			if (!this.activeSessions.has(sessionId)) return;

			this._clearIdleTimer(sessionId);

			if (activeSession.instance) {
				try {
					await activeSession.instance.kill();
				} catch {
					// best-effort
				}
			}

			activeSession.session.status = "ended";
			this.opts.store.update(sessionId, { status: "ended" });

			this.activeSessions.delete(sessionId);
			this.mutexes.delete(sessionId);
		} finally {
			mutex.release();
		}
	}

	// -------------------------------------------------------------------------
	// getSession
	// -------------------------------------------------------------------------

	getSession(sessionId: string): Session | undefined {
		const activeSession = this.activeSessions.get(sessionId);
		if (activeSession) {
			return activeSession.session;
		}
		const record = this.opts.store.get(sessionId);
		if (!record) return undefined;
		return sessionRecordToSession(record);
	}

	// -------------------------------------------------------------------------
	// listSessions
	// -------------------------------------------------------------------------

	listSessions(limit?: number): SessionRecord[] {
		return this.opts.store.list(limit);
	}

	// -------------------------------------------------------------------------
	// getActiveSession
	// -------------------------------------------------------------------------

	getActiveSession(sessionId: string): ActiveSession | undefined {
		return this.activeSessions.get(sessionId);
	}

	// -------------------------------------------------------------------------
	// handleCommand — mutex-protected command execution
	// -------------------------------------------------------------------------

	async *handleCommand(
		sessionId: string,
		prompt: string,
	): AsyncGenerator<SandcasterEvent> {
		const command = parseSessionCommand(prompt);
		if (!command) return;

		const activeSession = this.activeSessions.get(sessionId);
		if (!activeSession) {
			throw new SessionError(
				`Session ${sessionId} not found`,
				"SESSION_NOT_FOUND",
			);
		}

		const mutex = this._getMutex(sessionId);
		if (!mutex.tryAcquire()) {
			throw new SessionError(`Session ${sessionId} is busy`, "SESSION_BUSY");
		}

		try {
			yield* executeCommand(activeSession, command, {
				summarizer: this.opts.summarizer,
			});
		} finally {
			mutex.release();
		}
	}

	// -------------------------------------------------------------------------
	// shutdown
	// -------------------------------------------------------------------------

	async shutdown(): Promise<void> {
		const ids = [...this.activeSessions.keys()];
		await Promise.all(
			ids.map(async (id) => {
				try {
					await this.deleteSession(id);
				} catch {
					// best-effort
				}
			}),
		);
	}

	// -------------------------------------------------------------------------
	// Private helpers
	// -------------------------------------------------------------------------

	private _getMutex(sessionId: string): Mutex {
		let mutex = this.mutexes.get(sessionId);
		if (!mutex) {
			mutex = new Mutex();
			this.mutexes.set(sessionId, mutex);
		}
		return mutex;
	}

	private _startIdleTimer(sessionId: string, idleTimeoutMs: number): void {
		this._clearIdleTimer(sessionId);
		const activeSession = this.activeSessions.get(sessionId);
		if (!activeSession) return;

		const timer = setTimeout(() => {
			void this._expireSession(sessionId);
		}, idleTimeoutMs);

		activeSession.idleTimer = timer;
	}

	private _clearIdleTimer(sessionId: string): void {
		const activeSession = this.activeSessions.get(sessionId);
		if (!activeSession?.idleTimer) return;
		clearTimeout(activeSession.idleTimer);
		activeSession.idleTimer = null;
	}

	private async _expireSession(sessionId: string): Promise<void> {
		const activeSession = this.activeSessions.get(sessionId);
		if (!activeSession) return;

		if (activeSession.abortController) {
			activeSession.abortController.abort();
		}

		const mutex = this._getMutex(sessionId);
		await mutex.acquire();

		try {
			// Re-check after lock — delete may have already cleaned up
			if (!this.activeSessions.has(sessionId)) return;

			if (activeSession.instance) {
				try {
					await activeSession.instance.kill();
				} catch {
					// best-effort
				}
			}

			activeSession.session.status = "expired";
			this.opts.store.update(sessionId, { status: "expired" });

			const expiredEvent: SandcasterEvent = {
				type: "session_expired",
				sessionId,
				content: `Session ${sessionId} expired due to inactivity`,
			};
			for (const client of activeSession.clients) {
				client(expiredEvent);
			}
			activeSession.clients.clear();

			this.activeSessions.delete(sessionId);
			this.mutexes.delete(sessionId);
		} finally {
			mutex.release();
		}

		// Notify external listeners after releasing the mutex to avoid deadlock
		this.opts.onSessionExpired?.(sessionId);
	}

	/**
	 * Async generator that executes one agent turn.
	 * `acquiredMutex` MUST already be held by the caller.
	 */
	private async *_runAgentForMessage(
		sessionId: string,
		message: { prompt: string; files?: Record<string, string> },
		maxHistoryTurns: number,
		config: SandcasterConfig | undefined,
		acquiredMutex?: Mutex,
	): AsyncGenerator<SandcasterEvent> {
		const activeSession = this.activeSessions.get(sessionId);
		if (!activeSession || !activeSession.instance) return;

		const mutex = acquiredMutex ?? this._getMutex(sessionId);

		// If called without a pre-acquired mutex (createSession path), acquire now
		if (!acquiredMutex) {
			if (!mutex.tryAcquire()) {
				throw new SessionError(`Session ${sessionId} is busy`, "SESSION_BUSY");
			}
		}

		this._clearIdleTimer(sessionId);

		activeSession.session.status = "running";
		this.opts.store.update(sessionId, { status: "running" });

		const abortController = new AbortController();
		activeSession.abortController = abortController;

		// Upload files
		if (message.files) {
			for (const [path, content] of Object.entries(message.files)) {
				try {
					await activeSession.instance.files.write(
						`${activeSession.instance.workDir}/${path}`,
						content,
					);
				} catch {
					// best-effort
				}
			}
		}

		// Build context + add user turn to history
		const context = buildAgentContext(
			activeSession.history,
			activeSession.conversationSummary,
		);

		addTurn(
			activeSession.history,
			{ role: "user", content: message.prompt },
			maxHistoryTurns,
		);

		const fullPrompt = context
			? `${context}\n\nUser: ${message.prompt}`
			: message.prompt;

		const runRequest: QueryRequest = { prompt: fullPrompt };
		const runAgent = this.opts.runAgent;

		let assistantContent = "";
		let costUsd: number | undefined;
		let numTurns: number | undefined;
		let durationSecs: number | undefined;
		// biome-ignore lint/style/useSingleVarDeclarator: set in catch, read in finally
		let runFailed = false;

		try {
			if (runAgent) {
				const agentGen = runAgent(
					activeSession.instance,
					runRequest,
					config,
					abortController.signal,
				);

				for await (const event of agentGen) {
					if (event.type === "assistant") {
						assistantContent += event.content;
					}
					if (event.type === "result") {
						costUsd = event.costUsd;
						numTurns = event.numTurns;
						durationSecs = event.durationSecs;
					}
					// Broadcast to attached clients (P0 fix)
					for (const client of activeSession.clients) {
						client(event);
					}
					yield event;
				}
			}
		} catch (err) {
			runFailed = true;
			const msg = err instanceof Error ? err.message : String(err);
			const errEvent = {
				type: "error",
				content: msg,
			} satisfies SandcasterEvent;
			for (const client of activeSession.clients) {
				client(errEvent);
			}
			yield errEvent;
		} finally {
			if (assistantContent) {
				addTurn(
					activeSession.history,
					{ role: "assistant", content: assistantContent },
					maxHistoryTurns,
				);
			}

			// Update session metrics (P1 fix)
			if (costUsd !== undefined) {
				activeSession.session.totalCostUsd += costUsd;
			}
			if (numTurns !== undefined) {
				activeSession.session.totalTurns += numTurns;
			}
			activeSession.session.runs.push({
				id: `run-${Date.now()}`,
				prompt: message.prompt.slice(0, 100),
				startedAt: nowIso(),
				costUsd,
				numTurns,
				durationSecs,
				status: runFailed ? "error" : "completed",
			});
			this.opts.store.update(sessionId, {
				runsCount: activeSession.session.runs.length,
				totalCostUsd: activeSession.session.totalCostUsd,
				totalTurns: activeSession.session.totalTurns,
			});

			activeSession.abortController = null;

			if (this.activeSessions.has(sessionId)) {
				activeSession.session.status = "active";
				this.opts.store.update(sessionId, { status: "active" });

				const idleTimeoutMs =
					activeSession.session.idleTimeoutMs ??
					this.opts.idleTimeoutMs ??
					DEFAULT_IDLE_TIMEOUT_MS;
				this._startIdleTimer(sessionId, idleTimeoutMs);
			}

			mutex.release();
		}
	}
}
