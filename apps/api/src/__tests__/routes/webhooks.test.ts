import { createHmac } from "node:crypto";
import { describe, expect, test } from "vitest";
import { createApp } from "../../app.js";

const WEBHOOK_SECRET = "test-webhook-secret-key-1234567890";

function sign(body: string, secret: string): string {
	return createHmac("sha256", secret).update(body).digest("hex");
}

function postWebhook(
	app: ReturnType<typeof createApp>,
	body: object,
	opts?: { signature?: string; noSignature?: boolean },
) {
	const bodyStr = JSON.stringify(body);
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (!opts?.noSignature) {
		headers["e2b-signature"] = opts?.signature ?? sign(bodyStr, WEBHOOK_SECRET);
	}
	return app.request("/webhooks/e2b", {
		method: "POST",
		headers,
		body: bodyStr,
	});
}

const samplePayload = {
	type: "sandbox.lifecycle.created",
	sandboxId: "sbx-123",
	eventData: { sandbox_metadata: { request_id: "req-456" } },
};

describe("POST /webhooks/e2b", () => {
	test("accepts valid HMAC signature", async () => {
		const app = createApp({ webhookSecret: WEBHOOK_SECRET });
		const res = await postWebhook(app, samplePayload);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({ status: "ok" });
	});

	test("rejects invalid HMAC signature", async () => {
		const app = createApp({ webhookSecret: WEBHOOK_SECRET });
		const res = await postWebhook(app, samplePayload, {
			signature: "invalid-signature",
		});

		expect(res.status).toBe(401);
	});

	test("rejects request with no signature when secret is configured", async () => {
		const app = createApp({ webhookSecret: WEBHOOK_SECRET });
		const res = await postWebhook(app, samplePayload, { noSignature: true });

		expect(res.status).toBe(401);
	});

	test("accepts request without secret configured (dev mode)", async () => {
		const app = createApp({});
		const res = await postWebhook(app, samplePayload, { noSignature: true });

		expect(res.status).toBe(200);
	});

	test("returns 400 for invalid JSON", async () => {
		const app = createApp({});
		const res = await app.request("/webhooks/e2b", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "not json {{{",
		});

		expect(res.status).toBe(400);
	});

	test("handles sha256= prefix on signature", async () => {
		const app = createApp({ webhookSecret: WEBHOOK_SECRET });
		const bodyStr = JSON.stringify(samplePayload);
		const sig = `sha256=${sign(bodyStr, WEBHOOK_SECRET)}`;
		const res = await postWebhook(app, samplePayload, { signature: sig });

		expect(res.status).toBe(200);
	});
});
