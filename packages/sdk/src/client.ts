import { parseSSEStream } from "./stream.js";
import type {
	QueryRequest,
	Run,
	SandcasterClientOptions,
	SandcasterEvent,
	Session,
	SessionCreateRequest,
	SessionMessageRequest,
	SessionRecord,
} from "./types.js";

// ---------------------------------------------------------------------------
// SandcasterClient
// ---------------------------------------------------------------------------

export class SandcasterClient {
	readonly #baseUrl: string;
	readonly #apiKey: string | undefined;
	readonly #activeControllers = new Set<AbortController>();

	constructor(options: SandcasterClientOptions) {
		this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
		this.#apiKey = options.apiKey;
	}

	// -------------------------------------------------------------------------
	// Private helpers
	// -------------------------------------------------------------------------

	#authHeaders(): Record<string, string> {
		if (this.#apiKey) {
			return { Authorization: `Bearer ${this.#apiKey}` };
		}
		return {};
	}

	/**
	 * Build an AsyncIterable that lazily opens an SSE connection on first pull.
	 * Handles abort-controller wiring, cleanup, and generator lifecycle.
	 */
	#makeSSEIterable(
		fetchFn: (signal: AbortSignal) => Promise<Response>,
		options?: { signal?: AbortSignal },
	): AsyncIterable<SandcasterEvent> {
		const self = this;
		return {
			[Symbol.asyncIterator](): AsyncIterator<SandcasterEvent> {
				const controller = new AbortController();
				self.#activeControllers.add(controller);

				let abortHandler: (() => void) | null = null;
				if (options?.signal) {
					if (options.signal.aborted) {
						controller.abort(options.signal.reason);
					} else {
						abortHandler = () => controller.abort(options.signal?.reason);
						options.signal.addEventListener("abort", abortHandler, {
							once: true,
						});
					}
				}

				const cleanup = () => {
					self.#activeControllers.delete(controller);
					if (abortHandler) {
						options?.signal?.removeEventListener("abort", abortHandler);
						abortHandler = null;
					}
				};

				let generatorPromise: Promise<AsyncGenerator<SandcasterEvent>> | null =
					null;

				const ensureGenerator = (): Promise<
					AsyncGenerator<SandcasterEvent>
				> => {
					if (!generatorPromise) {
						generatorPromise = (async () => {
							const response = await fetchFn(controller.signal);

							if (!response.ok) {
								throw new Error(`${response.status} ${response.statusText}`);
							}

							return parseSSEStream(
								response.body as ReadableStream<Uint8Array>,
								controller.signal,
							);
						})();
					}
					return generatorPromise;
				};

				return {
					async next(): Promise<IteratorResult<SandcasterEvent>> {
						try {
							const gen = await ensureGenerator();
							const result = await gen.next();
							if (result.done) {
								cleanup();
							}
							return result;
						} catch (error) {
							cleanup();
							throw error;
						}
					},
					async return(
						value?: unknown,
					): Promise<IteratorResult<SandcasterEvent>> {
						cleanup();
						if (generatorPromise) {
							try {
								const gen = await generatorPromise;
								await gen.return(value);
							} catch {
								// generatorPromise may have rejected — return() must succeed
							}
						}
						return { done: true, value: undefined };
					},
					async throw(
						error?: unknown,
					): Promise<IteratorResult<SandcasterEvent>> {
						cleanup();
						if (generatorPromise) {
							try {
								const gen = await generatorPromise;
								return gen.throw(error);
							} catch {
								// generatorPromise rejected; fall through
							}
						}
						throw error;
					},
				};
			},
		};
	}

	// -------------------------------------------------------------------------
	// query()
	// -------------------------------------------------------------------------

	query(
		request: QueryRequest,
		options?: { signal?: AbortSignal },
	): AsyncIterable<SandcasterEvent> {
		return this.#makeSSEIterable(
			(signal) =>
				fetch(`${this.#baseUrl}/query`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						...this.#authHeaders(),
					},
					body: JSON.stringify(request),
					signal,
				}),
			options,
		);
	}

	// -------------------------------------------------------------------------
	// health()
	// -------------------------------------------------------------------------

	async health(): Promise<{ status: string }> {
		const response = await fetch(`${this.#baseUrl}/health`, {
			method: "GET",
			headers: { ...this.#authHeaders() },
		});

		if (!response.ok) {
			throw new Error(`${response.status} ${response.statusText}`);
		}

		return response.json() as Promise<{ status: string }>;
	}

	// -------------------------------------------------------------------------
	// listRuns()
	// -------------------------------------------------------------------------

	async listRuns(): Promise<Run[]> {
		const response = await fetch(`${this.#baseUrl}/runs`, {
			method: "GET",
			headers: { ...this.#authHeaders() },
		});

		if (!response.ok) {
			throw new Error(`${response.status} ${response.statusText}`);
		}

		return response.json() as Promise<Run[]>;
	}

	// -------------------------------------------------------------------------
	// createSession()
	// -------------------------------------------------------------------------

	createSession(
		request: SessionCreateRequest,
		options?: { signal?: AbortSignal },
	): AsyncIterable<SandcasterEvent> {
		return this.#makeSSEIterable(
			(signal) =>
				fetch(`${this.#baseUrl}/sessions`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						...this.#authHeaders(),
					},
					body: JSON.stringify(request),
					signal,
				}),
			options,
		);
	}

	// -------------------------------------------------------------------------
	// sendSessionMessage()
	// -------------------------------------------------------------------------

	sendSessionMessage(
		sessionId: string,
		message: SessionMessageRequest,
		options?: { signal?: AbortSignal },
	): AsyncIterable<SandcasterEvent> {
		return this.#makeSSEIterable(
			(signal) =>
				fetch(`${this.#baseUrl}/sessions/${sessionId}/messages`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						...this.#authHeaders(),
					},
					body: JSON.stringify(message),
					signal,
				}),
			options,
		);
	}

	// -------------------------------------------------------------------------
	// attachSession()
	// -------------------------------------------------------------------------

	attachSession(
		id: string,
		options?: { signal?: AbortSignal },
	): AsyncIterable<SandcasterEvent> {
		return this.#makeSSEIterable(
			(signal) =>
				fetch(`${this.#baseUrl}/sessions/${id}/events`, {
					method: "GET",
					headers: { ...this.#authHeaders() },
					signal,
				}),
			options,
		);
	}

	// -------------------------------------------------------------------------
	// listSessions()
	// -------------------------------------------------------------------------

	async listSessions(): Promise<SessionRecord[]> {
		const response = await fetch(`${this.#baseUrl}/sessions`, {
			method: "GET",
			headers: { ...this.#authHeaders() },
		});

		if (!response.ok) {
			throw new Error(`${response.status} ${response.statusText}`);
		}

		return response.json() as Promise<SessionRecord[]>;
	}

	// -------------------------------------------------------------------------
	// getSession()
	// -------------------------------------------------------------------------

	async getSession(id: string): Promise<Session> {
		const response = await fetch(`${this.#baseUrl}/sessions/${id}`, {
			method: "GET",
			headers: { ...this.#authHeaders() },
		});

		if (!response.ok) {
			throw new Error(`${response.status} ${response.statusText}`);
		}

		return response.json() as Promise<Session>;
	}

	// -------------------------------------------------------------------------
	// deleteSession()
	// -------------------------------------------------------------------------

	async deleteSession(id: string): Promise<void> {
		const response = await fetch(`${this.#baseUrl}/sessions/${id}`, {
			method: "DELETE",
			headers: { ...this.#authHeaders() },
		});

		if (!response.ok) {
			throw new Error(`${response.status} ${response.statusText}`);
		}
	}

	// -------------------------------------------------------------------------
	// Symbol.asyncDispose
	// -------------------------------------------------------------------------

	async [Symbol.asyncDispose](): Promise<void> {
		for (const controller of this.#activeControllers) {
			controller.abort();
		}
		this.#activeControllers.clear();
	}
}
