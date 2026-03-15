import { Hono } from "hono";
import { authMiddleware } from "./auth.js";
import {
	createSession,
	deleteSession,
	execCommand,
	readFile,
	writeFile,
} from "./sandbox-object.js";

// ---------------------------------------------------------------------------
// Hono router — Sandcaster-compatible Worker endpoints
// ---------------------------------------------------------------------------

type Bindings = { API_KEY: string };

export const app = new Hono<{ Bindings: Bindings }>();

// ---------------------------------------------------------------------------
// POST /sandbox/create
// Generate ephemeral token and create sandbox session
// ---------------------------------------------------------------------------

app.post("/sandbox/create", async (c) => {
	// Require API key via X-API-Key header or Authorization: Bearer <key>
	const authHeader = c.req.header("Authorization");
	const apiKey =
		c.req.header("X-API-Key") ??
		(authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined);

	const expectedKey = c.env.API_KEY;
	if (!expectedKey || !apiKey || apiKey !== expectedKey) {
		return c.json({ error: "Unauthorized: missing or invalid API key" }, 401);
	}

	const sessionId = crypto.randomUUID();
	const token = crypto.randomUUID();

	createSession(sessionId, token);

	return c.json({ sessionId, token });
});

// ---------------------------------------------------------------------------
// POST /sandbox/:id/files/write
// Write a file to the sandbox (requires auth)
// ---------------------------------------------------------------------------

app.post("/sandbox/:id/files/write", authMiddleware, async (c) => {
	const sessionId = c.req.param("id") ?? "";
	const { path, content, encoding } = (await c.req.json()) as {
		path: string;
		content: string;
		encoding?: string;
	};

	const resolved = encoding === "base64" ? atob(content) : content;
	writeFile(sessionId, path, resolved);

	return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GET /sandbox/:id/files/read?path=<path>
// Read a file from the sandbox (requires auth)
// ---------------------------------------------------------------------------

app.get("/sandbox/:id/files/read", authMiddleware, async (c) => {
	const sessionId = c.req.param("id") ?? "";
	const path = c.req.query("path") ?? "";

	const content = readFile(sessionId, path) ?? "";

	return c.json({ content });
});

// ---------------------------------------------------------------------------
// POST /sandbox/:id/exec
// Execute a command in the sandbox (requires auth)
// Returns { stdout, stderr, exitCode }
// ---------------------------------------------------------------------------

app.post("/sandbox/:id/exec", authMiddleware, async (c) => {
	const sessionId = c.req.param("id") ?? "";
	const { cmd, timeoutMs } = (await c.req.json()) as {
		cmd: string;
		timeoutMs?: number;
	};

	const result = await execCommand(sessionId, cmd, timeoutMs);

	return c.json(result);
});

// ---------------------------------------------------------------------------
// POST /sandbox/:id/kill
// Kill the sandbox session (requires auth, idempotent)
// ---------------------------------------------------------------------------

app.post("/sandbox/:id/kill", authMiddleware, async (c) => {
	const sessionId = c.req.param("id") ?? "";

	deleteSession(sessionId);

	return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Worker default export (for Cloudflare Workers runtime)
// ---------------------------------------------------------------------------

export default {
	fetch: app.fetch,
};
