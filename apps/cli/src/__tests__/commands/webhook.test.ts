import { describe, expect, it, vi } from "vitest";
import type { WebhookDeps } from "../../commands/webhook.js";
import {
	executeWebhookDelete,
	executeWebhookList,
	executeWebhookRegister,
	executeWebhookTest,
} from "../../commands/webhook.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(status: number, body: unknown): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => body,
		text: async () => JSON.stringify(body),
	} as Response;
}

function makeDeps(overrides: Partial<WebhookDeps> = {}): WebhookDeps & {
	output: string;
} {
	let output = "";

	return {
		fetch: vi.fn().mockResolvedValue(makeResponse(200, {})),
		stdout: {
			write: (data: string) => {
				output += data;
				return true;
			},
		},
		exit: vi.fn<(code: number) => void>(),
		getEnv: vi.fn((name: string) => {
			if (name === "E2B_API_KEY") return "test-api-key";
			return "";
		}),
		generateSecret: vi.fn().mockReturnValue("generated-secret-abc123"),
		get output() {
			return output;
		},
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// executeWebhookRegister
// ---------------------------------------------------------------------------

describe("executeWebhookRegister", () => {
	it("calls POST https://api.e2b.dev/webhooks with correct URL", async () => {
		const deps = makeDeps();

		await executeWebhookRegister(
			{ url: "https://myapp.com/webhooks/e2b", secret: undefined },
			deps,
		);

		expect(deps.fetch).toHaveBeenCalledWith(
			"https://api.e2b.dev/webhooks",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("sends Authorization: Bearer header with E2B_API_KEY", async () => {
		const deps = makeDeps();

		await executeWebhookRegister(
			{ url: "https://myapp.com/webhooks/e2b", secret: undefined },
			deps,
		);

		expect(deps.fetch).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer test-api-key",
				}),
			}),
		);
	});

	it("sends correct payload with events array", async () => {
		const deps = makeDeps();

		await executeWebhookRegister(
			{ url: "https://myapp.com/webhooks/e2b", secret: "my-secret" },
			deps,
		);

		const call = (deps.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		const body = JSON.parse(call[1].body as string);

		expect(body).toMatchObject({
			name: "sandcaster",
			url: "https://myapp.com/webhooks/e2b",
			enabled: true,
			signatureSecret: "my-secret",
			events: [
				"sandbox.lifecycle.created",
				"sandbox.lifecycle.updated",
				"sandbox.lifecycle.killed",
			],
		});
	});

	it("appends /webhooks/e2b to URL when missing", async () => {
		const deps = makeDeps();

		await executeWebhookRegister(
			{ url: "https://myapp.com", secret: undefined },
			deps,
		);

		const call = (deps.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		const body = JSON.parse(call[1].body as string);

		expect(body.url).toBe("https://myapp.com/webhooks/e2b");
	});

	it("does not double-append /webhooks/e2b when already present", async () => {
		const deps = makeDeps();

		await executeWebhookRegister(
			{ url: "https://myapp.com/webhooks/e2b", secret: undefined },
			deps,
		);

		const call = (deps.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		const body = JSON.parse(call[1].body as string);

		expect(body.url).toBe("https://myapp.com/webhooks/e2b");
	});

	it("uses --secret flag when provided", async () => {
		const deps = makeDeps();

		await executeWebhookRegister(
			{ url: "https://myapp.com/webhooks/e2b", secret: "flag-secret" },
			deps,
		);

		const call = (deps.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		const body = JSON.parse(call[1].body as string);

		expect(body.signatureSecret).toBe("flag-secret");
	});

	it("falls back to SANDCASTER_WEBHOOK_SECRET env var when no --secret", async () => {
		const deps = makeDeps({
			getEnv: (name: string) => {
				if (name === "E2B_API_KEY") return "test-api-key";
				if (name === "SANDCASTER_WEBHOOK_SECRET") return "env-secret";
				return "";
			},
		});

		await executeWebhookRegister(
			{ url: "https://myapp.com/webhooks/e2b", secret: undefined },
			deps,
		);

		const call = (deps.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		const body = JSON.parse(call[1].body as string);

		expect(body.signatureSecret).toBe("env-secret");
	});

	it("generates secret when neither flag nor env var provided", async () => {
		const deps = makeDeps();

		await executeWebhookRegister(
			{ url: "https://myapp.com/webhooks/e2b", secret: undefined },
			deps,
		);

		const call = (deps.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		const body = JSON.parse(call[1].body as string);

		expect(body.signatureSecret).toBe("generated-secret-abc123");
		expect(deps.generateSecret).toHaveBeenCalled();
	});

	it("prints result JSON to stdout", async () => {
		const result = {
			id: "wh-123",
			name: "sandcaster",
			url: "https://myapp.com/webhooks/e2b",
		};
		const deps = makeDeps({
			fetch: vi.fn().mockResolvedValue(makeResponse(200, result)),
		});

		await executeWebhookRegister(
			{ url: "https://myapp.com/webhooks/e2b", secret: undefined },
			deps,
		);

		expect(deps.output).toContain(JSON.stringify(result, null, 2));
	});

	it("exits with 1 and prints error when E2B_API_KEY is missing", async () => {
		const deps = makeDeps({
			getEnv: vi.fn().mockReturnValue(""),
		});

		await executeWebhookRegister(
			{ url: "https://myapp.com/webhooks/e2b", secret: undefined },
			deps,
		);

		expect(deps.exit).toHaveBeenCalledWith(1);
		expect(deps.output).toContain("E2B_API_KEY");
	});

	it("does not call fetch when E2B_API_KEY is missing", async () => {
		const deps = makeDeps({
			getEnv: vi.fn().mockReturnValue(""),
		});

		await executeWebhookRegister(
			{ url: "https://myapp.com/webhooks/e2b", secret: undefined },
			deps,
		);

		expect(deps.fetch).not.toHaveBeenCalled();
	});

	it("prints error and exits with 1 when HTTP request fails", async () => {
		const deps = makeDeps({
			fetch: vi
				.fn()
				.mockResolvedValue(makeResponse(400, { error: "Bad request" })),
		});

		await executeWebhookRegister(
			{ url: "https://myapp.com/webhooks/e2b", secret: undefined },
			deps,
		);

		expect(deps.exit).toHaveBeenCalledWith(1);
		expect(deps.output).toContain("400");
	});
});

// ---------------------------------------------------------------------------
// executeWebhookList
// ---------------------------------------------------------------------------

describe("executeWebhookList", () => {
	it("calls GET https://api.e2b.dev/webhooks", async () => {
		const deps = makeDeps({
			fetch: vi.fn().mockResolvedValue(makeResponse(200, [])),
		});

		await executeWebhookList(deps);

		expect(deps.fetch).toHaveBeenCalledWith(
			"https://api.e2b.dev/webhooks",
			expect.objectContaining({ method: "GET" }),
		);
	});

	it("sends Authorization: Bearer header", async () => {
		const deps = makeDeps({
			fetch: vi.fn().mockResolvedValue(makeResponse(200, [])),
		});

		await executeWebhookList(deps);

		expect(deps.fetch).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer test-api-key",
				}),
			}),
		);
	});

	it("prints each webhook id, name, url, enabled", async () => {
		const webhooks = [
			{
				id: "wh-1",
				name: "hook-one",
				url: "https://a.com/webhooks/e2b",
				enabled: true,
			},
			{
				id: "wh-2",
				name: "hook-two",
				url: "https://b.com/webhooks/e2b",
				enabled: false,
			},
		];
		const deps = makeDeps({
			fetch: vi.fn().mockResolvedValue(makeResponse(200, webhooks)),
		});

		await executeWebhookList(deps);

		expect(deps.output).toContain("wh-1");
		expect(deps.output).toContain("hook-one");
		expect(deps.output).toContain("https://a.com/webhooks/e2b");
		expect(deps.output).toContain("wh-2");
		expect(deps.output).toContain("hook-two");
		expect(deps.output).toContain("https://b.com/webhooks/e2b");
	});

	it("exits with 1 and prints error when E2B_API_KEY is missing", async () => {
		const deps = makeDeps({
			getEnv: vi.fn().mockReturnValue(""),
		});

		await executeWebhookList(deps);

		expect(deps.exit).toHaveBeenCalledWith(1);
		expect(deps.output).toContain("E2B_API_KEY");
	});

	it("prints error and exits with 1 on HTTP failure", async () => {
		const deps = makeDeps({
			fetch: vi
				.fn()
				.mockResolvedValue(makeResponse(500, { error: "Server error" })),
		});

		await executeWebhookList(deps);

		expect(deps.exit).toHaveBeenCalledWith(1);
		expect(deps.output).toContain("500");
	});
});

// ---------------------------------------------------------------------------
// executeWebhookDelete
// ---------------------------------------------------------------------------

describe("executeWebhookDelete", () => {
	it("calls DELETE https://api.e2b.dev/webhooks/{id}", async () => {
		const deps = makeDeps({
			fetch: vi.fn().mockResolvedValue(makeResponse(204, null)),
		});

		await executeWebhookDelete({ id: "wh-abc" }, deps);

		expect(deps.fetch).toHaveBeenCalledWith(
			"https://api.e2b.dev/webhooks/wh-abc",
			expect.objectContaining({ method: "DELETE" }),
		);
	});

	it("sends Authorization: Bearer header", async () => {
		const deps = makeDeps({
			fetch: vi.fn().mockResolvedValue(makeResponse(204, null)),
		});

		await executeWebhookDelete({ id: "wh-abc" }, deps);

		expect(deps.fetch).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer test-api-key",
				}),
			}),
		);
	});

	it("prints 'Webhook {id} deleted.' on success", async () => {
		const deps = makeDeps({
			fetch: vi.fn().mockResolvedValue(makeResponse(204, null)),
		});

		await executeWebhookDelete({ id: "wh-abc" }, deps);

		expect(deps.output).toContain("Webhook wh-abc deleted.");
	});

	it("exits with 1 and prints error when E2B_API_KEY is missing", async () => {
		const deps = makeDeps({
			getEnv: vi.fn().mockReturnValue(""),
		});

		await executeWebhookDelete({ id: "wh-abc" }, deps);

		expect(deps.exit).toHaveBeenCalledWith(1);
		expect(deps.output).toContain("E2B_API_KEY");
	});

	it("prints error and exits with 1 on HTTP failure", async () => {
		const deps = makeDeps({
			fetch: vi
				.fn()
				.mockResolvedValue(makeResponse(404, { error: "Not found" })),
		});

		await executeWebhookDelete({ id: "wh-abc" }, deps);

		expect(deps.exit).toHaveBeenCalledWith(1);
		expect(deps.output).toContain("404");
	});
});

