import { exec as execCb } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
	createSignatureVerifier,
	parseWebhookPayload,
} from "./webhook-handler.js";

export interface AppDeps {
	runAgent: (prompt: string) => AsyncGenerator<SandcasterEvent>;
	auth: AuthMode;
	webhookSecret: string;
	botAllowlist: string[];
	ownBotLogin: string;
}

export async function createApp(deps: AppDeps): Promise<Hono> {
	const app = new Hono();
	const tracker = createDeliveryTracker();
	const verifySignature = await createSignatureVerifier(deps.webhookSecret);

	app.get("/health", (c) => c.json({ status: "ok" }));

	app.post("/webhooks/github", async (c) => {
		const rawBody = new Uint8Array(await c.req.arrayBuffer());

		const signature = c.req.header("x-hub-signature-256") ?? "";
		if (!signature) {
			return c.json({ error: "Missing signature" }, 401);
		}

		const valid = await verifySignature(rawBody, signature);
		if (!valid) {
			return c.json({ error: "Invalid signature" }, 401);
		}

		let payload: unknown;
		try {
			payload = JSON.parse(new TextDecoder().decode(rawBody));
		} catch {
			return c.json({ error: "Invalid JSON payload" }, 400);
		}

		const event = parseWebhookPayload(payload, {
			webhookSecret: deps.webhookSecret,
			botAllowlist: deps.botAllowlist,
			ownBotLogin: deps.ownBotLogin,
		});

		if (event === null) {
			return c.body(null, 204);
		}

		const deliveryId = c.req.header("x-github-delivery") ?? "";
		if (!tracker.tryAcquire(deliveryId)) {
			return c.json({ error: "Duplicate delivery" }, 409);
		}

		event.deliveryId = deliveryId;

		void processReview(deps, event, tracker);

		return c.json({ accepted: true }, 202);
	});

	return app;
}

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

const patchDeps = createRealPatchDeps();
const applier = createPatchApplier(patchDeps);

async function processReview(
	deps: AppDeps,
	event: ReviewEvent,
	tracker: ReturnType<typeof createDeliveryTracker>,
): Promise<void> {
	const getToken = createTokenProvider(deps.auth);
	const github = createGitHubClient({ getToken });

	try {
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

		for (let i = 0; i < allComments.length; i += MAX_COMMENTS_PER_BATCH) {
			const batch = allComments.slice(i, i + MAX_COMMENTS_PER_BATCH);
			const prompt = formatPrompt(batch);

			let resultContent = "";
			for await (const ev of deps.runAgent(prompt)) {
				if (ev.type === "result") {
					resultContent = ev.content;
				}
			}

			if (!resultContent) continue;

			const agentOutput = JSON.parse(resultContent);
			const token = await getToken();

			const result = await applier.applyAndPush({
				cloneUrl: event.cloneUrl,
				branch: event.branch,
				token,
				agentOutput,
				isFork: event.isFork,
			});

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

function createRealPatchDeps(): PatchApplierDeps {
	return {
		exec(cmd: string, opts?: { cwd?: string }): Promise<string> {
			return new Promise<string>((resolve, reject) => {
				execCb(
					cmd,
					{
						cwd: opts?.cwd,
						encoding: "utf-8",
						timeout: 60_000,
						maxBuffer: 10 * 1024 * 1024,
					},
					(err, stdout) => {
						if (err) reject(err);
						else resolve(stdout);
					},
				);
			});
		},
		writeFile(path: string, content: string): Promise<void> {
			return writeFile(path, content, "utf-8");
		},
		readFile(path: string): Promise<string> {
			return readFile(path, "utf-8");
		},
		mkTempDir(): Promise<string> {
			return mkdtemp(join(tmpdir(), "pr-companion-"));
		},
		rmDir(path: string): Promise<void> {
			return rm(path, { recursive: true, force: true });
		},
	};
}

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
	if (Number.isNaN(port) || port < 1 || port > 65535) {
		console.error("PORT must be a valid port number (1-65535).");
		process.exit(1);
	}

	const runAgent = (prompt: string) =>
		runAgentInSandbox({
			request: { prompt, timeout: 120 },
			config,
		});

	createApp({
		runAgent,
		auth,
		webhookSecret,
		botAllowlist,
		ownBotLogin,
	}).then((app) => {
		serve({ fetch: app.fetch, port }, () => {
			console.log(`PR Companion gateway listening on http://localhost:${port}`);
			console.log("Webhook endpoint: POST /webhooks/github");
		});
	});
}
