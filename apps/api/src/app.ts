import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { createAuthMiddleware } from "./middleware/auth.js";
import { createCorsMiddleware } from "./middleware/cors.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerQueryRoutes } from "./routes/query.js";
import { registerRunsRoutes } from "./routes/runs.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";
import type { AppDeps } from "./types.js";

export function createApp(deps: AppDeps): Hono {
	const app = new Hono();
	const version = deps.version ?? "0.0.0";

	// Middleware — always generate a fresh ID, ignore client-supplied headers
	app.use(
		"*",
		requestId({ headerName: "X-Request-ID", generator: () => randomUUID() }),
	);
	if (deps.corsOrigins) {
		app.use("*", createCorsMiddleware(deps.corsOrigins));
	}
	if (deps.apiKey) {
		app.use("*", createAuthMiddleware(deps.apiKey));
	}

	// Routes
	registerHealthRoutes(app, { version });
	registerQueryRoutes(app, {
		runAgent: deps.runAgent,
		runStore: deps.runStore,
	});
	registerRunsRoutes(app, { runStore: deps.runStore });
	registerWebhookRoutes(app, { webhookSecret: deps.webhookSecret });

	return app;
}
