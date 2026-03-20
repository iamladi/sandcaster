import { Mutex } from "@sandcaster/core";

export class SessionPool {
	// Maps thread key → session ID
	private readonly sessions = new Map<string, string>();
	// Per-thread mutex for serializing concurrent messages
	private readonly mutexes = new Map<string, Mutex>();

	/** Get existing session ID for a thread, or undefined */
	resolve(threadKey: string): string | undefined {
		return this.sessions.get(threadKey);
	}

	/** Store thread → session mapping */
	register(threadKey: string, sessionId: string): void {
		this.sessions.set(threadKey, sessionId);
	}

	/** Remove mapping for a thread */
	remove(threadKey: string): void {
		this.sessions.delete(threadKey);
		this.mutexes.delete(threadKey);
	}

	/** Remove mapping by session ID (used for expiry callback) */
	removeBySessionId(sessionId: string): void {
		for (const [key, value] of this.sessions) {
			if (value === sessionId) {
				this.sessions.delete(key);
				this.mutexes.delete(key);
				return;
			}
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
