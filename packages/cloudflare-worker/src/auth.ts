import type { Context, Next } from "hono";
import { validateToken } from "./sandbox-object.js";

// ---------------------------------------------------------------------------
// authMiddleware — validates ephemeral Bearer token against session state
// ---------------------------------------------------------------------------

export async function authMiddleware(
	c: Context,
	next: Next,
): Promise<Response | undefined> {
	const sessionId = c.req.param("id");
	const authHeader = c.req.header("Authorization");

	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		return c.json({ error: "Unauthorized: missing Bearer token" }, 401);
	}

	const token = authHeader.slice("Bearer ".length);

	if (!sessionId || !validateToken(sessionId, token)) {
		return c.json({ error: "Unauthorized: invalid token" }, 401);
	}

	await next();
}
