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

/**
 * Create a reusable signature verifier that caches the HMAC key.
 * Returns an async function: (rawBody, signature) => boolean.
 */
export async function createSignatureVerifier(
	secret: string,
): Promise<(rawBody: Uint8Array, signature: string) => Promise<boolean>> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret).buffer as ArrayBuffer,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);

	return async (rawBody: Uint8Array, signature: string): Promise<boolean> => {
		if (!signature || !signature.startsWith("sha256=")) {
			return false;
		}

		const sig = await crypto.subtle.sign(
			"HMAC",
			key,
			rawBody.buffer as ArrayBuffer,
		);

		const expectedHex = Array.from(new Uint8Array(sig))
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");

		const actualHex = signature.slice("sha256=".length);

		if (expectedHex.length !== actualHex.length) {
			return false;
		}

		let diff = 0;
		for (let i = 0; i < expectedHex.length; i++) {
			diff |= expectedHex.charCodeAt(i) ^ actualHex.charCodeAt(i);
		}

		return diff === 0;
	};
}

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

export function parseWebhookPayload(
	payload: unknown,
	deps: WebhookHandlerDeps,
): ReviewEvent | null {
	const p = payload as RawPayload;

	if (p.action !== "submitted") {
		return null;
	}

	const reviewerLogin = p.review.user.login;
	const senderLogin = p.sender.login;

	if (!deps.botAllowlist.includes(reviewerLogin)) {
		return null;
	}

	// Prevent self-loop
	if (senderLogin === deps.ownBotLogin) {
		return null;
	}

	const headRepo = p.pull_request.head.repo;
	const baseRepo = p.pull_request.base.repo;

	const isFork = headRepo.full_name !== baseRepo.full_name;
	const cloneUrl = isFork ? headRepo.clone_url : baseRepo.clone_url;

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

const DEFAULT_TTL_MS = 10 * 60 * 1000;

export function createDeliveryTracker(ttlMs = DEFAULT_TTL_MS): DeliveryTracker {
	const store = new Map<string, DeliveryState>();
	const timers = new Map<string, ReturnType<typeof setTimeout>>();

	function scheduleExpiry(deliveryId: string): void {
		const existing = timers.get(deliveryId);
		if (existing !== undefined) clearTimeout(existing);

		const handle = setTimeout(() => {
			store.delete(deliveryId);
			timers.delete(deliveryId);
		}, ttlMs);
		timers.set(deliveryId, handle);
	}

	return {
		tryAcquire(deliveryId: string): boolean {
			const state = store.get(deliveryId);

			if (state === undefined || state === "failed") {
				store.set(deliveryId, "processing");
				scheduleExpiry(deliveryId);
				return true;
			}

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
