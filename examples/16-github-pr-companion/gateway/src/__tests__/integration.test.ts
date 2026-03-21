import type { SandcasterEvent } from "@sandcaster/core";
import { describe, expect, test } from "vitest";
import type { AgentOutput, AuthMode } from "../types.js";

// ---------------------------------------------------------------------------
// createApp — dynamically imported so the module doesn't need to exist yet
// ---------------------------------------------------------------------------

import { createApp } from "../index.js";

// ---------------------------------------------------------------------------
// MSW server — mocks GitHub API calls made during pipeline processing
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WEBHOOK_SECRET = "test-webhook-secret";

const BOT_ALLOWLIST = ["coderabbitai[bot]", "github-copilot[bot]"];

const OWN_BOT_LOGIN = "pr-companion[bot]";

const PAT_AUTH: AuthMode = { type: "pat", token: "ghp_test_token" };

/**
 * Compute a real HMAC-SHA256 signature for the given raw body and secret,
 * returning the GitHub-format `sha256=<hex>` string.
 */
async function computeSignature(
	rawBody: Uint8Array,
	secret: string,
): Promise<string> {
	const enc = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		enc.encode(secret).buffer as ArrayBuffer,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign(
		"HMAC",
		key,
		rawBody.buffer as ArrayBuffer,
	);
	const hex = Array.from(new Uint8Array(sig))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	return `sha256=${hex}`;
}

/** Build a minimal valid pull_request_review webhook payload */
function buildWebhookPayload(
	overrides?: Partial<{
		action: string;
		reviewerLogin: string;
		senderLogin: string;
		prNumber: number;
		reviewId: number;
		headSha: string;
		branch: string;
	}>,
) {
	const {
		action = "submitted",
		reviewerLogin = "coderabbitai[bot]",
		senderLogin = "coderabbitai[bot]",
		prNumber = 42,
		reviewId = 12345,
		headSha = "abc123",
		branch = "fix/typo",
	} = overrides ?? {};

	return {
		action,
		review: {
			id: reviewId,
			user: { login: reviewerLogin, type: "Bot" },
			body: "Review summary",
		},
		pull_request: {
			number: prNumber,
			head: {
				sha: headSha,
				ref: branch,
				repo: {
					full_name: "owner/repo",
					clone_url: "https://github.com/owner/repo.git",
					owner: { login: "owner" },
					name: "repo",
				},
			},
			base: {
				repo: {
					full_name: "owner/repo",
					clone_url: "https://github.com/owner/repo.git",
					owner: { login: "owner" },
					name: "repo",
				},
			},
		},
		sender: { login: senderLogin },
	};
}

/** Create a signed webhook Request object */
async function buildSignedRequest(
	payload: object,
	deliveryId: string,
	secret: string = WEBHOOK_SECRET,
): Promise<Request> {
	const body = JSON.stringify(payload);
	const rawBody = new TextEncoder().encode(body);
	const signature = await computeSignature(rawBody, secret);

	return new Request("http://localhost/webhooks/github", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-hub-signature-256": signature,
			"x-github-delivery": deliveryId,
			"x-github-event": "pull_request_review",
		},
		body,
	});
}

/** Canned AgentOutput for mock runAgent */
const CANNED_AGENT_OUTPUT: AgentOutput = {
	results: [
		{
			commentId: 1,
			fixed: true,
			description: "Applied the suggested fix",
			filesModified: ["src/index.ts"],
		},
	],
	summary: "Fixed 1 comment",
};

/** Mock runAgent that yields a single result event */
async function* mockRunAgent(_prompt: string): AsyncGenerator<SandcasterEvent> {
	yield {
		type: "result",
		content: JSON.stringify(CANNED_AGENT_OUTPUT),
	};
}

/** Create the app with default test deps */
function makeApp() {
	return createApp({
		runAgent: mockRunAgent,
		auth: PAT_AUTH,
		webhookSecret: WEBHOOK_SECRET,
		botAllowlist: BOT_ALLOWLIST,
		ownBotLogin: OWN_BOT_LOGIN,
		port: 3000,
	});
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

describe("GET /health", () => {
	test("returns 200 with { status: 'ok' }", async () => {
		const app = makeApp();

		const res = await app.request("http://localhost/health");

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({ status: "ok" });
	});
});

// ---------------------------------------------------------------------------
// POST /webhooks/github — valid webhook
// ---------------------------------------------------------------------------

describe("POST /webhooks/github", () => {
	test("returns 202 for a valid bot review webhook", async () => {
		const app = makeApp();
		const payload = buildWebhookPayload();
		const req = await buildSignedRequest(payload, "delivery-001");

		const res = await app.request(req);

		expect(res.status).toBe(202);
	});

	test("reads X-GitHub-Delivery header from the request", async () => {
		const app = makeApp();
		const payload = buildWebhookPayload();
		const deliveryId = "unique-delivery-xyz";
		const req = await buildSignedRequest(payload, deliveryId);

		const res = await app.request(req);

		// 202 confirms the delivery was accepted and tracked
		expect(res.status).toBe(202);
	});

	// -------------------------------------------------------------------------
	// Signature verification
	// -------------------------------------------------------------------------

	test("returns 401 for an invalid signature", async () => {
		const app = makeApp();
		const payload = buildWebhookPayload();
		const body = JSON.stringify(payload);

		const res = await app.request("http://localhost/webhooks/github", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-hub-signature-256": "sha256=deadbeef",
				"x-github-delivery": "delivery-bad-sig",
				"x-github-event": "pull_request_review",
			},
			body,
		});

		expect(res.status).toBe(401);
	});

	test("returns 401 when x-hub-signature-256 header is missing", async () => {
		const app = makeApp();
		const payload = buildWebhookPayload();
		const body = JSON.stringify(payload);

		const res = await app.request("http://localhost/webhooks/github", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-github-delivery": "delivery-no-sig",
				"x-github-event": "pull_request_review",
			},
			body,
		});

		expect(res.status).toBe(401);
	});

	// -------------------------------------------------------------------------
	// Filtering — non-bot reviewer
	// -------------------------------------------------------------------------

	test("returns 204 for a review from a human not in the bot allowlist", async () => {
		const app = makeApp();
		const payload = buildWebhookPayload({
			reviewerLogin: "human-reviewer",
			senderLogin: "human-reviewer",
		});
		const req = await buildSignedRequest(payload, "delivery-human");

		const res = await app.request(req);

		expect(res.status).toBe(204);
	});

	// -------------------------------------------------------------------------
	// Self-loop prevention
	// -------------------------------------------------------------------------

	test("returns 204 when the review is from the companion's own bot login", async () => {
		const app = makeApp();
		const payload = buildWebhookPayload({
			reviewerLogin: "coderabbitai[bot]",
			senderLogin: OWN_BOT_LOGIN,
		});
		const req = await buildSignedRequest(payload, "delivery-self-loop");

		const res = await app.request(req);

		expect(res.status).toBe(204);
	});

	// -------------------------------------------------------------------------
	// Duplicate delivery deduplication
	// -------------------------------------------------------------------------

	test("returns 409 on a duplicate delivery ID", async () => {
		const app = makeApp();
		const payload = buildWebhookPayload();
		const deliveryId = "delivery-dup-001";

		const firstReq = await buildSignedRequest(payload, deliveryId);
		const secondReq = await buildSignedRequest(payload, deliveryId);

		const firstRes = await app.request(firstReq);
		const secondRes = await app.request(secondReq);

		expect(firstRes.status).toBe(202);
		expect(secondRes.status).toBe(409);
	});
});
