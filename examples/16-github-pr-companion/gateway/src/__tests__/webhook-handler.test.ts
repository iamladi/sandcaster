import { describe, expect, it, vi } from "vitest";
import type {
	DeliveryState,
	ReviewEvent,
	WebhookHandlerDeps,
} from "../types.js";
import {
	createDeliveryTracker,
	createSignatureVerifier,
	parseWebhookPayload,
} from "../webhook-handler.js";

/** Encode a string to Uint8Array (UTF-8) */
function encode(s: string): Uint8Array {
	return new TextEncoder().encode(s);
}

/**
 * Compute a real HMAC-SHA256 signature for the given raw body and secret,
 * returning the GitHub-format `sha256=<hex>` string.
 */
async function computeSignature(
	rawBody: Uint8Array,
	secret: string,
): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		encode(secret).buffer as ArrayBuffer,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sigBuffer = await crypto.subtle.sign(
		"HMAC",
		key,
		rawBody.buffer as ArrayBuffer,
	);
	const hex = Array.from(new Uint8Array(sigBuffer))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	return `sha256=${hex}`;
}

/** Build a minimal valid pull_request_review webhook payload */
function buildPayload(overrides: {
	action?: string;
	reviewerLogin?: string;
	senderLogin?: string;
	headFullName?: string;
	baseFullName?: string;
	headCloneUrl?: string;
	baseCloneUrl?: string;
	reviewId?: number;
	prNumber?: number;
	headSha?: string;
	branch?: string;
	owner?: string;
	repo?: string;
}) {
	const {
		action = "submitted",
		reviewerLogin = "coderabbitai[bot]",
		senderLogin = "coderabbitai[bot]",
		headFullName = "owner/repo",
		baseFullName = "owner/repo",
		headCloneUrl = "https://github.com/owner/repo.git",
		baseCloneUrl = "https://github.com/owner/repo.git",
		reviewId = 999,
		prNumber = 42,
		headSha = "abc123",
		branch = "feature/my-branch",
		owner = "owner",
		repo = "repo",
	} = overrides;

	return {
		action,
		review: {
			id: reviewId,
			user: { login: reviewerLogin },
		},
		sender: { login: senderLogin },
		pull_request: {
			number: prNumber,
			head: {
				sha: headSha,
				ref: branch,
				repo: {
					full_name: headFullName,
					clone_url: headCloneUrl,
					owner: { login: owner },
					name: repo,
				},
			},
			base: {
				repo: {
					full_name: baseFullName,
					clone_url: baseCloneUrl,
					owner: { login: owner },
					name: repo,
				},
			},
		},
	};
}

const defaultDeps: WebhookHandlerDeps = {
	webhookSecret: "super-secret",
	botAllowlist: ["coderabbitai[bot]", "github-copilot[bot]"],
	ownBotLogin: "my-fix-bot[bot]",
};

describe("createSignatureVerifier", () => {
	it("accepts a valid HMAC-SHA256 signature", async () => {
		const body = encode('{"event":"ping"}');
		const secret = "test-secret";
		const verify = await createSignatureVerifier(secret);
		const sig = await computeSignature(body, secret);

		const result = await verify(body, sig);

		expect(result).toBe(true);
	});

	it("rejects a signature computed with the wrong secret", async () => {
		const body = encode('{"event":"ping"}');
		const sig = await computeSignature(body, "wrong-secret");
		const verify = await createSignatureVerifier("correct-secret");

		const result = await verify(body, sig);

		expect(result).toBe(false);
	});

	it("rejects an empty signature string", async () => {
		const body = encode('{"event":"ping"}');
		const verify = await createSignatureVerifier("any-secret");

		const result = await verify(body, "");

		expect(result).toBe(false);
	});

	it("rejects a signature that omits the sha256= prefix", async () => {
		const body = encode('{"event":"ping"}');
		const secret = "test-secret";
		const verify = await createSignatureVerifier(secret);
		const sig = await computeSignature(body, secret);
		const bareHex = sig.replace("sha256=", "");

		const result = await verify(body, bareHex);

		expect(result).toBe(false);
	});

	it("verifies against raw bytes — not re-serialized JSON", async () => {
		const rawBodyStr = '{ "a" : 1 ,  "b" : 2 }';
		const rawBody = encode(rawBodyStr);
		const secret = "raw-bytes-secret";
		const verify = await createSignatureVerifier(secret);
		const sig = await computeSignature(rawBody, secret);

		expect(await verify(rawBody, sig)).toBe(true);

		const compactBody = encode('{"a":1,"b":2}');
		expect(await verify(compactBody, sig)).toBe(false);
	});

	it("rejects a tampered body even with a valid signature for the original", async () => {
		const original = encode("original content");
		const tampered = encode("tampered content");
		const secret = "tamper-secret";
		const verify = await createSignatureVerifier(secret);
		const sig = await computeSignature(original, secret);

		expect(await verify(tampered, sig)).toBe(false);
	});
});

