import { importPKCS8, SignJWT } from "jose";
import type { AuthMode, ResolvedToken } from "./types.js";

const APP_VARS = [
	"GITHUB_APP_ID",
	"GITHUB_APP_PRIVATE_KEY",
	"GITHUB_APP_INSTALLATION_ID",
] as const;

export function resolveAuthMode(
	env: Record<string, string | undefined>,
): AuthMode {
	const appId = env.GITHUB_APP_ID;
	const privateKey = env.GITHUB_APP_PRIVATE_KEY;
	const installationId = env.GITHUB_APP_INSTALLATION_ID;

	const appVarsPresent = APP_VARS.map((v) => !!env[v]);
	const anyAppVar = appVarsPresent.some(Boolean);
	const allAppVars = appVarsPresent.every(Boolean);

	if (anyAppVar && !allAppVars) {
		const missing = APP_VARS.filter((v) => !env[v]);
		throw new Error(
			`Partial GitHub App configuration. Missing: ${missing.join(", ")}`,
		);
	}

	if (allAppVars) {
		return {
			type: "app",
			appId: appId as string,
			privateKey: privateKey as string,
			installationId: installationId as string,
		};
	}

	if (env.GITHUB_TOKEN) {
		return { type: "pat", token: env.GITHUB_TOKEN };
	}

	throw new Error(
		"No GitHub auth configured. Set GITHUB_TOKEN or all three GITHUB_APP_* variables.",
	);
}

const CACHE_TTL_MS = 3_000_000; // 50 minutes

export function createTokenProvider(
	auth: AuthMode,
): () => Promise<ResolvedToken> {
	if (auth.type === "pat") {
		const resolved: ResolvedToken = {
			token: auth.token,
			authHeader: `token ${auth.token}`,
		};
		return () => Promise.resolve(resolved);
	}

	let cachedToken: string | null = null;
	let cacheExpiresAt = 0;
	let cachedCryptoKey: CryptoKey | null = null;

	return async (): Promise<ResolvedToken> => {
		const now = Date.now();

		if (cachedToken !== null && now < cacheExpiresAt) {
			return { token: cachedToken, authHeader: `token ${cachedToken}` };
		}

		if (!cachedCryptoKey) {
			cachedCryptoKey = await importPKCS8(auth.privateKey, "RS256");
		}
		const privateKey = cachedCryptoKey;
		const nowSec = Math.floor(Date.now() / 1000);
		const jwt = await new SignJWT({})
			.setProtectedHeader({ alg: "RS256" })
			.setIssuer(auth.appId)
			.setIssuedAt(nowSec - 60)
			.setExpirationTime(nowSec + 600)
			.sign(privateKey);

		// Exchange JWT for installation token
		const response = await fetch(
			`https://api.github.com/app/installations/${auth.installationId}/access_tokens`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${jwt}`,
					Accept: "application/vnd.github+json",
				},
			},
		);

		if (!response.ok) {
			throw new Error(
				`Failed to fetch installation token: ${response.status} ${response.statusText}`,
			);
		}

		const data = (await response.json()) as {
			token: string;
			expires_at: string;
		};

		cachedToken = data.token;
		cacheExpiresAt = Date.now() + CACHE_TTL_MS;

		return { token: cachedToken, authHeader: `token ${cachedToken}` };
	};
}
