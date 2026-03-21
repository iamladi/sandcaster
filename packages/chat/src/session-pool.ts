import { Mutex } from "@sandcaster/core";

export class SessionPool {
	// Maps thread key → session ID
	private readonly sessions = new Map<string, string>();
	// Reverse index: session ID → thread key (for O(1) removal by session ID)
	private readonly sessionToThread = new Map<string, string>();
	// Per-thread mutex for serializing concurrent messages
	private readonly mutexes = new Map<string, Mutex>();

	/** Get existing session ID for a thread, or undefined */
	resolve(threadKey: string): string | undefined {
		return this.sessions.get(threadKey);
	}

	/** Store thread → session mapping */
	register(threadKey: string, sessionId: string): void {
		// Remove stale reverse entry if this thread previously had a different session
		const prev = this.sessions.get(threadKey);
		if (prev !== undefined) {
			this.sessionToThread.delete(prev);
		}
		this.sessions.set(threadKey, sessionId);
		this.sessionToThread.set(sessionId, threadKey);
	}

	/** Remove mapping for a thread */
	remove(threadKey: string): void {
		const sessionId = this.sessions.get(threadKey);
		if (sessionId !== undefined) {
			this.sessionToThread.delete(sessionId);
		}
		this.sessions.delete(threadKey);
		this.mutexes.delete(threadKey);
	}

	/** Remove mapping by session ID (used for expiry callback) */
	removeBySessionId(sessionId: string): void {
		const threadKey = this.sessionToThread.get(sessionId);
		if (threadKey !== undefined) {
			this.sessions.delete(threadKey);
			this.mutexes.delete(threadKey);
			this.sessionToThread.delete(sessionId);
		}
	}

	/** Build platform-specific thread key */
	static makeKey(
		platform: string,
		channelId: string,
		threadId: string,
	): string {
		return `${platform}:${channelId}:${threadId}`;
	}

	/** Acquire per-thread mutex. Returns release function. */
	async acquireMutex(threadKey: string): Promise<() => void> {
		let mutex = this.mutexes.get(threadKey);
		if (!mutex) {
			mutex = new Mutex();
			this.mutexes.set(threadKey, mutex);
		}
		await mutex.acquire();
		return () => {
			mutex.release();
		};
	}
}
