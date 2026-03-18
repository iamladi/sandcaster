import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SandcasterClient } from "../client.js";
import type { SandcasterEvent, Session, SessionRecord } from "../types.js";

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

describe("SandcasterClient — session methods", () => {
	describe("createSession()", () => {
		it("POSTs to {baseUrl}/sessions", async () => {
			fetchMock.mockResolvedValue(
				createSSEResponse(
					{
						type: "session_created",
						sessionId: "sess-1",
						content: "Session created",
					},
					{ type: "result", content: "done" },
				),
			);

			const client = new SandcasterClient({ baseUrl: "http://localhost:3000" });
			const request = { prompt: "do something" };
			await collectAll(client.createSession(request));

			expect(fetchMock).toHaveBeenCalledOnce();
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe("http://localhost:3000/sessions");
			expect(init.method).toBe("POST");
		});

		it("yields session_created and subsequent events from SSE", async () => {
			fetchMock.mockResolvedValue(
				createSSEResponse(
					{
						type: "session_created",
						sessionId: "sess-1",
						content: "Session created",
					},
					{ type: "assistant", content: "hello" },
					{ type: "result", content: "done" },
				),
			);

			const client = new SandcasterClient({ baseUrl: "http://localhost:3000" });
			const events = await collectAll(client.createSession({ prompt: "test" }));

			expect(events).toHaveLength(3);
			expect(events[0]).toEqual({
				type: "session_created",
				sessionId: "sess-1",
				content: "Session created",
			});
			expect(events[1]).toEqual({ type: "assistant", content: "hello" });
			expect(events[2]).toEqual({ type: "result", content: "done" });
		});

		it("sends sessionConfig in request body when provided", async () => {
			fetchMock.mockResolvedValue(
				createSSEResponse({
					type: "session_created",
					sessionId: "sess-1",
					content: "ok",
				}),
			);

			const client = new SandcasterClient({ baseUrl: "http://localhost:3000" });
			const request = {
				prompt: "test",
				sessionConfig: { idleTimeoutSecs: 300, name: "my-session" },
			};
			await collectAll(client.createSession(request));

			const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(JSON.parse(init.body as string)).toEqual(request);
		});
	});

	describe("sendSessionMessage()", () => {
		it("POSTs to {baseUrl}/sessions/:id/messages", async () => {
			fetchMock.mockResolvedValue(
				createSSEResponse({ type: "result", content: "done" }),
			);

			const client = new SandcasterClient({ baseUrl: "http://localhost:3000" });
			await collectAll(
				client.sendSessionMessage("sess-1", { prompt: "hello" }),
			);

			expect(fetchMock).toHaveBeenCalledOnce();
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe("http://localhost:3000/sessions/sess-1/messages");
			expect(init.method).toBe("POST");
		});

		it("yields SSE events from the response", async () => {
			fetchMock.mockResolvedValue(
				createSSEResponse(
					{ type: "assistant", content: "thinking..." },
					{ type: "result", content: "done" },
				),
			);

			const client = new SandcasterClient({ baseUrl: "http://localhost:3000" });
			const events = await collectAll(
				client.sendSessionMessage("sess-2", { prompt: "what is 2+2?" }),
			);

			expect(events).toHaveLength(2);
			expect(events[0]).toEqual({ type: "assistant", content: "thinking..." });
			expect(events[1]).toEqual({ type: "result", content: "done" });
		});
	});

	describe("listSessions()", () => {
		it("GETs {baseUrl}/sessions and returns parsed SessionRecord array", async () => {
			const sessions: SessionRecord[] = [
				{
					id: "sess-1",
					status: "active",
					sandboxProvider: "e2b",
					sandboxId: "sbx-123",
					createdAt: "2024-01-01T00:00:00Z",
					lastActivityAt: "2024-01-01T01:00:00Z",
					runsCount: 2,
					totalCostUsd: 0.01,
					totalTurns: 10,
				},
			];
			fetchMock.mockResolvedValue(
				new Response(JSON.stringify(sessions), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			);

			const client = new SandcasterClient({ baseUrl: "http://localhost:3000" });
			const result = await client.listSessions();

			expect(fetchMock).toHaveBeenCalledOnce();
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe("http://localhost:3000/sessions");
			expect(init.method).toBe("GET");
			expect(result).toEqual(sessions);
		});

		it("throws on non-ok response", async () => {
			fetchMock.mockResolvedValue(
				new Response(null, { status: 401, statusText: "Unauthorized" }),
			);

			const client = new SandcasterClient({ baseUrl: "http://localhost:3000" });
			await expect(client.listSessions()).rejects.toThrow("401 Unauthorized");
		});
	});

	describe("getSession()", () => {
		it("GETs {baseUrl}/sessions/:id and returns parsed Session", async () => {
			const session: Session = {
				id: "sess-1",
				status: "active",
				sandboxProvider: "e2b",
				sandboxId: "sbx-123",
				createdAt: "2024-01-01T00:00:00Z",
				lastActivityAt: "2024-01-01T01:00:00Z",
				idleTimeoutMs: 300000,
				runs: [],
				totalCostUsd: 0,
				totalTurns: 0,
			};
			fetchMock.mockResolvedValue(
				new Response(JSON.stringify(session), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			);

			const client = new SandcasterClient({ baseUrl: "http://localhost:3000" });
			const result = await client.getSession("sess-1");

			expect(fetchMock).toHaveBeenCalledOnce();
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe("http://localhost:3000/sessions/sess-1");
			expect(init.method).toBe("GET");
			expect(result).toEqual(session);
		});

		it("throws on 404 response", async () => {
			fetchMock.mockResolvedValue(
				new Response(null, { status: 404, statusText: "Not Found" }),
			);

			const client = new SandcasterClient({ baseUrl: "http://localhost:3000" });
			await expect(client.getSession("missing-id")).rejects.toThrow(
				"404 Not Found",
			);
		});
	});

	describe("deleteSession()", () => {
		it("DELETEs {baseUrl}/sessions/:id", async () => {
			fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

			const client = new SandcasterClient({ baseUrl: "http://localhost:3000" });
			await client.deleteSession("sess-1");

			expect(fetchMock).toHaveBeenCalledOnce();
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe("http://localhost:3000/sessions/sess-1");
			expect(init.method).toBe("DELETE");
		});

		it("resolves without throwing on 204 response", async () => {
			fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

			const client = new SandcasterClient({ baseUrl: "http://localhost:3000" });
			await expect(client.deleteSession("sess-1")).resolves.toBeUndefined();
		});

		it("throws on non-ok response", async () => {
			fetchMock.mockResolvedValue(
				new Response(null, { status: 404, statusText: "Not Found" }),
			);

			const client = new SandcasterClient({ baseUrl: "http://localhost:3000" });
			await expect(client.deleteSession("missing")).rejects.toThrow(
				"404 Not Found",
			);
		});
	});

	describe("attachSession()", () => {
		it("GETs {baseUrl}/sessions/:id/events and yields SSE events", async () => {
			fetchMock.mockResolvedValue(
				createSSEResponse(
					{ type: "assistant", content: "still running" },
					{ type: "result", content: "done" },
				),
			);

			const client = new SandcasterClient({ baseUrl: "http://localhost:3000" });
			const events = await collectAll(client.attachSession("sess-1"));

			expect(fetchMock).toHaveBeenCalledOnce();
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe("http://localhost:3000/sessions/sess-1/events");
			expect(init.method).toBe("GET");
			expect(events).toHaveLength(2);
			expect(events[0]).toEqual({
				type: "assistant",
				content: "still running",
			});
			expect(events[1]).toEqual({ type: "result", content: "done" });
		});
	});

	describe("Authorization header", () => {
		it("sets Authorization header on listSessions when apiKey is provided", async () => {
			fetchMock.mockResolvedValue(
				new Response(JSON.stringify([]), { status: 200 }),
			);

			const client = new SandcasterClient({
				baseUrl: "http://localhost:3000",
				apiKey: "sk-test",
			});
			await client.listSessions();

			const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			const headers = new Headers(init.headers);
			expect(headers.get("Authorization")).toBe("Bearer sk-test");
		});

		it("sets Authorization header on createSession when apiKey is provided", async () => {
			fetchMock.mockResolvedValue(
				createSSEResponse({
					type: "session_created",
					sessionId: "s1",
					content: "ok",
				}),
			);

			const client = new SandcasterClient({
				baseUrl: "http://localhost:3000",
				apiKey: "sk-test",
			});
			await collectAll(client.createSession({ prompt: "test" }));

			const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			const headers = new Headers(init.headers);
			expect(headers.get("Authorization")).toBe("Bearer sk-test");
		});
	});

	describe("session_command_result and session_expired events", () => {
		it("yields session_expired events from SSE stream", async () => {
			fetchMock.mockResolvedValue(
				createSSEResponse({
					type: "session_expired",
					sessionId: "sess-1",
					content: "Session expired due to idle timeout",
				}),
			);

			const client = new SandcasterClient({ baseUrl: "http://localhost:3000" });
			const events = await collectAll(client.attachSession("sess-1"));

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({
				type: "session_expired",
				sessionId: "sess-1",
				content: "Session expired due to idle timeout",
			});
		});

		it("yields session_command_result events from SSE stream", async () => {
			fetchMock.mockResolvedValue(
				createSSEResponse({
					type: "session_command_result",
					command: "ls",
					content: "file1.txt",
					data: ["file1.txt"],
				}),
			);

			const client = new SandcasterClient({ baseUrl: "http://localhost:3000" });
			const events = await collectAll(client.attachSession("sess-1"));

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({
				type: "session_command_result",
				command: "ls",
				content: "file1.txt",
				data: ["file1.txt"],
			});
		});
	});
});
