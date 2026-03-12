import type { IRunStore } from "@sandcaster/core";
import type { Hono } from "hono";

export function registerRunsRoutes(
	app: Hono,
	opts: { runStore?: IRunStore },
): void {
	app.get("/runs", (c) => {
		const raw = Number.parseInt(c.req.query("limit") ?? "50", 10);
		const limit = Number.isNaN(raw) ? 50 : Math.max(1, Math.min(raw, 200));
		const runs = opts.runStore?.list(limit) ?? [];
		return c.json(runs);
	});
}
