import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createRunStore, runAgentInSandbox } from "@sandcaster/core";
import { createApp } from "./app.js";

const pkg = JSON.parse(
	readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
);

const port = Number.parseInt(process.env.PORT ?? "8000", 10);

const app = createApp({
	runStore: createRunStore(),
	runAgent: runAgentInSandbox,
	apiKey: process.env.SANDCASTER_API_KEY,
	version: pkg.version,
	corsOrigins: (process.env.CORS_ORIGINS ?? "*")
		.split(",")
		.map((o: string) => o.trim()),
});

serve({ fetch: app.fetch, port }, (info) => {
	console.log(`Sandcaster API listening on http://localhost:${info.port}`);
});