describe("parseWebhookPayload", () => {
	it("parses a submitted CodeRabbit bot review into a ReviewEvent", () => {
		const payload = buildPayload({
			reviewerLogin: "coderabbitai[bot]",
			senderLogin: "coderabbitai[bot]",
		});
		const deps = { ...defaultDeps };

		const event = parseWebhookPayload(payload, deps);

		expect(event).not.toBeNull();
		expect(event?.reviewerLogin).toBe("coderabbitai[bot]");
		expect(event?.reviewId).toBe(999);
		expect(event?.prNumber).toBe(42);
		expect(event?.headSha).toBe("abc123");
		expect(event?.branch).toBe("feature/my-branch");
		expect(event?.owner).toBe("owner");
		expect(event?.repo).toBe("repo");
	});

	it("parses a submitted GitHub Copilot bot review into a ReviewEvent", () => {
		const payload = buildPayload({
			reviewerLogin: "github-copilot[bot]",
			senderLogin: "github-copilot[bot]",
		});
		const deps = { ...defaultDeps };

		const event = parseWebhookPayload(payload, deps);

		expect(event).not.toBeNull();
		expect(event?.reviewerLogin).toBe("github-copilot[bot]");
	});

	it("returns null for a review from a non-bot user not in the allowlist", () => {
		const payload = buildPayload({
			reviewerLogin: "human-reviewer",
			senderLogin: "human-reviewer",
		});
		const deps = { ...defaultDeps };

		const event = parseWebhookPayload(payload, deps);

		expect(event).toBeNull();
	});

	it("returns null when the sender is the own bot (self-loop prevention)", () => {
		const payload = buildPayload({
			reviewerLogin: "coderabbitai[bot]",
			senderLogin: "my-fix-bot[bot]",
		});
		const deps = { ...defaultDeps };

		const event = parseWebhookPayload(payload, deps);

		expect(event).toBeNull();
	});

	it("returns null when the action is not 'submitted'", () => {
		const payload = buildPayload({
			action: "dismissed",
			reviewerLogin: "coderabbitai[bot]",
		});
		const deps = { ...defaultDeps };

		const event = parseWebhookPayload(payload, deps);

		expect(event).toBeNull();
	});

	it("returns null when the action is 'edited'", () => {
		const payload = buildPayload({
			action: "edited",
			reviewerLogin: "coderabbitai[bot]",
		});
		const deps = { ...defaultDeps };

		const event = parseWebhookPayload(payload, deps);

		expect(event).toBeNull();
	});

	it("detects a fork PR when head and base repos differ", () => {
		const payload = buildPayload({
			reviewerLogin: "coderabbitai[bot]",
			senderLogin: "coderabbitai[bot]",
			headFullName: "contributor/repo",
			baseFullName: "owner/repo",
			headCloneUrl: "https://github.com/contributor/repo.git",
			baseCloneUrl: "https://github.com/owner/repo.git",
		});
		const deps = { ...defaultDeps };

		const event = parseWebhookPayload(payload, deps);

		expect(event?.isFork).toBe(true);
	});

	it("marks isFork false when head and base repos are the same", () => {
		const payload = buildPayload({
			reviewerLogin: "coderabbitai[bot]",
			senderLogin: "coderabbitai[bot]",
			headFullName: "owner/repo",
			baseFullName: "owner/repo",
		});
		const deps = { ...defaultDeps };

		const event = parseWebhookPayload(payload, deps);

		expect(event?.isFork).toBe(false);
	});

	it("uses the fork's head clone URL for fork PRs", () => {
		const forkCloneUrl = "https://github.com/contributor/repo.git";
		const payload = buildPayload({
			reviewerLogin: "coderabbitai[bot]",
			senderLogin: "coderabbitai[bot]",
			headFullName: "contributor/repo",
			baseFullName: "owner/repo",
			headCloneUrl: forkCloneUrl,
			baseCloneUrl: "https://github.com/owner/repo.git",
		});
		const deps = { ...defaultDeps };

		const event = parseWebhookPayload(payload, deps);

		expect(event?.cloneUrl).toBe(forkCloneUrl);
	});

	it("uses the base clone URL for non-fork PRs", () => {
		const baseCloneUrl = "https://github.com/owner/repo.git";
		const payload = buildPayload({
			reviewerLogin: "coderabbitai[bot]",
			senderLogin: "coderabbitai[bot]",
			headFullName: "owner/repo",
			baseFullName: "owner/repo",
			headCloneUrl: baseCloneUrl,
			baseCloneUrl,
		});
		const deps = { ...defaultDeps };

		const event = parseWebhookPayload(payload, deps);

		expect(event?.cloneUrl).toBe(baseCloneUrl);
	});

	it("extracts all required ReviewEvent fields", () => {
		const payload = buildPayload({
			reviewerLogin: "coderabbitai[bot]",
			senderLogin: "coderabbitai[bot]",
			reviewId: 12345,
			prNumber: 7,
			headSha: "deadbeef",
			branch: "fix/typo",
			owner: "acme",
			repo: "widget",
			headFullName: "acme/widget",
			baseFullName: "acme/widget",
			headCloneUrl: "https://github.com/acme/widget.git",
			baseCloneUrl: "https://github.com/acme/widget.git",
		});
		const deps = { ...defaultDeps };

		const event = parseWebhookPayload(payload, deps);

		expect(event).toMatchObject<Partial<ReviewEvent>>({
			reviewId: 12345,
			prNumber: 7,
			owner: "acme",
			repo: "widget",
			branch: "fix/typo",
			headSha: "deadbeef",
			cloneUrl: "https://github.com/acme/widget.git",
			isFork: false,
			reviewerLogin: "coderabbitai[bot]",
		});
	});
});

