import { createHmac, randomBytes } from "node:crypto";
import { defineCommand } from "citty";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebhookDeps {
	fetch: typeof globalThis.fetch;
	stdout: { write: (data: string) => boolean };
	exit: (code: number) => void;
	getEnv: (name: string) => string;
	generateSecret: () => string;
}

export interface RegisterArgs {
	url: string;
	secret: string | undefined;
}

export interface DeleteArgs {
	id: string;
}

export interface TestArgs {
	url: string;
	secret: string | undefined;
}

// ---------------------------------------------------------------------------
// Core logic (injectable for testing)
// ---------------------------------------------------------------------------

function requireApiKey(deps: WebhookDeps): string | null {
	const key = deps.getEnv("E2B_API_KEY");
	if (!key) {
		deps.stdout.write("Error: E2B_API_KEY environment variable is required.\n");
		deps.exit(1);
		return null;
	}
	return key;
}

function authHeaders(apiKey: string): Record<string, string> {
	return {
		Authorization: `Bearer ${apiKey}`,
		"Content-Type": "application/json",
	};
}

export async function executeWebhookRegister(
	args: RegisterArgs,
	deps: WebhookDeps,
): Promise<void> {
	const apiKey = requireApiKey(deps);
	if (!apiKey) return;

	// Resolve URL — append /webhooks/e2b if not already present
	const url = args.url.endsWith("/webhooks/e2b")
		? args.url
		: `${args.url}/webhooks/e2b`;

	// Resolve secret: flag > env > generate
	const secret =
		args.secret ||
		deps.getEnv("SANDCASTER_WEBHOOK_SECRET") ||
		deps.generateSecret();

	const payload = {
		name: "sandcaster",
		url,
		enabled: true,
		signatureSecret: secret,
		events: [
			"sandbox.lifecycle.created",
			"sandbox.lifecycle.updated",
			"sandbox.lifecycle.killed",
		],
	};

	let response: Response;
	try {
		response = await deps.fetch("https://api.e2b.dev/webhooks", {
			method: "POST",
			headers: authHeaders(apiKey),
			body: JSON.stringify(payload),
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		deps.stdout.write(`Error: ${msg}\n`);
		deps.exit(1);
		return;
	}

	if (!response.ok) {
		const body = await response.text();
		deps.stdout.write(`Error: HTTP ${response.status} from E2B API: ${body}\n`);
		deps.exit(1);
		return;
	}

	const result = await response.json();
	deps.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export async function executeWebhookList(deps: WebhookDeps): Promise<void> {
	const apiKey = requireApiKey(deps);
	if (!apiKey) return;

	let response: Response;
	try {
		response = await deps.fetch("https://api.e2b.dev/webhooks", {
			method: "GET",
			headers: authHeaders(apiKey),
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		deps.stdout.write(`Error: ${msg}\n`);
		deps.exit(1);
		return;
	}

	if (!response.ok) {
		const body = await response.text();
		deps.stdout.write(`Error: HTTP ${response.status} from E2B API: ${body}\n`);
		deps.exit(1);
		return;
	}

	const webhooks = (await response.json()) as Array<{
		id: string;
		name: string;
		url: string;
		enabled: boolean;
	}>;

	for (const wh of webhooks) {
		deps.stdout.write(
			`${wh.id}  ${wh.name}  ${wh.url}  enabled=${wh.enabled}\n`,
		);
	}
}

export async function executeWebhookDelete(
	args: DeleteArgs,
	deps: WebhookDeps,
): Promise<void> {
	const apiKey = requireApiKey(deps);
	if (!apiKey) return;

	let response: Response;
	try {
		response = await deps.fetch(`https://api.e2b.dev/webhooks/${args.id}`, {
			method: "DELETE",
			headers: authHeaders(apiKey),
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		deps.stdout.write(`Error: ${msg}\n`);
		deps.exit(1);
		return;
	}

	if (!response.ok) {
		const body = await response.text();
		deps.stdout.write(`Error: HTTP ${response.status} from E2B API: ${body}\n`);
		deps.exit(1);
		return;
	}

	deps.stdout.write(`Webhook ${args.id} deleted.\n`);
}

export async function executeWebhookTest(
	args: TestArgs,
	deps: WebhookDeps,
): Promise<void> {
	const testPayload = {
		type: "sandbox.lifecycle.created",
		sandboxId: "test-sandbox-id",
		timestamp: new Date().toISOString(),
	};

	const body = JSON.stringify(testPayload);

	// Resolve secret: flag > env (no generation for test)
	const secret =
		args.secret || deps.getEnv("SANDCASTER_WEBHOOK_SECRET") || undefined;

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};

	if (secret) {
		const sig = createHmac("sha256", secret).update(body).digest("hex");
		headers["e2b-signature"] = `sha256=${sig}`;
	}

	let response: Response;
	try {
		response = await deps.fetch(args.url, {
			method: "POST",
			headers,
			body,
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		deps.stdout.write(`Error: ${msg}\n`);
		deps.exit(1);
		return;
	}

	if (!response.ok) {
		const responseBody = await response.text();
		deps.stdout.write(
			`Error: HTTP ${response.status} from webhook endpoint: ${responseBody}\n`,
		);
		deps.exit(1);
		return;
	}

	deps.stdout.write(`Test webhook sent successfully to ${args.url}\n`);
}

// ---------------------------------------------------------------------------
// Production deps
// ---------------------------------------------------------------------------

const prodDeps: WebhookDeps = {
	fetch: globalThis.fetch,
	stdout: process.stdout,
	exit: (code: number) => process.exit(code),
	getEnv: (name: string) => process.env[name]?.trim() ?? "",
	generateSecret: () => randomBytes(32).toString("hex"),
};

// ---------------------------------------------------------------------------
// citty command definition
// ---------------------------------------------------------------------------

const registerCommand = defineCommand({
	meta: {
		name: "register",
		description: "Register an E2B lifecycle webhook",
	},
	args: {
		url: {
			type: "positional",
			required: true,
			description: "Webhook URL (e.g. https://myapp.com)",
		},
		secret: {
			type: "string",
			description:
				"Signature secret (falls back to SANDCASTER_WEBHOOK_SECRET env, or generates one)",
		},
	},
	async run({ args }) {
		await executeWebhookRegister(
			{
				url: args.url as string,
				secret: args.secret as string | undefined,
			},
			prodDeps,
		);
	},
});

const listCommand = defineCommand({
	meta: {
		name: "list",
		description: "List registered E2B webhooks",
	},
	async run() {
		await executeWebhookList(prodDeps);
	},
});

const deleteCommand = defineCommand({
	meta: {
		name: "delete",
		description: "Delete an E2B webhook by ID",
	},
	args: {
		id: {
			type: "positional",
			required: true,
			description: "Webhook ID",
		},
	},
	async run({ args }) {
		await executeWebhookDelete({ id: args.id as string }, prodDeps);
	},
});

const testCommand = defineCommand({
	meta: {
		name: "test",
		description: "Send a test event to a webhook URL",
	},
	args: {
		url: {
			type: "positional",
			required: true,
			description: "Webhook URL to test",
		},
		secret: {
			type: "string",
			description:
				"Signature secret for HMAC (falls back to SANDCASTER_WEBHOOK_SECRET env)",
		},
	},
	async run({ args }) {
		await executeWebhookTest(
			{
				url: args.url as string,
				secret: args.secret as string | undefined,
			},
			prodDeps,
		);
	},
});

export const webhookCommand = defineCommand({
	meta: {
		name: "webhook",
		description: "Manage E2B webhooks",
	},
	subCommands: {
		register: registerCommand,
		list: listCommand,
		delete: deleteCommand,
		test: testCommand,
	},
});
