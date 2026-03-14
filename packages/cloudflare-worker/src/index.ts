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

export const app = new Hono();

// ---------------------------------------------------------------------------
// POST /sandbox/create
// Generate ephemeral token and create sandbox session
// ---------------------------------------------------------------------------

app.post("/sandbox/create", async (c) => {
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
	const sessionId = c.req.param("id");
	const { path, content } = (await c.req.json()) as {
		path: string;
		content: string;
	};

	writeFile(sessionId, path, content);

	return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GET /sandbox/:id/files/read?path=<path>
// Read a file from the sandbox (requires auth)
// ---------------------------------------------------------------------------

app.get("/sandbox/:id/files/read", authMiddleware, async (c) => {
	const sessionId = c.req.param("id");
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
	const sessionId = c.req.param("id");
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
	const sessionId = c.req.param("id");

	deleteSession(sessionId);

	return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Worker default export (for Cloudflare Workers runtime)
// ---------------------------------------------------------------------------

export default {
	fetch: app.fetch,
};
