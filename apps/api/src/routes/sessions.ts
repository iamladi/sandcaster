import type { SessionManager } from "@sandcaster/core";
import {
	executeCommand,
	loadConfig,
	parseSessionCommand,
	SessionCreateRequestSchema,
	SessionError,
	SessionMessageRequestSchema,
} from "@sandcaster/core";
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";

export function registerSessionRoutes(
	app: Hono,
	opts: {
		sessionManager: SessionManager;
	},
): void {
	const { sessionManager } = opts;

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

		const config = loadConfig() ?? undefined;

		try {
			const { events } = await sessionManager.createSession(
				parsed.data,
				config,
			);

			return streamSSE(
				c,
				async (stream) => {
					c.header("Content-Encoding", "Identity");
					for await (const event of events) {
						await stream.writeSSE({
							event: event.type,
							data: JSON.stringify(event),
						});
					}
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

		// Check if the prompt is a slash-command
		const command = parseSessionCommand(parsed.data.prompt);
		if (command) {
			const activeSession = sessionManager.getActiveSession(sessionId);
			if (!activeSession) {
				return c.json(
					{ error: "Session not found", code: "SESSION_NOT_FOUND" },
					404,
				);
			}

			return streamSSE(c, async (stream) => {
				c.header("Content-Encoding", "Identity");
				for await (const event of executeCommand(activeSession, command)) {
					await stream.writeSSE({
						event: event.type,
						data: JSON.stringify(event),
					});
				}
			});
		}

		try {
			const events = await sessionManager.sendMessage(sessionId, {
				prompt: parsed.data.prompt,
				files: parsed.data.files,
			});

			return streamSSE(c, async (stream) => {
				c.header("Content-Encoding", "Identity");
				for await (const event of events) {
					await stream.writeSSE({
						event: event.type,
						data: JSON.stringify(event),
					});
				}
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
		const limitParam = c.req.query("limit");
		const limit = limitParam ? Math.min(Number(limitParam) || 50, 200) : 50;
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

			const clientFn = (
				event: import("@sandcaster/core").SandcasterEvent,
			): boolean => {
				pending.push(event);
				notify?.();
				return true;
			};
			activeSession.clients.add(clientFn);

			const heartbeat = setInterval(async () => {
				try {
					await stream.writeSSE({ event: "ping", data: "" });
				} catch {
					clearInterval(heartbeat);
				}
			}, 15_000);

			try {
				while (true) {
					if (pending.length > 0) {
						// biome-ignore lint/style/noNonNullAssertion: length checked
						const event = pending.shift()!;
						await stream.writeSSE({
							event: event.type,
							data: JSON.stringify(event),
						});
						if (event.type === "session_expired" || event.type === "error") {
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
				clearInterval(heartbeat);
				activeSession.clients.delete(clientFn);
			}
		});
	});
}
