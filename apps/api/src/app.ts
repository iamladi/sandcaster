import { Hono } from "hono";
import { registerHealthRoutes } from "./routes/health.js";
import type { AppDeps } from "./types.js";

export function createApp(deps: AppDeps): Hono {
	const app = new Hono();
	const version = deps.version ?? "0.0.0";

	registerHealthRoutes(app, { version });

	return app;
}
