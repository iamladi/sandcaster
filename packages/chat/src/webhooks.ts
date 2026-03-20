import type { Chat } from "chat";
import { Hono } from "hono";

export function createChatWebhookRoutes(bot: Chat): Hono {
	const app = new Hono();

	for (const [name, handler] of Object.entries(bot.webhooks)) {
		app.post(`/${name}`, async (c) => {
			const response = await handler(c.req.raw);
			return response;
		});
	}

	return app;
}
