import { describe, expect, test } from "vitest";
import { createApp } from "../app.js";

describe("createApp", () => {
	test("returns a Hono app with request method", () => {
		const app = createApp({});
		expect(app).toBeDefined();
		expect(typeof app.request).toBe("function");
	});

	test("unknown routes return 404", async () => {
		const app = createApp({});
		const res = await app.request("/nonexistent");
		expect(res.status).toBe(404);
	});
});
