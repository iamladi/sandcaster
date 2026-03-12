import type { IRunStore } from "@sandcaster/core";
import type { Hono } from "hono";

export function registerRunsRoutes(
	app: Hono,
	opts: { runStore?: IRunStore },
): void {
	app.get("/runs", (c) => {
		const limit = Number.parseInt(c.req.query("limit") ?? "50", 10);
		const runs = opts.runStore?.list(limit) ?? [];
		return c.json(runs);
	});
}
