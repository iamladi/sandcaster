import type { SandcasterConfig } from "@sandcaster/core";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServeArgs, ServeDeps } from "../../commands/serve.js";
import { executeServe } from "../../commands/serve.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDefaultDeps(overrides: Partial<ServeDeps> = {}): ServeDeps {
	return {
		loadConfig: (_dir?: string): SandcasterConfig | null => null,
		createApp: vi.fn().mockReturnValue(new Hono()),
		startServer: vi.fn(),
		stdout: { write: vi.fn<(data: string) => boolean>().mockReturnValue(true) },
		exit: vi.fn<(code: number) => void>(),
		...overrides,
	};
}

function makeDefaultArgs(overrides: Partial<ServeArgs> = {}): ServeArgs {
	return {
		port: 8000,
		host: "0.0.0.0",
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("executeServe", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	describe("server startup", () => {
		it("calls startServer with the app and port/host from args", async () => {
			const deps = makeDefaultDeps();
			const app = new Hono();
			(deps.createApp as ReturnType<typeof vi.fn>).mockReturnValue(app);

			await executeServe(
				makeDefaultArgs({ port: 9000, host: "127.0.0.1" }),
				deps,
			);

			expect(deps.startServer).toHaveBeenCalledWith(app, {
				port: 9000,
				hostname: "127.0.0.1",
			});
		});

		it("calls startServer with default port 8000 and host 0.0.0.0", async () => {
			const deps = makeDefaultDeps();

			await executeServe(makeDefaultArgs(), deps);

			expect(deps.startServer).toHaveBeenCalledWith(expect.any(Hono), {
				port: 8000,
				hostname: "0.0.0.0",
			});
		});

		it("writes listening message to stdout", async () => {
			const deps = makeDefaultDeps();

			await executeServe(
				makeDefaultArgs({ port: 8000, host: "0.0.0.0" }),
				deps,
			);

			expect(deps.stdout.write).toHaveBeenCalledWith(
				"Sandcaster API listening on http://0.0.0.0:8000\n",
			);
		});

		it("writes listening message with custom port and host", async () => {
			const deps = makeDefaultDeps();

			await executeServe(
				makeDefaultArgs({ port: 3000, host: "localhost" }),
				deps,
			);

			expect(deps.stdout.write).toHaveBeenCalledWith(
				"Sandcaster API listening on http://localhost:3000\n",
			);
		});
	});

	describe("createApp invocation", () => {
		it("calls createApp and passes the result to startServer", async () => {
			const deps = makeDefaultDeps();
			const app = new Hono();
			(deps.createApp as ReturnType<typeof vi.fn>).mockReturnValue(app);

			await executeServe(makeDefaultArgs(), deps);

			expect(deps.createApp).toHaveBeenCalledTimes(1);
			expect(deps.startServer).toHaveBeenCalledWith(app, expect.any(Object));
		});

		it("passes apiKey from env to createApp", async () => {
			vi.stubEnv("SANDCASTER_API_KEY", "test-api-key");
			const deps = makeDefaultDeps();

			await executeServe(makeDefaultArgs(), deps);

			expect(deps.createApp).toHaveBeenCalledWith(
				expect.objectContaining({ apiKey: "test-api-key" }),
			);
		});

		it("passes undefined apiKey when env var is not set", async () => {
			const deps = makeDefaultDeps();

			await executeServe(makeDefaultArgs(), deps);

			expect(deps.createApp).toHaveBeenCalledWith(
				expect.objectContaining({ apiKey: undefined }),
			);
		});

		it("passes webhookSecret from SANDSTORM_WEBHOOK_SECRET compat env var", async () => {
			vi.stubEnv("SANDSTORM_WEBHOOK_SECRET", "compat-secret");
			const deps = makeDefaultDeps();

			await executeServe(makeDefaultArgs(), deps);

			expect(deps.createApp).toHaveBeenCalledWith(
				expect.objectContaining({ webhookSecret: "compat-secret" }),
			);
		});

		it("prefers SANDCASTER_WEBHOOK_SECRET over SANDSTORM_WEBHOOK_SECRET", async () => {
			vi.stubEnv("SANDSTORM_WEBHOOK_SECRET", "compat-secret");
			vi.stubEnv("SANDCASTER_WEBHOOK_SECRET", "new-secret");
			const deps = makeDefaultDeps();

			await executeServe(makeDefaultArgs(), deps);

			expect(deps.createApp).toHaveBeenCalledWith(
				expect.objectContaining({ webhookSecret: "new-secret" }),
			);
		});

		it("passes corsOrigins as array from comma-separated env var", async () => {
			vi.stubEnv("SANDCASTER_CORS_ORIGINS", "https://a.com,https://b.com");
			const deps = makeDefaultDeps();

			await executeServe(makeDefaultArgs(), deps);

			expect(deps.createApp).toHaveBeenCalledWith(
				expect.objectContaining({
					corsOrigins: ["https://a.com", "https://b.com"],
				}),
			);
		});

		it("passes undefined corsOrigins when env var is not set", async () => {
			// Don't stub — env var not present by default
			vi.stubEnv("SANDCASTER_CORS_ORIGINS", "");
			const deps = makeDefaultDeps();

			await executeServe(makeDefaultArgs(), deps);

			expect(deps.createApp).toHaveBeenCalledWith(
				expect.objectContaining({ corsOrigins: undefined }),
			);
		});
	});

	describe("config loading", () => {
		it("calls loadConfig", async () => {
			const loadConfig = vi.fn().mockReturnValue(null);
			const deps = makeDefaultDeps({ loadConfig });

			await executeServe(makeDefaultArgs(), deps);

			expect(loadConfig).toHaveBeenCalledTimes(1);
		});
	});
});
