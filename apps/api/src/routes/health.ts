import type { Hono } from "hono";

export function registerHealthRoutes(
	app: Hono,
	opts: { version: string },
): void {
	app.get("/health", (c) => {
		return c.json({ status: "ok", version: opts.version });
	});
}
