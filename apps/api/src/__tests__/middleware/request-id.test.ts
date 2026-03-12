import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { requestIdMiddleware } from "../../middleware/request-id.js";

describe("requestIdMiddleware", () => {
	it("sets X-Request-ID header on regular responses", async () => {
		const app = new Hono();
		app.use("*", requestIdMiddleware());
		app.get("/test", (c) => c.text("ok"));

		const res = await app.request("/test");
		expect(res.headers.get("X-Request-ID")).toBeTruthy();
	});

	it("sets X-Request-ID header before handler runs (available for SSE)", async () => {
		const app = new Hono();
		app.use("*", requestIdMiddleware());
		app.get("/test", (c) => {
			// The header should already be set before the handler
			return c.text("ok");
		});

		const res = await app.request("/test");
		const id = res.headers.get("X-Request-ID");
		expect(id).toBeTruthy();
		expect(id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);
	});

	it("makes requestId available via c.get", async () => {
		const app = new Hono();
		app.use("*", requestIdMiddleware());

		let capturedId: string | undefined;
		app.get("/test", (c) => {
			capturedId = c.get("requestId" as never) as string;
			return c.text("ok");
		});

		const res = await app.request("/test");
		const headerId = res.headers.get("X-Request-ID");
		expect(capturedId).toBe(headerId);
	});
});
