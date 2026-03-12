import { parseSSEStream } from "./stream.js";
import type {
	QueryRequest,
	Run,
	SandcasterClientOptions,
	SandcasterEvent,
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

	// -------------------------------------------------------------------------
	// query()
	// -------------------------------------------------------------------------

	query(
		request: QueryRequest,
		options?: { signal?: AbortSignal },
	): AsyncIterable<SandcasterEvent> {
		const self = this;
		return {
			[Symbol.asyncIterator](): AsyncIterator<SandcasterEvent> {
				const controller = new AbortController();
				self.#activeControllers.add(controller);

				// Link external signal to internal controller
				if (options?.signal) {
					if (options.signal.aborted) {
						controller.abort();
					} else {
						options.signal.addEventListener(
							"abort",
							() => controller.abort(options.signal?.reason),
							{ once: true },
						);
					}
				}

				let generator: AsyncGenerator<SandcasterEvent> | null = null;
				let started = false;

				const getGenerator = async (): Promise<
					AsyncGenerator<SandcasterEvent>
				> => {
					const response = await fetch(`${self.#baseUrl}/query`, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							...self.#authHeaders(),
						},
						body: JSON.stringify(request),
						signal: controller.signal,
					});

					if (!response.ok) {
						throw new Error(`${response.status} ${response.statusText}`);
					}

					return parseSSEStream(
						response.body as ReadableStream<Uint8Array>,
						controller.signal,
					);
				};

				return {
					async next(): Promise<IteratorResult<SandcasterEvent>> {
						if (!started) {
							started = true;
							generator = await getGenerator();
						}

						const result = await generator?.next();
						if (result.done) {
							self.#activeControllers.delete(controller);
						}
						return result;
					},
					async return(
						value?: unknown,
					): Promise<IteratorResult<SandcasterEvent>> {
						self.#activeControllers.delete(controller);
						if (generator) {
							await generator.return(value);
						}
						return { done: true, value: undefined };
					},
					async throw(
						error?: unknown,
					): Promise<IteratorResult<SandcasterEvent>> {
						self.#activeControllers.delete(controller);
						if (generator) {
							return generator.throw(error);
						}
						throw error;
					},
				};
			},
		};
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
	// Symbol.asyncDispose
	// -------------------------------------------------------------------------

	async [Symbol.asyncDispose](): Promise<void> {
		for (const controller of this.#activeControllers) {
			controller.abort();
		}
		this.#activeControllers.clear();
	}
}