// ---------------------------------------------------------------------------
// executeWebhookTest
// ---------------------------------------------------------------------------

describe("executeWebhookTest", () => {
	it("sends POST to the given URL", async () => {
		const deps = makeDeps();

		await executeWebhookTest(
			{ url: "https://myapp.com/webhooks/e2b", secret: undefined },
			deps,
		);

		expect(deps.fetch).toHaveBeenCalledWith(
			"https://myapp.com/webhooks/e2b",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("sends a test payload", async () => {
		const deps = makeDeps();

		await executeWebhookTest(
			{ url: "https://myapp.com/webhooks/e2b", secret: undefined },
			deps,
		);

		const call = (deps.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		const body = JSON.parse(call[1].body as string);

		expect(body).toMatchObject({ type: "sandbox.lifecycle.created" });
	});

	it("includes HMAC-SHA256 signature header when secret is available", async () => {
		const deps = makeDeps({
			getEnv: (name: string) => {
				if (name === "E2B_API_KEY") return "test-api-key";
				if (name === "SANDCASTER_WEBHOOK_SECRET") return "test-secret";
				return "";
			},
		});

		await executeWebhookTest(
			{ url: "https://myapp.com/webhooks/e2b", secret: undefined },
			deps,
		);

		const call = (deps.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		const headers = call[1].headers as Record<string, string>;

		expect(headers["e2b-signature"]).toMatch(/^sha256=[a-f0-9]+$/);
	});

	it("does not include signature header when no secret available", async () => {
		const deps = makeDeps({
			getEnv: (name: string) => {
				if (name === "E2B_API_KEY") return "test-api-key";
				return "";
			},
		});

		await executeWebhookTest(
			{ url: "https://myapp.com/webhooks/e2b", secret: undefined },
			deps,
		);

		const call = (deps.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		const headers = call[1].headers as Record<string, string>;

		expect(headers["e2b-signature"]).toBeUndefined();
	});

	it("uses --secret flag for HMAC when provided", async () => {
		const deps = makeDeps({
			getEnv: vi.fn().mockReturnValue(""),
		});

		await executeWebhookTest(
			{ url: "https://myapp.com/webhooks/e2b", secret: "flag-secret" },
			deps,
		);

		const call = (deps.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		const headers = call[1].headers as Record<string, string>;

		expect(headers["e2b-signature"]).toMatch(/^sha256=[a-f0-9]+$/);
	});

	it("prints success when request succeeds", async () => {
		const deps = makeDeps();

		await executeWebhookTest(
			{ url: "https://myapp.com/webhooks/e2b", secret: undefined },
			deps,
		);

		expect(deps.output).toContain("success");
	});

	it("prints failure and exits with 1 when request fails", async () => {
		const deps = makeDeps({
			fetch: vi
				.fn()
				.mockResolvedValue(makeResponse(500, { error: "Server error" })),
		});

		await executeWebhookTest(
			{ url: "https://myapp.com/webhooks/e2b", secret: undefined },
			deps,
		);

		expect(deps.exit).toHaveBeenCalledWith(1);
		expect(deps.output).toContain("500");
	});

	it("does not require E2B_API_KEY", async () => {
		const deps = makeDeps({
			getEnv: vi.fn().mockReturnValue(""),
		});

		await executeWebhookTest(
			{ url: "https://myapp.com/webhooks/e2b", secret: undefined },
			deps,
		);

		// Should still call fetch even without E2B_API_KEY
		expect(deps.fetch).toHaveBeenCalled();
		// Should NOT error about E2B_API_KEY
		expect(deps.output).not.toContain("E2B_API_KEY");
	});
});
