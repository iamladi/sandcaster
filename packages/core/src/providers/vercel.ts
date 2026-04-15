import { posix } from "node:path";
import type {
	CommandOptions,
	CreateResult,
	SandboxProvider,
	SandboxProviderConfig,
	SandboxProviderName,
} from "../sandbox-provider.js";

// ---------------------------------------------------------------------------
// Template validation
// Vercel uses snapshot IDs: alphanumeric strings with hyphens/underscores
// Reject if contains spaces or slashes (obviously wrong)
// ---------------------------------------------------------------------------

const VALID_TEMPLATE_RE = /^[^\s/]+$/;

function isValidTemplate(template: string): boolean {
	return VALID_TEMPLATE_RE.test(template);
}

// ---------------------------------------------------------------------------
// Error detection helpers
// ---------------------------------------------------------------------------

function isAuthError(err: unknown): boolean {
	const e = err as { status?: number; statusCode?: number };
	return (
		e.status === 401 ||
		e.status === 403 ||
		e.statusCode === 401 ||
		e.statusCode === 403
	);
}

function isRateLimitError(err: unknown): boolean {
	const e = err as { status?: number; statusCode?: number };
	return e.status === 429 || e.statusCode === 429;
}

function isTimeoutError(err: unknown): boolean {
	const e = err as { code?: string; message?: string };
	return (
		e.code === "ETIMEDOUT" ||
		e.code === "TIMEOUT" ||
		e.message?.toLowerCase().includes("timed out") === true ||
		e.message?.toLowerCase().includes("timeout") === true
	);
}

// ---------------------------------------------------------------------------
// Streaming bridge: AsyncGenerator logs → callbacks + collected strings
// ---------------------------------------------------------------------------

async function collectLogs(
	logsGenerator: () => AsyncGenerator<{
		stream: "stdout" | "stderr";
		data: string;
	}>,
	opts?: CommandOptions,
): Promise<{ stdout: string; stderr: string }> {
	let stdout = "";
	let stderr = "";

	try {
		for await (const entry of logsGenerator()) {
			if (entry.stream === "stdout") {
				stdout += entry.data;
				opts?.onStdout?.(entry.data);
			} else {
				stderr += entry.data;
				opts?.onStderr?.(entry.data);
			}
		}
	} catch (_err) {
		// StreamError or other mid-stream errors: return partial output collected so far
		// Do not rethrow — partial output is better than a hard failure
	}

	return { stdout, stderr };
}

// ---------------------------------------------------------------------------
// createVercelProvider
// ---------------------------------------------------------------------------

export function createVercelProvider(): SandboxProvider {
	return {
		name: "vercel" as SandboxProviderName,

		async create(config: SandboxProviderConfig): Promise<CreateResult> {
			// Validate template if provided
			if (config.template !== undefined && !isValidTemplate(config.template)) {
				return {
					ok: false,
					code: "INVALID_TEMPLATE_FOR_PROVIDER",
					message: `Invalid Vercel snapshot ID: "${config.template}". Snapshot IDs must not contain spaces or slashes.`,
					hint: "Provide a valid Vercel snapshot ID (alphanumeric with hyphens/underscores)",
				};
			}

			// Dynamic import to avoid hard dependency at module load time
			const { Sandbox } = await import("@vercel/sandbox");

			// Build create options
			const createOpts: Record<string, unknown> = {};
			if (config.template !== undefined) {
				createOpts.snapshot = config.template;
			}
			if (config.timeoutMs !== undefined) {
				createOpts.timeoutMs = config.timeoutMs;
			}
			if (config.envs !== undefined) {
				// Filter out empty values — Vercel API rejects them
				const filtered: Record<string, string> = {};
				for (const [k, v] of Object.entries(config.envs)) {
					if (v) filtered[k] = v;
				}
				if (Object.keys(filtered).length > 0) {
					createOpts.env = filtered;
				}
			}

			// biome-ignore lint/suspicious/noExplicitAny: Vercel SDK types are opaque
			let sbx: any;
			try {
				sbx = await Sandbox.create(createOpts);
			} catch (err) {
				if (isAuthError(err)) {
					return {
						ok: false,
						code: "PROVIDER_AUTH_MISSING",
						message: "Vercel Sandbox authentication failed.",
						hint: "Set VERCEL_TOKEN, VERCEL_TEAM_ID, and VERCEL_PROJECT_ID environment variables.",
					};
				}
				if (isRateLimitError(err)) {
					return {
						ok: false,
						code: "RATE_LIMIT",
						message: "Vercel Sandbox rate limit exceeded.",
						hint: "Vercel rate limit — wait and retry",
					};
				}
				if (isTimeoutError(err)) {
					return {
						ok: false,
						code: "SANDBOX_TIMEOUT",
						message: "Vercel Sandbox creation timed out.",
						hint: "Sandbox creation timed out — try again or increase timeout",
					};
				}
				return {
					ok: false,
					code: "SANDBOX_ERROR",
					message: `Failed to create Vercel sandbox: ${err instanceof Error ? err.message : String(err)}`,
				};
			}

			return {
				ok: true,
				instance: {
					workDir: "/vercel/sandbox",
					capabilities: {
						fileSystem: true,
						shellExec: true,
						envInjection: true,
						streaming: true,
						networkPolicy: false,
						snapshots: true,
						reconnect: false,
						customImage: false,
					},
					files: {
						async write(
							path: string,
							content: string | Uint8Array,
						): Promise<void> {
							const buffer = Buffer.from(content);
							// Ensure parent directory exists before writing
							const dir = posix.dirname(path);
							if (dir && dir !== "/") {
								try {
									await sbx.mkDir(dir);
								} catch {
									// Directory may already exist — ignore
								}
							}
							await sbx.writeFiles([{ path, content: buffer }]);
						},
						async read(
							path: string,
							opts?: { format?: "text" | "bytes" },
						): Promise<string | Uint8Array> {
							const buffer: Buffer = await sbx.readFileToBuffer(path);
							if (opts?.format === "text") {
								return buffer.toString("utf-8");
							}
							return new Uint8Array(buffer);
						},
					},
					commands: {
						async run(
							cmd: string,
							opts?: CommandOptions,
						): Promise<{ stdout: string; stderr: string; exitCode: number }> {
							// Wrap with sh -c so shell operators (pipes, redirects, quotes) work
							const command = await sbx.runCommand("sh", ["-c", cmd]);

							// Collect logs with optional timeout
							let stdout = "";
							let stderr = "";

							const logsPromise = (async () => {
								const result = await collectLogs(command.logs, opts);
								stdout = result.stdout;
								stderr = result.stderr;
							})();

							if (opts?.timeoutMs !== undefined) {
								const timeoutPromise = new Promise<"timeout">((resolve) =>
									setTimeout(() => resolve("timeout"), opts.timeoutMs),
								);
								const raceResult = await Promise.race([
									logsPromise.then(() => "done" as const),
									timeoutPromise,
								]);
								if (raceResult === "timeout") {
									return {
										stdout,
										stderr:
											stderr || "Command timeout: exceeded time limit",
										exitCode: -1,
									};
								}
							} else {
								await logsPromise;
							}

							return { stdout, stderr, exitCode: command.exitCode };
						},
					},
					async kill(): Promise<void> {
						try {
							await sbx.stop();
						} catch {
							// Idempotent — ignore errors on double-stop
						}
					},
				},
			};
		},
	};
}
