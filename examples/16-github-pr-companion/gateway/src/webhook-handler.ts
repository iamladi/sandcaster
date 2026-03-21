import type {
	DeliveryState,
	ReviewEvent,
	WebhookHandlerDeps,
} from "./types.js";

export interface DeliveryTracker {
	tryAcquire(deliveryId: string): boolean;
	markCompleted(deliveryId: string): void;
	markFailed(deliveryId: string): void;
	getState(deliveryId: string): DeliveryState | null;
}

// ---------------------------------------------------------------------------
// verifySignature
// ---------------------------------------------------------------------------

/**
 * Verify a GitHub-style HMAC-SHA256 webhook signature.
 * Signature format: `sha256=<hex>`
 * Uses constant-time comparison via crypto.subtle.verify to prevent timing attacks.
 */
export async function verifySignature(
	rawBody: Uint8Array,
	signature: string,
	secret: string,
): Promise<boolean> {
	if (!signature || !signature.startsWith("sha256=")) {
		return false;
	}

	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret).buffer as ArrayBuffer,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);

	const sig = await crypto.subtle.sign(
		"HMAC",
		key,
		rawBody.buffer as ArrayBuffer,
	);

	const expectedHex = Array.from(new Uint8Array(sig))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");

	const actualHex = signature.slice("sha256=".length);

	// Constant-time comparison: compare every character regardless of mismatch
	if (expectedHex.length !== actualHex.length) {
		return false;
	}

	let diff = 0;
	for (let i = 0; i < expectedHex.length; i++) {
		diff |= expectedHex.charCodeAt(i) ^ actualHex.charCodeAt(i);
	}

	return diff === 0;
}

// ---------------------------------------------------------------------------
// parseWebhookPayload
// ---------------------------------------------------------------------------

interface RawPayload {
	action: string;
	review: {
		id: number;
		user: { login: string };
	};
	sender: { login: string };
	pull_request: {
		number: number;
		head: {
			sha: string;
			ref: string;
			repo: {
				full_name: string;
				clone_url: string;
				owner: { login: string };
				name: string;
			};
		};
		base: {
			repo: {
				full_name: string;
				clone_url: string;
				owner: { login: string };
				name: string;
			};
		};
	};
}

/**
 * Parse and filter a raw webhook payload into a ReviewEvent.
 * Returns null if the event should not be processed.
 */
export function parseWebhookPayload(
	payload: unknown,
	deps: WebhookHandlerDeps,
): ReviewEvent | null {
	const p = payload as RawPayload;

	// Only process "submitted" review events
	if (p.action !== "submitted") {
		return null;
	}

	const reviewerLogin = p.review.user.login;
	const senderLogin = p.sender.login;

	// Ignore reviews from users not in the allowlist
	if (!deps.botAllowlist.includes(reviewerLogin)) {
		return null;
	}

	// Prevent self-loop: ignore events where the sender is our own bot
	if (senderLogin === deps.ownBotLogin) {
		return null;
	}

	const headRepo = p.pull_request.head.repo;
	const baseRepo = p.pull_request.base.repo;

	const isFork = headRepo.full_name !== baseRepo.full_name;
	const cloneUrl = isFork ? headRepo.clone_url : baseRepo.clone_url;

	// owner/repo always come from the base repo (source of truth for API calls)
	const owner = baseRepo.owner.login;
	const repo = baseRepo.name;

	return {
		deliveryId: "",
		reviewId: p.review.id,
		prNumber: p.pull_request.number,
		owner,
		repo,
		branch: p.pull_request.head.ref,
		headSha: p.pull_request.head.sha,
		cloneUrl,
		isFork,
		reviewerLogin,
	};
}

// ---------------------------------------------------------------------------
// createDeliveryTracker
// ---------------------------------------------------------------------------

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Create a delivery tracker that deduplicates webhook deliveries.
 */
export function createDeliveryTracker(ttlMs = DEFAULT_TTL_MS): DeliveryTracker {
	const store = new Map<string, DeliveryState>();

	function scheduleExpiry(deliveryId: string): void {
		setTimeout(() => {
			store.delete(deliveryId);
		}, ttlMs);
	}

	return {
		tryAcquire(deliveryId: string): boolean {
			const state = store.get(deliveryId);

			// New entry or previously failed: allow processing
			if (state === undefined || state === "failed") {
				store.set(deliveryId, "processing");
				scheduleExpiry(deliveryId);
				return true;
			}

			// Already processing or completed: deny
			return false;
		},

		markCompleted(deliveryId: string): void {
			store.set(deliveryId, "completed");
		},

		markFailed(deliveryId: string): void {
			store.set(deliveryId, "failed");
		},

		getState(deliveryId: string): DeliveryState | null {
			return store.get(deliveryId) ?? null;
		},
	};
}
