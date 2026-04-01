import type {
	CommandOptions,
	CommandResult,
	CreateResult,
	SandboxInstance,
	SandboxProvider,
	SandboxProviderConfig,
	SandboxProviderName,
} from "../sandbox-provider.js";
import { SandboxOperationError } from "../sandbox-provider.js";

// ---------------------------------------------------------------------------
// Template validation
// Non-empty string with no spaces
// ---------------------------------------------------------------------------

function isValidTemplate(template: string): boolean {
	if (template.length === 0) return false;
	if (/\s/.test(template)) return false;
	return true;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function authHeaders(token: string): Record<string, string> {
	return {
		Authorization: `Bearer ${token}`,
		"Content-Type": "application/json",
	};
}

async function workerPost(
	url: string,
	token: string,
	body: unknown,
): Promise<Response> {
	return fetch(url, {
		method: "POST",
		headers: authHeaders(token),
		body: JSON.stringify(body),
	});
}

// ---------------------------------------------------------------------------
// createCloudflareProvider
// ---------------------------------------------------------------------------

export function createCloudflareProvider(): SandboxProvider {
	return {
		name: "cloudflare" as SandboxProviderName,

		async create(config: SandboxProviderConfig): Promise<CreateResult> {
			// Resolve Worker URL
			const workerUrl =
				config.metadata?.workerUrl ?? process.env.CLOUDFLARE_SANDBOX_WORKER_URL;

			if (!workerUrl) {
				return {
					ok: false,
					code: "SANDBOX_ERROR",
					message: "Cloudflare Worker URL not configured.",
					hint: "Set CLOUDFLARE_SANDBOX_WORKER_URL or pass config.metadata.workerUrl. Deploy the Worker first: cd packages/cloudflare-worker && wrangler deploy",
				};
			}

			// Validate template if provided
			if (config.template !== undefined && !isValidTemplate(config.template)) {
				return {
					ok: false,
					code: "INVALID_TEMPLATE_FOR_PROVIDER",
					message: `Invalid Cloudflare sandbox template: "${config.template}". Template must be non-empty with no spaces.`,
					hint: "Provide a valid template identifier (no spaces)",
				};
			}

			// POST /sandbox/create — authenticated with API key
			const createHeaders: Record<string, string> = {
				"Content-Type": "application/json",
			};
			if (config.apiKey) {
				createHeaders.Authorization = `Bearer ${config.apiKey}`;
			}

			let createResp: Response;
			try {
				createResp = await fetch(`${workerUrl}/sandbox/create`, {
					method: "POST",
					headers: createHeaders,
					body: JSON.stringify({
						...(config.template !== undefined
							? { template: config.template }
							: {}),
						...(config.timeoutMs !== undefined
							? { timeoutMs: config.timeoutMs }
							: {}),
						...(config.envs !== undefined ? { envs: config.envs } : {}),
					}),
				});
			} catch (err) {
				if (
					err instanceof Error &&
					(err.name === "AbortError" ||
						err.message.toLowerCase().includes("timeout") ||
						err.message.toLowerCase().includes("timed out"))
				) {
					return {
						ok: false,
						code: "SANDBOX_TIMEOUT",
						message: "Cloudflare Worker request timed out.",
						hint: "Try again or increase timeout",
					};
				}
				return {
					ok: false,
					code: "SANDBOX_ERROR",
					message: `Failed to reach Cloudflare Worker: ${err instanceof Error ? err.message : String(err)}`,
				};
			}

			if (createResp.status === 401 || createResp.status === 403) {
				return {
					ok: false,
					code: "PROVIDER_AUTH_MISSING",
					message: "Cloudflare Worker authentication failed.",
					hint: `Check the Worker is deployed and accessible. Status: ${createResp.status}`,
				};
			}

			if (createResp.status === 429) {
				return {
					ok: false,
					code: "RATE_LIMIT",
					message: "Cloudflare Worker rate limit exceeded.",
					hint: "Rate limit — wait and retry",
				};
			}

			if (!createResp.ok) {
				return {
					ok: false,
					code: "SANDBOX_ERROR",
					message: `Cloudflare Worker returned HTTP ${createResp.status}.`,
				};
			}

			const { sessionId, token } = (await createResp.json()) as {
				sessionId: string;
				token: string;
			};

			// Build SandboxInstance
			const instance: SandboxInstance = {
				workDir: "/workspace",
				capabilities: {
					fileSystem: true,
					shellExec: true,
					envInjection: true,
					streaming: false,
					networkPolicy: false,
					snapshots: false,
					reconnect: false,
					customImage: false,
				},
				files: {
					async write(
						path: string,
						content: string | Uint8Array,
					): Promise<void> {
						let body: Record<string, string>;
						if (typeof content === "string") {
							body = { path, content };
						} else {
							// Binary content: base64-encode to avoid UTF-8 corruption
							body = {
								path,
								content: Buffer.from(content).toString("base64"),
								encoding: "base64",
							};
						}
						const resp = await workerPost(
							`${workerUrl}/sandbox/${sessionId}/files/write`,
							token,
							body,
						);
						if (!resp.ok) {
							throw new SandboxOperationError(
								`files.write failed: HTTP ${resp.status}`,
								resp.status === 401 || resp.status === 403
									? "PROVIDER_AUTH_MISSING"
									: "SANDBOX_ERROR",
							);
						}
					},

					async read(
						path: string,
						opts?: { format?: "text" | "bytes" },
					): Promise<string | Uint8Array> {
						const url = new URL(`${workerUrl}/sandbox/${sessionId}/files/read`);
						url.searchParams.set("path", path);
						const resp = await fetch(url.toString(), {
							method: "GET",
							headers: {
								Authorization: `Bearer ${token}`,
							},
						});
						if (!resp.ok) {
							throw new SandboxOperationError(
								`files.read failed: HTTP ${resp.status}`,
								resp.status === 401 || resp.status === 403
									? "PROVIDER_AUTH_MISSING"
									: "SANDBOX_ERROR",
							);
						}
						const { content, encoding } = (await resp.json()) as {
							content: string;
							encoding?: string;
						};
						if (opts?.format === "bytes") {
							if (encoding === "base64") {
								return new Uint8Array(Buffer.from(content, "base64"));
							}
							return new TextEncoder().encode(content);
						}
						return content;
					},
				},
				commands: {
					async run(
						cmd: string,
						opts?: CommandOptions,
					): Promise<CommandResult> {
						const body: Record<string, unknown> = { cmd };
						if (opts?.timeoutMs !== undefined) {
							body.timeoutMs = opts.timeoutMs;
						}
						const resp = await workerPost(
							`${workerUrl}/sandbox/${sessionId}/exec`,
							token,
							body,
						);
						if (!resp.ok) {
							throw new SandboxOperationError(
								`commands.run failed: HTTP ${resp.status}`,
								resp.status === 401 || resp.status === 403
									? "PROVIDER_AUTH_MISSING"
									: "SANDBOX_ERROR",
							);
						}
						const result = (await resp.json()) as CommandResult;

						// Call streaming callbacks with buffered output (non-streaming compatibility)
						if (result.stdout) opts?.onStdout?.(result.stdout);
						if (result.stderr) opts?.onStderr?.(result.stderr);

						return result;
					},
				},
				async kill(): Promise<void> {
					try {
						await workerPost(
							`${workerUrl}/sandbox/${sessionId}/kill`,
							token,
							{},
						);
					} catch {
						// Idempotent — ignore errors on double-kill
					}
				},
			};

			return { ok: true, instance };
		},
	};
}
