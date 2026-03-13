import { randomUUID } from "node:crypto";
import type { IRunStore, RunOptions, SandcasterEvent } from "@sandcaster/core";
import { loadConfig, QueryRequestSchema } from "@sandcaster/core";
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";

export function registerQueryRoutes(
	app: Hono,
	opts: {
		runAgent?: (options: RunOptions) => AsyncGenerator<SandcasterEvent>;
		runStore?: IRunStore;
	},
): void {
	app.post("/query", async (c) => {
		// Validate request body
		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "Invalid JSON" }, 400);
		}

		const parsed = QueryRequestSchema.safeParse(body);
		if (!parsed.success) {
			return c.json(
				{ error: "Validation failed", details: parsed.error.issues },
				400,
			);
		}

		const request = parsed.data;
		const requestId =
			(c.get("requestId" as never) as string | undefined) ?? randomUUID();
		const config = loadConfig() ?? undefined;

		// Create run in store
		opts.runStore?.create(
			requestId,
			request.prompt,
			request.model ?? null,
			request.files ? Object.keys(request.files).length : 0,
		);

		if (!opts.runAgent) {
			return c.json({ error: "No agent runner configured" }, 503);
		}

		const runAgent = opts.runAgent;

		return streamSSE(
			c,
			async (stream) => {
				c.header("Content-Encoding", "Identity");

				let costUsd: number | undefined;
				let numTurns: number | undefined;
				let durationSecs: number | undefined;
				let model: string | undefined;

				try {
					for await (const event of runAgent({
						request,
						config,
						requestId,
					})) {
						// Extract metadata from result events
						if (event.type === "result") {
							costUsd = event.costUsd;
							numTurns = event.numTurns;
							durationSecs = event.durationSecs;
							model = event.model;
						}

						await stream.writeSSE({
							event: event.type,
							data: JSON.stringify(event),
						});
					}

					opts.runStore?.complete(requestId, {
						costUsd,
						numTurns,
						durationSecs,
						model,
					});
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);

					opts.runStore?.fail(requestId, message, durationSecs);

					await stream.writeSSE({
						event: "error",
						data: JSON.stringify({
							type: "error",
							content: message,
							code: "AGENT_ERROR",
						}),
					});
				}
			},
			async (err) => {
				console.error("SSE stream error:", err);
			},
		);
	});
}
