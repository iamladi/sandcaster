import type { Chat } from "chat";
import { describe, expect, test, vi } from "vitest";
import { createChatWebhookRoutes } from "../webhooks.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockBot(
	webhooks: Record<string, (req: Request) => Promise<Response>>,
): Chat {
	return { webhooks } as unknown as Chat;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createChatWebhookRoutes", () => {
	test("creates POST route for slack webhook", async () => {
		const slackHandler = vi
			.fn()
			.mockResolvedValue(new Response("ok", { status: 200 }));
		const bot = makeMockBot({ slack: slackHandler });

		const app = createChatWebhookRoutes(bot);
		const res = await app.request("/slack", { method: "POST" });

		expect(res.status).toBe(200);
		expect(slackHandler).toHaveBeenCalledOnce();
	});

	test("creates POST routes for multiple adapters (slack + discord)", async () => {
		const slackHandler = vi
			.fn()
			.mockResolvedValue(new Response("slack ok", { status: 200 }));
		const discordHandler = vi
			.fn()
			.mockResolvedValue(new Response("discord ok", { status: 200 }));
		const bot = makeMockBot({ slack: slackHandler, discord: discordHandler });

		const app = createChatWebhookRoutes(bot);

		const slackRes = await app.request("/slack", { method: "POST" });
		expect(slackRes.status).toBe(200);
		expect(slackHandler).toHaveBeenCalledOnce();

		const discordRes = await app.request("/discord", { method: "POST" });
		expect(discordRes.status).toBe(200);
		expect(discordHandler).toHaveBeenCalledOnce();
	});

	test("returns empty app when no webhooks configured", async () => {
		const bot = makeMockBot({});

		const app = createChatWebhookRoutes(bot);
		const res = await app.request("/slack", { method: "POST" });

		expect(res.status).toBe(404);
	});

	test("forwards request to webhook handler and returns response", async () => {
		let capturedRequest: Request | undefined;
		const handler = vi.fn().mockImplementation(async (req: Request) => {
			capturedRequest = req;
			return new Response("forwarded", { status: 201 });
		});
		const bot = makeMockBot({ slack: handler });

		const app = createChatWebhookRoutes(bot);
		const res = await app.request("/slack", {
			method: "POST",
			body: "payload",
		});

		expect(res.status).toBe(201);
		expect(await res.text()).toBe("forwarded");
		expect(capturedRequest).toBeInstanceOf(Request);
	});

	test("routes only respond to POST method", async () => {
		const handler = vi
			.fn()
			.mockResolvedValue(new Response("ok", { status: 200 }));
		const bot = makeMockBot({ slack: handler });

		const app = createChatWebhookRoutes(bot);

		const getRes = await app.request("/slack", { method: "GET" });
		expect(getRes.status).toBe(404);
		expect(handler).not.toHaveBeenCalled();
	});
});