describe("createDeliveryTracker", () => {
	it("grants acquisition on the first attempt for a new delivery ID", () => {
		const tracker = createDeliveryTracker();

		expect(tracker.tryAcquire("delivery-1")).toBe(true);
	});

	it("denies a second acquisition for an already-acquired delivery ID", () => {
		const tracker = createDeliveryTracker();
		tracker.tryAcquire("delivery-2");

		expect(tracker.tryAcquire("delivery-2")).toBe(false);
	});

	it("reflects 'processing' state after successful acquisition", () => {
		const tracker = createDeliveryTracker();
		tracker.tryAcquire("delivery-3");

		expect(tracker.getState("delivery-3")).toBe<DeliveryState>("processing");
	});

	it("transitions to 'completed' after markCompleted is called", () => {
		const tracker = createDeliveryTracker();
		tracker.tryAcquire("delivery-4");
		tracker.markCompleted("delivery-4");

		expect(tracker.getState("delivery-4")).toBe<DeliveryState>("completed");
	});

	it("transitions to 'failed' after markFailed is called", () => {
		const tracker = createDeliveryTracker();
		tracker.tryAcquire("delivery-5");
		tracker.markFailed("delivery-5");

		expect(tracker.getState("delivery-5")).toBe<DeliveryState>("failed");
	});

	it("allows re-acquisition after a failed delivery", () => {
		const tracker = createDeliveryTracker();
		tracker.tryAcquire("delivery-6");
		tracker.markFailed("delivery-6");

		// After failure the delivery should be re-processable
		expect(tracker.tryAcquire("delivery-6")).toBe(true);
	});

	it("does not allow re-acquisition after a completed delivery", () => {
		const tracker = createDeliveryTracker();
		tracker.tryAcquire("delivery-7");
		tracker.markCompleted("delivery-7");

		expect(tracker.tryAcquire("delivery-7")).toBe(false);
	});

	it("returns null for an unknown delivery ID", () => {
		const tracker = createDeliveryTracker();

		expect(tracker.getState("unknown-delivery")).toBeNull();
	});

	it("expires entries after the configured TTL", async () => {
		vi.useFakeTimers();
		const ttlMs = 500;
		const tracker = createDeliveryTracker(ttlMs);

		tracker.tryAcquire("delivery-ttl");
		tracker.markCompleted("delivery-ttl");

		// Before TTL expires the entry is still present
		expect(tracker.getState("delivery-ttl")).toBe<DeliveryState>("completed");

		// Advance time past the TTL
		vi.advanceTimersByTime(ttlMs + 1);

		// After expiry the entry should be gone
		expect(tracker.getState("delivery-ttl")).toBeNull();

		vi.useRealTimers();
	});

	it("tracks multiple delivery IDs independently", () => {
		const tracker = createDeliveryTracker();
		tracker.tryAcquire("a");
		tracker.tryAcquire("b");
		tracker.markCompleted("a");

		expect(tracker.getState("a")).toBe<DeliveryState>("completed");
		expect(tracker.getState("b")).toBe<DeliveryState>("processing");
	});
});
