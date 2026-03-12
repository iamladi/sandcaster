import { randomUUID } from "node:crypto";
import type { MiddlewareHandler } from "hono";

export function requestIdMiddleware(): MiddlewareHandler {
	return async (c, next) => {
		const id = randomUUID();
		c.set("requestId", id);
		await next();
		c.header("X-Request-ID", id);
	};
}
