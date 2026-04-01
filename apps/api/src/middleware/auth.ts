import {
	MIN_KEY_LENGTH,
	validateBearerToken,
	validateKeyLength,
} from "@sandcaster/core";
import type { MiddlewareHandler } from "hono";
import { bearerAuth } from "hono/bearer-auth";

const PUBLIC_PATHS = new Set(["/health"]);

export function createAuthMiddleware(apiKey: string): MiddlewareHandler {
	if (!validateKeyLength(apiKey)) {
		throw new Error(
			`SANDCASTER_API_KEY must be at least ${MIN_KEY_LENGTH} characters (got ${apiKey.length})`,
		);
	}

	const auth = bearerAuth({
		verifyToken: (token) => validateBearerToken(token, [apiKey]),
	});

	return async (c, next) => {
		if (PUBLIC_PATHS.has(c.req.path)) return next();
		return auth(c, next);
	};
}
