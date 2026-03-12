import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";

export function createCorsMiddleware(origins: string[]): MiddlewareHandler {
	return cors({
		origin: origins,
		allowMethods: ["GET", "POST"],
		allowHeaders: ["Content-Type", "Authorization"],
	});
}
