import type {
	CommandOptions,
	CreateResult,
	SandboxProvider,
	SandboxProviderConfig,
	SandboxProviderName,
} from "../sandbox-provider.js";

// ---------------------------------------------------------------------------
// Template validation
// E2B templates are alphanumeric with hyphens (and underscores)
// ---------------------------------------------------------------------------

const VALID_TEMPLATE_RE = /^[a-zA-Z0-9_-]+$/;

function isValidTemplate(template: string): boolean {
	return VALID_TEMPLATE_RE.test(template);
}

// ---------------------------------------------------------------------------
// createE2BProvider
// ---------------------------------------------------------------------------

export function createE2BProvider(): SandboxProvider {
	return {
		name: "e2b" as SandboxProviderName,

		async create(config: SandboxProviderConfig): Promise<CreateResult> {
			const template = config.template ?? "sandcaster-v1";

			// Validate template format
			if (!isValidTemplate(template)) {
				return {
					ok: false,
					code: "INVALID_TEMPLATE_FOR_PROVIDER",
					message: `Invalid E2B template name: "${template}". Templates must be alphanumeric with hyphens/underscores.`,
					hint: "Run: bun run scripts/create-template.ts",
				};
			}

			// Dynamic import to avoid hard dependency at module load time
			const {
				Sandbox,
				NotFoundError,
				AuthenticationError,
				RateLimitError,
				TimeoutError: E2BTimeoutError,
				TemplateError,
			} = await import("e2b");

			let sbx: InstanceType<typeof Sandbox>;
			try {
				sbx = await Sandbox.create(template, {
					apiKey: config.apiKey,
					timeoutMs: config.timeoutMs,
					envs: config.envs,
					metadata: config.metadata,
				});
			} catch (err) {
				// Map E2B-specific errors to provider-agnostic codes
				if (err instanceof NotFoundError) {
					return {
						ok: false,
						code: "TEMPLATE_NOT_FOUND",
						message: `Sandbox template '${template}' not found.`,
						hint: "Run: bun run scripts/create-template.ts",
					};
				}
				if (err instanceof AuthenticationError) {
					return {
						ok: false,
						code: "PROVIDER_AUTH_MISSING",
						message: "E2B authentication failed.",
						hint: "Check your E2B_API_KEY. Get one at https://e2b.dev/dashboard",
					};
				}
				if (err instanceof RateLimitError) {
					return {
						ok: false,
						code: "RATE_LIMIT",
						message: "E2B rate limit exceeded.",
						hint: "E2B rate limit — wait and retry",
					};
				}
				if (err instanceof E2BTimeoutError) {
					return {
						ok: false,
						code: "SANDBOX_TIMEOUT",
						message: "Sandbox creation timed out.",
						hint: "Sandbox creation timed out — try again or increase timeout",
					};
				}
				if (err instanceof TemplateError) {
					return {
						ok: false,
						code: "TEMPLATE_INCOMPATIBLE",
						message: `Sandbox template '${template}' is incompatible.`,
						hint: "Template needs rebuild — run: bun run scripts/create-template.ts",
					};
				}
				return {
					ok: false,
					code: "SANDBOX_ERROR",
					message: `Failed to create sandbox: ${err instanceof Error ? err.message : String(err)}`,
				};
			}

			// Wrap the E2B sandbox in a SandboxInstance
			return {
				ok: true,
				instance: {
					workDir: "/home/user",
					capabilities: {
						fileSystem: true,
						shellExec: true,
						envInjection: true,
						streaming: true,
						networkPolicy: false,
						snapshots: false,
						reconnect: true,
						customImage: true,
					},
					files: {
						write(path: string, content: string | Uint8Array): Promise<void> {
							return sbx.files
								.write(path, content as any)
								.then(() => undefined);
						},
						read(
							path: string,
							opts?: { format?: "text" | "bytes" },
						): Promise<string | Uint8Array> {
							return sbx.files.read(path, opts as any) as Promise<
								string | Uint8Array
							>;
						},
					},
					commands: {
						run(
							cmd: string,
							opts?: CommandOptions,
						): Promise<{
							stdout: string;
							stderr: string;
							exitCode: number;
						}> {
							return sbx.commands.run(cmd, opts as any) as Promise<{
								stdout: string;
								stderr: string;
								exitCode: number;
							}>;
						},
					},
					async kill(): Promise<void> {
						try {
							await sbx.kill();
						} catch {
							// Idempotent — ignore errors on double-kill
						}
					},
				},
			};
		},
	};
}
