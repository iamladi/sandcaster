import { validateBearerToken } from "@sandcaster/core";
import type { MiddlewareHandler } from "hono";
import { bearerAuth } from "hono/bearer-auth";

const PUBLIC_PATHS = new Set(["/health", "/webhooks/e2b"]);

export function createAuthMiddleware(apiKey: string): MiddlewareHandler {
	const auth = bearerAuth({
		verifyToken: (token) => validateBearerToken(token, [apiKey]),
	});

	return async (c, next) => {
		if (PUBLIC_PATHS.has(c.req.path)) return next();
		return auth(c, next);
	};
}
