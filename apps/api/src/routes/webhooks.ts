import { createHmac, timingSafeEqual } from "node:crypto";
import type { Hono } from "hono";

export function registerWebhookRoutes(
	app: Hono,
	opts: { webhookSecret?: string },
): void {
	app.post("/webhooks/e2b", async (c) => {
		const rawBody = await c.req.text();

		// HMAC verification when secret is configured
		if (opts.webhookSecret) {
			const rawSignature = c.req.header("e2b-signature") ?? "";
			const signature = rawSignature.replace(/^sha256=/, "");

			if (!signature) {
				return c.json({ error: "missing signature" }, 401);
			}

			const expected = createHmac("sha256", opts.webhookSecret)
				.update(rawBody)
				.digest("hex");

			const sigBuf = Buffer.from(signature, "utf8");
			const expBuf = Buffer.from(expected, "utf8");

			if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
				return c.json({ error: "invalid signature" }, 401);
			}
		}

		// Parse JSON body
		let payload: Record<string, unknown>;
		try {
			payload = JSON.parse(rawBody);
		} catch {
			return c.json({ error: "invalid JSON" }, 400);
		}

		const eventType = (payload.type as string) ?? "unknown";
		const sandboxId = (payload.sandboxId as string) ?? "unknown";
		const metadata =
			((payload.eventData as Record<string, unknown>)
				?.sandbox_metadata as Record<string, unknown>) ?? {};
		const requestId = (metadata.request_id as string) ?? "unknown";

		console.log(
			`[${requestId}] E2B lifecycle event: ${eventType} sandbox=${sandboxId}`,
		);

		return c.json({ status: "ok" });
	});
}
