import {
	MIN_KEY_LENGTH,
	validateBearerToken,
	validateKeyFormat,
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
	if (!validateKeyFormat(apiKey)) {
		throw new Error(
			'SANDCASTER_API_KEY contains characters outside the RFC 6750 b64token set ([A-Za-z0-9._~+/-]+ "=*"). Hono\'s bearerAuth rejects any other character with 400 before verification runs.',
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
