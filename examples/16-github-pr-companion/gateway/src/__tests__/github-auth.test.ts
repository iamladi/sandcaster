import { decodeJwt, generateKeyPair } from "jose";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
	vi,
} from "vitest";
import { createTokenProvider, resolveAuthMode } from "../github-auth.js";
import type { AuthMode } from "../types.js";

// ---------------------------------------------------------------------------
// MSW server — mocks GitHub App installation token endpoint
// ---------------------------------------------------------------------------

const INSTALLATION_TOKEN = "ghs_test_token";
const INSTALLATION_TOKEN_EXPIRES = new Date(
	Date.now() + 60 * 60 * 1000,
).toISOString();

const server = setupServer(
	http.post("https://api.github.com/app/installations/:id/access_tokens", () =>
		HttpResponse.json({
			token: INSTALLATION_TOKEN,
			expires_at: INSTALLATION_TOKEN_EXPIRES,
		}),
	),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// ---------------------------------------------------------------------------
// resolveAuthMode
// ---------------------------------------------------------------------------

describe("resolveAuthMode", () => {
	test("returns PAT mode when GITHUB_TOKEN is set", () => {
		const result = resolveAuthMode({ GITHUB_TOKEN: "ghp_mytoken" });

		expect(result).toEqual({ type: "pat", token: "ghp_mytoken" });
	});

	test("returns App mode when all three App vars are set", () => {
		const result = resolveAuthMode({
			GITHUB_APP_ID: "123",
			GITHUB_APP_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----",
			GITHUB_APP_INSTALLATION_ID: "456",
		});

		expect(result).toEqual({
			type: "app",
			appId: "123",
			privateKey: "-----BEGIN RSA PRIVATE KEY-----",
			installationId: "456",
		});
	});

	test("App mode takes precedence when both PAT and App vars are set", () => {
		const result = resolveAuthMode({
			GITHUB_TOKEN: "ghp_mytoken",
			GITHUB_APP_ID: "123",
			GITHUB_APP_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----",
			GITHUB_APP_INSTALLATION_ID: "456",
		});

		expect(result.type).toBe("app");
	});

	test("throws when neither PAT nor App config is provided", () => {
		expect(() => resolveAuthMode({})).toThrow();
	});

	test("throws when App config is incomplete — missing GITHUB_APP_PRIVATE_KEY", () => {
		expect(() =>
			resolveAuthMode({
				GITHUB_APP_ID: "123",
				GITHUB_APP_INSTALLATION_ID: "456",
			}),
		).toThrow();
	});

	test("throws when App config is incomplete — missing GITHUB_APP_ID", () => {
		expect(() =>
			resolveAuthMode({
				GITHUB_APP_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----",
				GITHUB_APP_INSTALLATION_ID: "456",
			}),
		).toThrow();
	});

	test("throws when App config is incomplete — missing GITHUB_APP_INSTALLATION_ID", () => {
		expect(() =>
			resolveAuthMode({
				GITHUB_APP_ID: "123",
				GITHUB_APP_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----",
			}),
		).toThrow();
	});
});

// ---------------------------------------------------------------------------
// createTokenProvider — PAT mode
// ---------------------------------------------------------------------------

describe("createTokenProvider (PAT mode)", () => {
	test("returns token with authHeader format 'token {pat}'", async () => {
		const auth: AuthMode = { type: "pat", token: "ghp_mytoken" };
		const getToken = createTokenProvider(auth);

		const resolved = await getToken();

		expect(resolved.authHeader).toBe("token ghp_mytoken");
		expect(resolved.token).toBe("ghp_mytoken");
	});

	test("always returns the same token without re-fetching", async () => {
		const auth: AuthMode = { type: "pat", token: "ghp_mytoken" };
		const getToken = createTokenProvider(auth);

		const first = await getToken();
		const second = await getToken();

		expect(first).toEqual(second);
	});
});

// ---------------------------------------------------------------------------
// createTokenProvider — App mode
// ---------------------------------------------------------------------------

describe("createTokenProvider (App mode)", () => {
	// Generate a real RSA key pair once for all App mode tests
	let privateKeyPem: string;
	let appId: string;
	let installationId: string;

	beforeAll(async () => {
		const { privateKey } = await generateKeyPair("RS256", {
			extractable: true,
		});
		// Export to PEM so the implementation can import it as-is
		const { exportPKCS8 } = await import("jose");
		privateKeyPem = await exportPKCS8(privateKey);
		appId = "999";
		installationId = "12345";
	});

	function makeAppAuth(): AuthMode {
		return {
			type: "app",
			appId,
			privateKey: privateKeyPem,
			installationId,
		};
	}

	test("generates a valid JWT with correct iss, iat, and exp claims", async () => {
		vi.useFakeTimers();
		const now = Math.floor(Date.now() / 1000);

		const auth = makeAppAuth();

		// We intercept the GitHub API request to capture the Authorization header
		let capturedJwt: string | undefined;
		server.use(
			http.post(
				"https://api.github.com/app/installations/:id/access_tokens",
				({ request }) => {
					const authHeader = request.headers.get("Authorization") ?? "";
					// Header format: "Bearer <jwt>"
					capturedJwt = authHeader.replace(/^Bearer\s+/, "");
					return HttpResponse.json({
						token: INSTALLATION_TOKEN,
						expires_at: INSTALLATION_TOKEN_EXPIRES,
					});
				},
			),
		);

		const getToken = createTokenProvider(auth);
		await getToken();

		expect(capturedJwt).toBeDefined();

		const claims = decodeJwt(capturedJwt as string);
		expect(claims.iss).toBe(appId);
		// iat should be now - 60s (clock skew buffer)
		expect(claims.iat).toBe(now - 60);
		// exp should be now + 10min
		expect(claims.exp).toBe(now + 10 * 60);

		vi.useRealTimers();
	});

	test("exchanges JWT for installation token via GitHub API", async () => {
		const auth = makeAppAuth();
		const getToken = createTokenProvider(auth);

		const resolved = await getToken();

		expect(resolved.token).toBe(INSTALLATION_TOKEN);
	});

	test("returns authHeader format 'token {installation_token}'", async () => {
		const auth = makeAppAuth();
		const getToken = createTokenProvider(auth);

		const resolved = await getToken();

		expect(resolved.authHeader).toBe(`token ${INSTALLATION_TOKEN}`);
	});

	test("caches token and does not re-fetch within 50-minute window", async () => {
		vi.useFakeTimers();

		let callCount = 0;
		server.use(
			http.post(
				"https://api.github.com/app/installations/:id/access_tokens",
				() => {
					callCount++;
					return HttpResponse.json({
						token: INSTALLATION_TOKEN,
						expires_at: INSTALLATION_TOKEN_EXPIRES,
					});
				},
			),
		);

		const auth = makeAppAuth();
		const getToken = createTokenProvider(auth);

		await getToken();
		// Advance time by 49 minutes — still within cache window
		vi.advanceTimersByTime(49 * 60 * 1000);
		await getToken();

		expect(callCount).toBe(1);

		vi.useRealTimers();
	});

	test("refreshes token after cache expires (50 minutes)", async () => {
		vi.useFakeTimers();

		let callCount = 0;
		server.use(
			http.post(
				"https://api.github.com/app/installations/:id/access_tokens",
				() => {
					callCount++;
					return HttpResponse.json({
						token: INSTALLATION_TOKEN,
						expires_at: INSTALLATION_TOKEN_EXPIRES,
					});
				},
			),
		);

		const auth = makeAppAuth();
		const getToken = createTokenProvider(auth);

		await getToken();
		// Advance time past the 50-minute cache window
		vi.advanceTimersByTime(51 * 60 * 1000);
		await getToken();

		expect(callCount).toBe(2);

		vi.useRealTimers();
	});
});
