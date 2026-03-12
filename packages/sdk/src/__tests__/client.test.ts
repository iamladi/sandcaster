import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SandcasterClient } from "../client.js";
import type { Run, SandcasterEvent } from "../types.js";

// ---------------------------------------------------------------------------
// Test helper: creates a fake Response with an SSE body
// ---------------------------------------------------------------------------

function createSSEResponse(
	...events: Array<{ type: string; [key: string]: unknown }>
): Response {
	const encoder = new TextEncoder();
	const lines = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(encoder.encode(lines));
			controller.close();
		},
	});
	return new Response(body, {
		status: 200,
		headers: { "Content-Type": "text/event-stream" },
	});
}

async function collectAll(
	iterable: AsyncIterable<SandcasterEvent>,
): Promise<SandcasterEvent[]> {
	const results: SandcasterEvent[] = [];
	for await (const event of iterable) {
		results.push(event);
	}
	return results;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	fetchMock = vi.fn();
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SandcasterClient", () => {
	describe("query()", () => {
		it("POSTs to {baseUrl}/query with JSON body", async () => {
			fetchMock.mockResolvedValue(
				createSSEResponse({ type: "result", content: "done" }),
			);

			const client = new SandcasterClient({ baseUrl: "http://localhost:3000" });
			const request = { prompt: "do something" };
			await collectAll(client.query(request));

			expect(fetchMock).toHaveBeenCalledOnce();
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe("http://localhost:3000/query");
			expect(init.method).toBe("POST");
			expect(JSON.parse(init.body as string)).toEqual(request);
		});

		it("sets Content-Type application/json header", async () => {
			fetchMock.mockResolvedValue(
				createSSEResponse({ type: "result", content: "done" }),
			);

			const client = new SandcasterClient({ baseUrl: "http://localhost:3000" });
			await collectAll(client.query({ prompt: "test" }));

			const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			const headers = new Headers(init.headers);
			expect(headers.get("Content-Type")).toBe("application/json");
		});

		it("sets Authorization header when apiKey is provided", async () => {
			fetchMock.mockResolvedValue(
				createSSEResponse({ type: "result", content: "done" }),
			);

			const client = new SandcasterClient({
				baseUrl: "http://localhost:3000",
				apiKey: "sk-test-key",
			});
			await collectAll(client.query({ prompt: "test" }));

			const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			const headers = new Headers(init.headers);
			expect(headers.get("Authorization")).toBe("Bearer sk-test-key");
		});

		it("does NOT set Authorization header when apiKey is omitted", async () => {
			fetchMock.mockResolvedValue(
				createSSEResponse({ type: "result", content: "done" }),
			);

			const client = new SandcasterClient({ baseUrl: "http://localhost:3000" });
			await collectAll(client.query({ prompt: "test" }));

			const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			const headers = new Headers(init.headers);
			expect(headers.get("Authorization")).toBeNull();
		});

		it("yields typed SandcasterEvent objects from SSE stream", async () => {
			fetchMock.mockResolvedValue(
				createSSEResponse(
					{ type: "system", content: "started" },
					{ type: "assistant", content: "hello" },
					{ type: "result", content: "done", costUsd: 0.001 },
				),
			);

			const client = new SandcasterClient({ baseUrl: "http://localhost:3000" });
			const events = await collectAll(client.query({ prompt: "test" }));

			expect(events).toHaveLength(3);
			expect(events[0]).toEqual({ type: "system", content: "started" });
			expect(events[1]).toEqual({ type: "assistant", content: "hello" });
			expect(events[2]).toEqual({
				type: "result",
				content: "done",
				costUsd: 0.001,
			});
		});

		it("throws on HTTP error response (4xx/5xx)", async () => {
			fetchMock.mockResolvedValue(
				new Response(null, { status: 404, statusText: "Not Found" }),
			);

			const client = new SandcasterClient({ baseUrl: "http://localhost:3000" });

			await expect(
				collectAll(client.query({ prompt: "test" })),
			).rejects.toThrow("404 Not Found");
		});

		it("stops iteration when caller AbortSignal is aborted", async () => {
			const encoder = new TextEncoder();
			const events = [
				{ type: "system", content: "first" },
				{ type: "system", content: "second" },
				{ type: "system", content: "third" },
			];

			// Enqueue events individually so abort can interrupt between them
			let eventIndex = 0;
			const body = new ReadableStream<Uint8Array>({
				pull(ctrl) {
					if (eventIndex < events.length) {
						ctrl.enqueue(
							encoder.encode(`data: ${JSON.stringify(events[eventIndex])}\n\n`),
						);
						eventIndex++;
					} else {
						ctrl.close();
					}
				},
			});

			fetchMock.mockResolvedValue(
				new Response(body, {
					status: 200,
					headers: { "Content-Type": "text/event-stream" },
				}),
			);

			const controller = new AbortController();
			const client = new SandcasterClient({ baseUrl: "http://localhost:3000" });
			const collected: SandcasterEvent[] = [];

			for await (const event of client.query(
				{ prompt: "test" },
				{ signal: controller.signal },
			)) {
				collected.push(event);
				controller.abort();
			}

			// Must have stopped early — fewer than all 3 events
			expect(collected.length).toBeLessThan(3);
			expect(collected[0]).toEqual({ type: "system", content: "first" });
		});

		it("strips trailing slash from baseUrl when building URLs", async () => {
			fetchMock.mockResolvedValue(
				createSSEResponse({ type: "result", content: "done" }),
			);

			const client = new SandcasterClient({
				baseUrl: "http://localhost:3000/",
			});
			await collectAll(client.query({ prompt: "test" }));

			const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe("http://localhost:3000/query");
		});
	});

	describe("health()", () => {
		it("GETs {baseUrl}/health and returns parsed JSON", async () => {
			fetchMock.mockResolvedValue(
				new Response(JSON.stringify({ status: "ok" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			);

			const client = new SandcasterClient({ baseUrl: "http://localhost:3000" });
			const result = await client.health();

			expect(fetchMock).toHaveBeenCalledOnce();
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe("http://localhost:3000/health");
			expect(init.method).toBe("GET");
			expect(result).toEqual({ status: "ok" });
		});

		it("sets Authorization header when apiKey is provided", async () => {
			fetchMock.mockResolvedValue(
				new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
			);

			const client = new SandcasterClient({
				baseUrl: "http://localhost:3000",
				apiKey: "my-key",
			});
			await client.health();

			const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			const headers = new Headers(init.headers);
			expect(headers.get("Authorization")).toBe("Bearer my-key");
		});

		it("throws on non-ok response", async () => {
			fetchMock.mockResolvedValue(
				new Response(null, { status: 503, statusText: "Service Unavailable" }),
			);

			const client = new SandcasterClient({ baseUrl: "http://localhost:3000" });
			await expect(client.health()).rejects.toThrow("503 Service Unavailable");
		});
	});

	describe("listRuns()", () => {
		it("GETs {baseUrl}/runs and returns parsed Run array", async () => {
			const runs: Run[] = [
				{
					id: "run-1",
					prompt: "test",
					status: "completed",
					startedAt: "2024-01-01T00:00:00Z",
					filesCount: 0,
				},
			];
			fetchMock.mockResolvedValue(
				new Response(JSON.stringify(runs), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			);

			const client = new SandcasterClient({ baseUrl: "http://localhost:3000" });
			const result = await client.listRuns();

			expect(fetchMock).toHaveBeenCalledOnce();
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe("http://localhost:3000/runs");
			expect(init.method).toBe("GET");
			expect(result).toEqual(runs);
		});

		it("sets Authorization header when apiKey is provided", async () => {
			fetchMock.mockResolvedValue(
				new Response(JSON.stringify([]), { status: 200 }),
			);

			const client = new SandcasterClient({
				baseUrl: "http://localhost:3000",
				apiKey: "my-key",
			});
			await client.listRuns();

			const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			const headers = new Headers(init.headers);
			expect(headers.get("Authorization")).toBe("Bearer my-key");
		});

		it("throws on non-ok response", async () => {
			fetchMock.mockResolvedValue(
				new Response(null, { status: 401, statusText: "Unauthorized" }),
			);

			const client = new SandcasterClient({ baseUrl: "http://localhost:3000" });
			await expect(client.listRuns()).rejects.toThrow("401 Unauthorized");
		});
	});

	describe("iterator return()", () => {
		it("does not throw when generatorPromise rejects", async () => {
			fetchMock.mockRejectedValue(new Error("network failure"));

			const client = new SandcasterClient({ baseUrl: "http://localhost:3000" });
			const iterable = client.query({ prompt: "test" });
			const iterator = iterable[Symbol.asyncIterator]();

			// Trigger the generator promise by calling next() — it will reject
			await expect(iterator.next()).rejects.toThrow("network failure");

			// return() should NOT throw even though generatorPromise rejected
			const result = await iterator.return();
			expect(result).toEqual({ done: true, value: undefined });
		});
	});

	describe("dispose (Symbol.asyncDispose)", () => {
		it("aborts in-flight query() streams on dispose", async () => {
			// Use a stream that never ends — we dispose before it finishes
			let _streamController: ReadableStreamDefaultController<Uint8Array>;
			const encoder = new TextEncoder();

			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					_streamController = controller;
					// Emit one event then pause
					controller.enqueue(
						encoder.encode(
							`data: ${JSON.stringify({ type: "system", content: "first" })}\n\n`,
						),
					);
				},
			});

			fetchMock.mockResolvedValue(
				new Response(body, {
					status: 200,
					headers: { "Content-Type": "text/event-stream" },
				}),
			);

			const client = new SandcasterClient({ baseUrl: "http://localhost:3000" });
			const collected: SandcasterEvent[] = [];

			const iterationPromise = (async () => {
				for await (const event of client.query({ prompt: "test" })) {
					collected.push(event);
					// After first event, dispose the client (abort all in-flight)
					await client[Symbol.asyncDispose]();
				}
			})();

			await iterationPromise;

			// Only the first event should have been collected before abort
			expect(collected).toHaveLength(1);
			expect(collected[0]).toEqual({ type: "system", content: "first" });
		});
	});
});
