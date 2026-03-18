import type { SandcasterEvent, SessionManager } from "@sandcaster/core";
import {
	loadConfig,
	parseSessionCommand,
	SessionCreateRequestSchema,
	SessionError,
	SessionMessageRequestSchema,
} from "@sandcaster/core";
import type { Context, Hono } from "hono";
import type { SSEStreamingApi } from "hono/streaming";
import { streamSSE } from "hono/streaming";

/** Drain an event iterable into an SSE stream. */
async function _drainEventsToSSE(
	c: Context,
	stream: SSEStreamingApi,
	events: AsyncIterable<SandcasterEvent>,
): Promise<void> {
	c.header("Content-Encoding", "Identity");
	for await (const event of events) {
		await stream.writeSSE({
			event: event.type,
			data: JSON.stringify(event),
		});
	}
}

/** Parse a limit query param consistently with runs.ts */
function _parseLimit(raw: string | undefined): number {
	const n = Number.parseInt(raw ?? "50", 10);
	return Number.isNaN(n) ? 50 : Math.max(1, Math.min(n, 200));
}

export function registerSessionRoutes(
	app: Hono,
	opts: {
		sessionManager: SessionManager;
	},
): void {
	const { sessionManager } = opts;
	const config = loadConfig() ?? undefined;

	// -------------------------------------------------------------------------
	// POST /sessions
	// -------------------------------------------------------------------------

	app.post("/sessions", async (c) => {
		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "Invalid JSON" }, 400);
		}

		const parsed = SessionCreateRequestSchema.safeParse(body);
		if (!parsed.success) {
			return c.json(
				{ error: "Validation failed", details: parsed.error.issues },
				400,
			);
		}

		try {
			const { events } = await sessionManager.createSession(
				parsed.data,
				config,
			);

			return streamSSE(
				c,
				async (stream) => {
					await _drainEventsToSSE(c, stream, events);
				},
				async (err) => {
					console.error("Session SSE error:", err);
				},
			);
		} catch (err) {
			if (err instanceof SessionError) {
				const status = err.code === "SESSION_CAPACITY_EXCEEDED" ? 503 : 500;
				return c.json(
					{ error: err.message, code: err.code },
					status as 503 | 500,
				);
			}
			throw err;
		}
	});

	// -------------------------------------------------------------------------
	// POST /sessions/:id/messages
	// -------------------------------------------------------------------------

	app.post("/sessions/:id/messages", async (c) => {
		const sessionId = c.req.param("id");

		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "Invalid JSON" }, 400);
		}

		const parsed = SessionMessageRequestSchema.safeParse(body);
		if (!parsed.success) {
			return c.json(
				{ error: "Validation failed", details: parsed.error.issues },
				400,
			);
		}

		// Check if the prompt is a recognized slash-command — only route known commands
		if (parseSessionCommand(parsed.data.prompt)) {
			try {
				const events = sessionManager.handleCommand(
					sessionId,
					parsed.data.prompt,
				);
				return streamSSE(c, async (stream) => {
					await _drainEventsToSSE(c, stream, events);
				});
			} catch (err) {
				if (err instanceof SessionError) {
					const statusMap: Record<string, number> = {
						SESSION_BUSY: 409,
						SESSION_NOT_FOUND: 404,
					};
					return c.json(
						{ error: err.message, code: err.code },
						(statusMap[err.code] ?? 500) as 409 | 404 | 500,
					);
				}
				throw err;
			}
		}

		try {
			const events = await sessionManager.sendMessage(sessionId, {
				prompt: parsed.data.prompt,
				files: parsed.data.files,
			});

			return streamSSE(c, async (stream) => {
				await _drainEventsToSSE(c, stream, events);
			});
		} catch (err) {
			if (err instanceof SessionError) {
				const statusMap: Record<string, number> = {
					SESSION_BUSY: 409,
					SESSION_NOT_FOUND: 404,
					SESSION_EXPIRED: 410,
				};
				return c.json(
					{ error: err.message, code: err.code },
					(statusMap[err.code] ?? 500) as 409 | 404 | 410 | 500,
				);
			}
			throw err;
		}
	});

	// -------------------------------------------------------------------------
	// GET /sessions
	// -------------------------------------------------------------------------

	app.get("/sessions", (c) => {
		const limit = _parseLimit(c.req.query("limit"));
		const sessions = sessionManager.listSessions(limit);
		return c.json(sessions);
	});

	// -------------------------------------------------------------------------
	// GET /sessions/:id
	// -------------------------------------------------------------------------

	app.get("/sessions/:id", (c) => {
		const session = sessionManager.getSession(c.req.param("id"));
		if (!session) {
			return c.json({ error: "Session not found" }, 404);
		}
		return c.json(session);
	});

	// -------------------------------------------------------------------------
	// DELETE /sessions/:id
	// -------------------------------------------------------------------------

	app.delete("/sessions/:id", async (c) => {
		await sessionManager.deleteSession(c.req.param("id"));
		return c.body(null, 204);
	});

	// -------------------------------------------------------------------------
	// GET /sessions/:id/events — attach to session SSE stream
	// -------------------------------------------------------------------------

	app.get("/sessions/:id/events", async (c) => {
		const activeSession = sessionManager.getActiveSession(c.req.param("id"));
		if (!activeSession) {
			return c.json({ error: "Session not found" }, 404);
		}

		return streamSSE(c, async (stream) => {
			c.header("Content-Encoding", "Identity");

			const pending: Array<import("@sandcaster/core").SandcasterEvent> = [];
			let notify: (() => void) | null = null;
			let closed = false;

			const clientFn = (
				event: import("@sandcaster/core").SandcasterEvent,
			): boolean => {
				if (closed) return false;
				pending.push(event);
				notify?.();
				return true;
			};
			activeSession.clients.add(clientFn);

			// Listen for client disconnect to unblock the drain loop
			const abortSignal = c.req.raw.signal;
			const onAbort = () => {
				closed = true;
				notify?.();
			};
			abortSignal.addEventListener("abort", onAbort, { once: true });

			const heartbeat = setInterval(async () => {
				try {
					if (!closed) {
						await stream.writeSSE({ event: "ping", data: "" });
					}
				} catch {
					closed = true;
					clearInterval(heartbeat);
					notify?.();
				}
			}, 15_000);

			try {
				while (!closed) {
					if (pending.length > 0) {
						// biome-ignore lint/style/noNonNullAssertion: length checked
						const event = pending.shift()!;
						await stream.writeSSE({
							event: event.type,
							data: JSON.stringify(event),
						});
						if (event.type === "session_expired") {
							break;
						}
					} else {
						await new Promise<void>((r) => {
							notify = r;
						});
						notify = null;
					}
				}
			} finally {
				closed = true;
				clearInterval(heartbeat);
				abortSignal.removeEventListener("abort", onAbort);
				activeSession.clients.delete(clientFn);
			}
		});
	});
}
