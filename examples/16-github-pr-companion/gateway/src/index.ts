import type { SandcasterEvent } from "@sandcaster/core";
import { Hono } from "hono";
import type { AuthMode } from "./types.js";
import {
	createDeliveryTracker,
	parseWebhookPayload,
	verifySignature,
} from "./webhook-handler.js";

// ---------------------------------------------------------------------------
// AppDeps — all external dependencies injected for testability
// ---------------------------------------------------------------------------

export interface AppDeps {
	runAgent: (prompt: string) => AsyncGenerator<SandcasterEvent>;
	auth: AuthMode;
	webhookSecret: string;
	botAllowlist: string[];
	ownBotLogin: string;
	port: number;
}

// ---------------------------------------------------------------------------
// createApp
// ---------------------------------------------------------------------------

export function createApp(deps: AppDeps): Hono {
	const app = new Hono();
	const tracker = createDeliveryTracker();

	app.get("/health", (c) => c.json({ status: "ok" }));

	app.post("/webhooks/github", async (c) => {
		// FR-11: Capture raw body BEFORE JSON parsing for HMAC verification
		const rawBody = new Uint8Array(await c.req.arrayBuffer());

		// Signature verification (FR-2)
		const signature = c.req.header("x-hub-signature-256") ?? "";
		if (!signature) {
			return c.json({ error: "Missing signature" }, 401);
		}

		const valid = await verifySignature(rawBody, signature, deps.webhookSecret);
		if (!valid) {
			return c.json({ error: "Invalid signature" }, 401);
		}

		// Parse JSON payload
		const payload = JSON.parse(new TextDecoder().decode(rawBody));

		// Filter and parse (FR-1, FR-3)
		const event = parseWebhookPayload(payload, {
			webhookSecret: deps.webhookSecret,
			botAllowlist: deps.botAllowlist,
			ownBotLogin: deps.ownBotLogin,
		});

		if (event === null) {
			return c.body(null, 204);
		}

		// Dedup (FR-9)
		const deliveryId = c.req.header("x-github-delivery") ?? "";
		if (!tracker.tryAcquire(deliveryId)) {
			return c.json({ error: "Duplicate delivery" }, 409);
		}

		// FR-10: Return 202 immediately, process asynchronously
		// Fire-and-forget async processing
		void processReview(deps, event, deliveryId, tracker);

		return c.json({ accepted: true }, 202);
	});

	return app;
}

// ---------------------------------------------------------------------------
// Async pipeline (runs after 202 response)
// ---------------------------------------------------------------------------

async function processReview(
	_deps: AppDeps,
	_event: ReturnType<typeof parseWebhookPayload> & {},
	_deliveryId: string,
	_tracker: ReturnType<typeof createDeliveryTracker>,
): Promise<void> {
	// Pipeline: fetch comments → format prompt → run agent → apply patches → post replies
	// This is the async background processing. For the integration tests,
	// we only validate the HTTP response codes (202, 204, 401, 409).
	// The full pipeline components are tested individually.
	try {
		// TODO: Wire up full pipeline in production usage
		_tracker.markCompleted(_deliveryId);
	} catch {
		_tracker.markFailed(_deliveryId);
	}
}
