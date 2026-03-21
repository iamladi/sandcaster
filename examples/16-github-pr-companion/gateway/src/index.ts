import { serve } from "@hono/node-server";
import type { SandcasterEvent } from "@sandcaster/core";
import { loadConfig, runAgentInSandbox } from "@sandcaster/core";
import { Hono } from "hono";
import { createTokenProvider, resolveAuthMode } from "./github-auth.js";
import { createGitHubClient } from "./github-client.js";
import { createPatchApplier, type PatchApplierDeps } from "./patch-applier.js";
import type { AuthMode, ReviewComment, ReviewEvent } from "./types.js";
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

		// Inject delivery ID into the event
		event.deliveryId = deliveryId;

		// FR-10: Return 202 immediately, process asynchronously
		void processReview(deps, event, tracker);

		return c.json({ accepted: true }, 202);
	});

	return app;
}

// ---------------------------------------------------------------------------
// Prompt formatting (FR-4)
// ---------------------------------------------------------------------------

const MAX_COMMENTS_PER_BATCH = 10;

function formatPrompt(comments: ReviewComment[]): string {
	const lines = [
		"Review the following code review comments and apply fixes where possible.",
		"For each comment, read the referenced file and line, understand the suggestion, and fix it if appropriate.",
		"",
	];

	for (const comment of comments) {
		lines.push(`## Comment #${comment.id}`);
		lines.push(
			`**File**: ${comment.path}${comment.line ? ` (line ${comment.line})` : ""}`,
		);
		lines.push(`**Suggestion**: ${comment.body}`);
		lines.push(`**Diff context**:`);
		lines.push("```");
		lines.push(comment.diff_hunk);
		lines.push("```");
		lines.push("");
	}

	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Async pipeline (runs after 202 response)
// ---------------------------------------------------------------------------

async function processReview(
	deps: AppDeps,
	event: ReviewEvent,
	tracker: ReturnType<typeof createDeliveryTracker>,
): Promise<void> {
	const getToken = createTokenProvider(deps.auth);
	const github = createGitHubClient({ getToken });

	try {
		// 1. Fetch all review comments with pagination (FR-8)
		const allComments = await github.fetchReviewComments(
			event.owner,
			event.repo,
			event.prNumber,
			event.reviewId,
		);

		if (allComments.length === 0) {
			tracker.markCompleted(event.deliveryId);
			return;
		}

		// 2. Chunk into batches of MAX_COMMENTS_PER_BATCH (FR-4)
		for (let i = 0; i < allComments.length; i += MAX_COMMENTS_PER_BATCH) {
			const batch = allComments.slice(i, i + MAX_COMMENTS_PER_BATCH);
			const prompt = formatPrompt(batch);

			// 3. Run agent in sandbox
			let resultContent = "";
			for await (const ev of deps.runAgent(prompt)) {
				if (ev.type === "result") {
					resultContent = ev.content;
				}
			}

			if (!resultContent) continue;

			// 4. Parse structured output (FR-5)
			const agentOutput = JSON.parse(resultContent);

			// 5. Apply patches and push (gateway-side, secure)
			const patchDeps = createRealPatchDeps();
			const applier = createPatchApplier(patchDeps);
			const token = await getToken();

			const result = await applier.applyAndPush({
				cloneUrl: event.cloneUrl,
				branch: event.branch,
				token,
				agentOutput,
				isFork: event.isFork,
			});

			// 6. Post replies with pacing (FR-6)
			await github.postReplies(
				event.owner,
				event.repo,
				event.prNumber,
				result.replies,
			);
		}

		tracker.markCompleted(event.deliveryId);
	} catch (err) {
		console.error(
			`[pr-companion] Pipeline error for delivery ${event.deliveryId}:`,
			err,
		);
		tracker.markFailed(event.deliveryId);
	}
}

// ---------------------------------------------------------------------------
// Real system dependencies for PatchApplier
// ---------------------------------------------------------------------------

function createRealPatchDeps(): PatchApplierDeps {
	return {
		async exec(cmd: string, opts?: { cwd?: string }): Promise<string> {
			const { execSync } = await import("node:child_process");
			return execSync(cmd, {
				cwd: opts?.cwd,
				encoding: "utf-8",
				timeout: 60_000,
				maxBuffer: 10 * 1024 * 1024,
			});
		},
		async writeFile(path: string, content: string): Promise<void> {
			const { writeFile } = await import("node:fs/promises");
			await writeFile(path, content, "utf-8");
		},
		async readFile(path: string): Promise<string> {
			const { readFile } = await import("node:fs/promises");
			return readFile(path, "utf-8");
		},
		async mkTempDir(): Promise<string> {
			const { mkdtemp } = await import("node:fs/promises");
			const { tmpdir } = await import("node:os");
			const { join } = await import("node:path");
			return mkdtemp(join(tmpdir(), "pr-companion-"));
		},
		async rmDir(path: string): Promise<void> {
			const { rm } = await import("node:fs/promises");
			await rm(path, { recursive: true, force: true });
		},
	};
}

// ---------------------------------------------------------------------------
// Server startup (only when run directly, not when imported by tests)
// ---------------------------------------------------------------------------

const isMainModule =
	typeof process !== "undefined" &&
	process.argv[1] &&
	(process.argv[1].endsWith("index.ts") ||
		process.argv[1].endsWith("index.js"));

if (isMainModule) {
	const config = loadConfig() ?? loadConfig("..");
	if (!config) {
		console.error(
			"No sandcaster.json found. Run from examples/16-github-pr-companion/ or gateway/.",
		);
		process.exit(1);
	}

	const auth = resolveAuthMode(
		process.env as Record<string, string | undefined>,
	);
	const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
	if (!webhookSecret) {
		console.error("GITHUB_WEBHOOK_SECRET is required.");
		process.exit(1);
	}

	const botAllowlist = (
		process.env.BOT_ALLOWLIST ??
		"coderabbitai[bot],github-copilot[bot],github-advanced-security[bot]"
	).split(",");
	const ownBotLogin =
		process.env.OWN_BOT_LOGIN ?? "sandcaster-pr-companion[bot]";
	const port = Number.parseInt(process.env.PORT ?? "8080", 10);

	const runAgent = (prompt: string) =>
		runAgentInSandbox({
			request: { prompt, timeout: 120 },
			config,
		});

	const app = createApp({
		runAgent,
		auth,
		webhookSecret,
		botAllowlist,
		ownBotLogin,
		port,
	});

	serve({ fetch: app.fetch, port }, () => {
		console.log(`PR Companion gateway listening on http://localhost:${port}`);
		console.log("Webhook endpoint: POST /webhooks/github");
	});
}
