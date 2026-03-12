import { describe, expect, test } from "vitest";
import { createApp } from "../../app.js";

describe("GET /health", () => {
	test("returns 200 with status ok and version", async () => {
		const app = createApp({ version: "1.2.3" });
		const res = await app.request("/health");

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({ status: "ok", version: "1.2.3" });
	});

	test("defaults version to 0.0.0 when not provided", async () => {
		const app = createApp({});
		const res = await app.request("/health");

		const body = await res.json();
		expect(body.version).toBe("0.0.0");
	});
});
