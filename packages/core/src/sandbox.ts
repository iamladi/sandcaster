import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import {
	generateNonce,
	ipcResponsePath,
	ipcTempPath,
	parseCompositeRequest,
	serializeCompositeResponse,
	validateNonce,
} from "./composite-ipc.js";
import { SandcasterError } from "./errors.js";
import {
	createExtractionMarker,
	extractGeneratedFiles,
	shellQuote,
	uploadFiles,
	uploadSkills,
} from "./files.js";
import { resolveCompositeConfig, SandboxPool } from "./sandbox-pool.js";
import type { SandboxInstance } from "./sandbox-provider.js";
import { getSandboxProvider } from "./sandbox-registry.js";
import {
	PROVIDER_ENV_VARS,
	resolveProviderCredential,
	resolveSandboxProvider,
} from "./sandbox-resolver.js";
import type {
	QueryRequest,
	SandcasterConfig,
	SandcasterEvent,
} from "./schemas.js";

// ---------------------------------------------------------------------------
// Runner bundle — lazy-loaded on first use so that importing this module
// (e.g. for SandboxError) doesn't trigger a readFileSync side effect.
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
let _runnerBundle: string | undefined;
function _getRunnerBundle(): string {
	if (_runnerBundle === undefined) {
		_runnerBundle = readFileSync(
			resolve(__dirname, "runner/runner.mjs"),
			"utf-8",
		);
	}
	return _runnerBundle;
}

// ---------------------------------------------------------------------------
// SandboxError
// ---------------------------------------------------------------------------

export class SandboxError extends SandcasterError {
	constructor(
		message: string,
		public readonly stage: "create" | "upload" | "exec" | "cleanup",
		public readonly cause?: unknown,
	) {
		super(message, "SANDBOX_ERROR");
		this.name = "SandboxError";
	}
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RunOptions {
	request: QueryRequest;
	config?: SandcasterConfig;
	requestId?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Redact known API key values from a string */
function redactApiKeys(text: string, envs: Record<string, string>): string {
	let result = text;
	for (const value of Object.values(envs)) {
		if (value && value.length >= 8) {
			result = result.replaceAll(value, "[REDACTED]");
		}
	}
	return result;
}

/** Build the env vars to pass into the sandbox */
function buildEnvs(request: QueryRequest): Record<string, string> {
	const envs: Record<string, string> = {};

	// Pull known API keys from process.env first, then let request override
	const keyMap: Record<string, string> = {
		ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
		OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
		GOOGLE_API_KEY: process.env.GOOGLE_API_KEY ?? "",
		GOOGLE_GENERATIVE_AI_API_KEY:
			process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? "",
		OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? "",
		E2B_API_KEY: process.env.E2B_API_KEY ?? "",
	};

	// Override with request.apiKeys if provided
	if (request.apiKeys) {
		if (request.apiKeys.anthropic) {
			keyMap.ANTHROPIC_API_KEY = request.apiKeys.anthropic;
		}
		if (request.apiKeys.openrouter) {
			keyMap.OPENROUTER_API_KEY = request.apiKeys.openrouter;
		}
		if (request.apiKeys.e2b) {
			keyMap.E2B_API_KEY = request.apiKeys.e2b;
		}
	}

	// Only include non-empty values
	for (const [k, v] of Object.entries(keyMap)) {
		if (v) envs[k] = v;
	}

	return envs;
}

/** Build the agent_config.json content from request + config */
function buildAgentConfig(
	request: QueryRequest,
	config: SandcasterConfig | undefined,
	compositeFields?: {
		nonce: string;
		pollIntervalMs: number;
	},
): Record<string, unknown> {
	const timeout = request.timeout ?? config?.timeout ?? 300;
	const model = request.model ?? config?.model;
	const maxTurns = request.maxTurns ?? config?.maxTurns;

	const agentConfig: Record<string, unknown> = {
		prompt: request.prompt,
		timeout,
	};

	if (model !== undefined) agentConfig.model = model;
	if (maxTurns !== undefined) agentConfig.max_turns = maxTurns;

	// System prompt from config (can be a string or { preset, append? } object)
	if (config?.systemPrompt !== undefined) {
		agentConfig.system_prompt = config.systemPrompt;
	}
	if (config?.systemPromptAppend !== undefined) {
		agentConfig.system_prompt_append = config.systemPromptAppend;
	}

	// Skills flag
	const hasSkills =
		config?.skillsDir !== undefined ||
		(request.extraSkills !== undefined &&
			Object.keys(request.extraSkills).length > 0);
	if (hasSkills) agentConfig.has_skills = true;

	// Composite fields (only injected when composite is active)
	if (compositeFields !== undefined) {
		agentConfig.composite_enabled = true;
		agentConfig.composite_nonce = compositeFields.nonce;
		agentConfig.composite_poll_interval_ms = compositeFields.pollIntervalMs;
	}

	// Branching: enable branch/confidence tools inside the sandbox runner
	const branchingEnabled =
		config?.branching?.enabled === true || request.branching?.enabled === true;
	if (branchingEnabled) {
		agentConfig.branching_enabled = true;
	}

	return agentConfig;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/** Run an AI agent in a sandbox, yielding SandcasterEvents as they occur */
export async function* runAgentInSandbox(
	options: RunOptions,
): AsyncGenerator<SandcasterEvent> {
	const { request, config, requestId } = options;

	const timeoutSecs = request.timeout ?? config?.timeout ?? 300;
	const timeoutMs = timeoutSecs * 1000;

	// ------------------------------------------------------------------
	// 0. Resolve provider
	// ------------------------------------------------------------------
	const resolveResult = resolveSandboxProvider({
		requestProvider: request.sandboxProvider,
		configProvider: config?.sandboxProvider,
	});

	if (!resolveResult.ok) {
		yield {
			type: "error" as const,
			content: resolveResult.message,
			code: resolveResult.code,
			hint: resolveResult.hint,
		};
		return;
	}

	const providerName = resolveResult.name;

	// ------------------------------------------------------------------
	// 1. Get provider from registry
	// ------------------------------------------------------------------
	const providerResult = await getSandboxProvider(providerName);

	if (!providerResult.ok) {
		yield {
			type: "error" as const,
			content: providerResult.message,
			code: providerResult.code,
			hint: providerResult.hint,
		};
		return;
	}

	const provider = providerResult.provider;

	// ------------------------------------------------------------------
	// 2. Resolve credential for this provider
	// ------------------------------------------------------------------
	const apiKey = resolveProviderCredential(providerName, {
		requestApiKeys: request.apiKeys as Record<string, string | undefined>,
	});

	// ------------------------------------------------------------------
	// 3. Create sandbox via provider
	// ------------------------------------------------------------------
	// Only pass template when explicitly set — let each provider use its own default
	const template = process.env.SANDCASTER_TEMPLATE;

	const envs = buildEnvs(request);

	const createResult = await provider.create({
		template,
		timeoutMs,
		envs,
		metadata: {
			requestId: requestId ?? "unknown",
		},
		apiKey,
	});

	if (!createResult.ok) {
		yield {
			type: "error" as const,
			content: createResult.message,
			code: createResult.code,
			hint: createResult.hint,
		};
		return;
	}

	const instance: SandboxInstance = createResult.instance;

	// ------------------------------------------------------------------
	// 3b. Set up SandboxPool and IPC nonce (composite only)
	// ------------------------------------------------------------------
	const hasCompositeConfig =
		request.composite !== undefined || config?.composite !== undefined;
	const isCompositeCapable = SandboxPool.isCompositeCapable(instance);
	const compositeActive = hasCompositeConfig && isCompositeCapable;

	let pool: SandboxPool | undefined;
	let compositeNonce: string | undefined;
	let resolvedComposite: ReturnType<typeof resolveCompositeConfig> | undefined;
	let sigTermHandler: (() => Promise<void>) | undefined;

	if (compositeActive) {
		resolvedComposite = resolveCompositeConfig(
			config?.composite,
			request.composite,
		);

		compositeNonce = generateNonce();

		const poolConfig = {
			maxSandboxes: resolvedComposite.maxSandboxes,
			maxTotalSpawns: resolvedComposite.maxTotalSpawns,
			allowedProviders: resolvedComposite.allowedProviders,
			requestId: requestId ?? "unknown",
		};

		// Build factory for secondary sandboxes
		const sandboxFactory: import("./sandbox-pool.js").SandboxFactory = async (
			factoryProvider,
			factoryTemplate?,
		) => {
			const secondaryProviderResult = await getSandboxProvider(factoryProvider);
			if (!secondaryProviderResult.ok) {
				throw new Error(secondaryProviderResult.message);
			}
			const secondaryApiKey = resolveProviderCredential(factoryProvider, {
				requestApiKeys: request.apiKeys as Record<string, string | undefined>,
			});
			const secondaryCreateResult =
				await secondaryProviderResult.provider.create({
					template: factoryTemplate,
					timeoutMs,
					envs:
						secondaryApiKey && PROVIDER_ENV_VARS[factoryProvider]
							? { [PROVIDER_ENV_VARS[factoryProvider]]: secondaryApiKey }
							: {},
					metadata: { requestId: requestId ?? "unknown" },
					apiKey: secondaryApiKey,
				});
			if (!secondaryCreateResult.ok) {
				throw new Error(secondaryCreateResult.message);
			}
			return secondaryCreateResult.instance;
		};

		pool = new SandboxPool(instance, poolConfig, sandboxFactory);

		// Stale IPC cleanup
		await instance.commands.run(`rm -f /tmp/sandcaster-ipc-*.json*`);

		// Register SIGTERM handler for graceful cleanup
		const poolRef = pool;
		sigTermHandler = async () => {
			await poolRef.killAll();
		};
		process.once("SIGTERM", sigTermHandler);
	}

	// Runner directory — use instance.workDir so providers with restricted
	// filesystems (e.g. Vercel) can write to a writable location.
	const runnerDir = `${instance.workDir}/.sandcaster`;
	const runnerPath = `${runnerDir}/runner.mjs`;
	const configPath = `${runnerDir}/agent_config.json`;

	try {
		// ------------------------------------------------------------------
		// 4. Upload runner bundle
		// ------------------------------------------------------------------
		await instance.files.write(runnerPath, _getRunnerBundle());

		// ------------------------------------------------------------------
		// 5. Upload agent config
		// ------------------------------------------------------------------
		const agentConfig = buildAgentConfig(
			request,
			config,
			compositeActive && compositeNonce !== undefined && resolvedComposite
				? {
						nonce: compositeNonce,
						pollIntervalMs: resolvedComposite.pollIntervalMs,
					}
				: undefined,
		);
		await instance.files.write(configPath, JSON.stringify(agentConfig));

		// ------------------------------------------------------------------
		// 6. Upload user files
		// ------------------------------------------------------------------
		if (request.files && Object.keys(request.files).length > 0) {
			await uploadFiles(instance, request.files);
		}

		// ------------------------------------------------------------------
		// 7. Upload skills
		// ------------------------------------------------------------------
		const extraSkills = request.extraSkills;
		if (extraSkills && Object.keys(extraSkills).length > 0) {
			const skillsList = Object.entries(extraSkills).map(([name, content]) => ({
				name,
				content,
			}));
			await uploadSkills(instance, skillsList);
		}

		// ------------------------------------------------------------------
		// 8. Create extraction marker
		// ------------------------------------------------------------------
		const markerPath = await createExtractionMarker(instance, requestId ?? "");

		// ------------------------------------------------------------------
		// 9. Execute runner + stream events via PassThrough bridge
		// ------------------------------------------------------------------
		const stream = new PassThrough({ objectMode: true });

		let stdoutBuffer = "";
		let _stderrBuffer = "";
		const onStdout = (data: string) => {
			stdoutBuffer += data;
			const lines = stdoutBuffer.split("\n");
			stdoutBuffer = lines.pop() ?? "";
			for (const line of lines) {
				if (line.trim()) stream.push(line);
			}
		};

		// Run the command — when it resolves/rejects, we end the stream
		const runPromise = instance.commands
			.run(`node ${runnerPath} ${configPath}`, {
				timeoutMs: timeoutMs * 6, // give runner extra headroom
				onStdout,
				onStderr: (data: string) => {
					if (_stderrBuffer.length + data.length > 500) {
						_stderrBuffer = (_stderrBuffer + data).slice(-500);
					} else {
						_stderrBuffer += data;
					}
				},
			})
			.then(() => {
				// Flush any remaining buffered content
				if (stdoutBuffer.trim()) stream.push(stdoutBuffer);
				stream.end();
			})
			.catch((err: unknown) => {
				stream.destroy(err instanceof Error ? err : new Error(String(err)));
			});

		// ------------------------------------------------------------------
		// 10. Parse JSON lines and yield events
		// ------------------------------------------------------------------
		try {
			for await (const line of stream) {
				const lineStr = String(line).trim();
				if (!lineStr) continue;

				// Intercept composite requests when pool is active
				if (
					pool !== undefined &&
					compositeNonce !== undefined &&
					lineStr.includes('"composite_request"')
				) {
					const compositeReq = parseCompositeRequest(lineStr);
					if (compositeReq !== null) {
						if (!validateNonce(compositeReq, compositeNonce)) {
							console.warn(
								`[sandcaster] Rejecting composite_request with invalid nonce (id=${compositeReq.id})`,
							);
							continue;
						}

						// Validate request ID to prevent shell injection
						if (!/^[a-zA-Z0-9_-]+$/.test(compositeReq.id)) {
							console.warn(
								`[sandcaster] Rejecting composite_request with invalid id`,
							);
							continue;
						}

						// Handle the request and write IPC response
						let response: Parameters<typeof serializeCompositeResponse>[0];
						try {
							response = await handleCompositeRequest(pool, compositeReq);
						} catch (err) {
							response = {
								type: "composite_response",
								id: compositeReq.id,
								ok: false,
								error: err instanceof Error ? err.message : String(err),
							};
						}

						// Atomic write-rename
						const tmpPath = ipcTempPath(compositeReq.id);
						const finalPath = ipcResponsePath(compositeReq.id);
						await instance.files.write(
							tmpPath,
							serializeCompositeResponse(response),
						);
						await instance.commands.run(
							`mv ${shellQuote(tmpPath)} ${shellQuote(finalPath)}`,
						);

						continue; // Do not yield composite requests as events
					}
				}

				try {
					const event = JSON.parse(lineStr) as SandcasterEvent;
					// Tag tool_use / tool_result events with sandbox: "primary" when
					// composite is active. If the event already has a sandbox field,
					// preserve it (don't overwrite).
					if (compositeActive) {
						if (
							(event.type === "tool_use" || event.type === "tool_result") &&
							event.sandbox === undefined
						) {
							(event as typeof event & { sandbox: string }).sandbox = "primary";
						}
					}
					yield event;
				} catch {
					yield {
						type: "warning",
						content: `Failed to parse event line: ${lineStr.slice(0, 200)}`,
					} satisfies SandcasterEvent;
				}
			}
		} catch (streamErr) {
			// Stream was destroyed due to runner crash — yield error event
			const errMsg =
				streamErr instanceof Error ? streamErr.message : String(streamErr);
			const detail = _stderrBuffer.trim()
				? `${errMsg}\nstderr: ${_stderrBuffer.trim()}`
				: errMsg;
			yield {
				type: "error",
				content: redactApiKeys(`Runner error: ${detail}`, envs),
				code: "RUNNER_ERROR",
			} satisfies SandcasterEvent;
		}

		// Wait for the run command promise to fully settle
		await runPromise.catch(() => {
			// Already handled via stream.destroy above
		});

		// ------------------------------------------------------------------
		// 11. Extract generated files
		// ------------------------------------------------------------------
		const inputFileNames = new Set(Object.keys(request.files ?? {}));
		const fileEvents = await extractGeneratedFiles(
			instance,
			inputFileNames,
			requestId ?? "",
			markerPath ?? "",
		);

		for (const fileEvent of fileEvents) {
			yield fileEvent as SandcasterEvent;
		}
	} finally {
		// ------------------------------------------------------------------
		// 12. Kill sandbox (always, guaranteed cleanup — FR-9)
		// ------------------------------------------------------------------

		// Remove SIGTERM handler to prevent leaks
		if (sigTermHandler !== undefined) {
			process.off("SIGTERM", sigTermHandler);
		}

		if (pool !== undefined) {
			await pool.killAll();
		} else {
			await instance.kill();
		}
	}
}

// ---------------------------------------------------------------------------
// runAgentOnInstance — run agent on a pre-existing sandbox instance
// ---------------------------------------------------------------------------

/**
 * Run an AI agent on an already-created sandbox instance.
 * This is the `runAgent` function expected by `SessionManagerOptions`.
 * Unlike `runAgentInSandbox`, it does NOT create or kill the sandbox.
 */
export async function* runAgentOnInstance(
	instance: SandboxInstance,
	request: QueryRequest,
	config?: SandcasterConfig,
	_signal?: AbortSignal,
): AsyncGenerator<SandcasterEvent> {
	const timeoutSecs = request.timeout ?? config?.timeout ?? 300;
	const timeoutMs = timeoutSecs * 1000;
	const envs = buildEnvs(request);

	const runnerDir = `${instance.workDir}/.sandcaster`;
	const runnerPath = `${runnerDir}/runner.mjs`;
	const configPath = `${runnerDir}/agent_config.json`;

	// Upload runner bundle
	await instance.files.write(runnerPath, _getRunnerBundle());

	// Upload agent config
	const agentConfig = buildAgentConfig(request, config);
	await instance.files.write(configPath, JSON.stringify(agentConfig));

	// Upload user files
	if (request.files && Object.keys(request.files).length > 0) {
		await uploadFiles(instance, request.files);
	}

	// Upload skills
	const extraSkills = request.extraSkills;
	if (extraSkills && Object.keys(extraSkills).length > 0) {
		const skillsList = Object.entries(extraSkills).map(([name, content]) => ({
			name,
			content,
		}));
		await uploadSkills(instance, skillsList);
	}

	// Create extraction marker
	const markerPath = await createExtractionMarker(instance, "");

	// Execute runner + stream events
	const stream = new PassThrough({ objectMode: true });

	let stdoutBuffer = "";
	let stderrBuffer = "";
	const onStdout = (data: string) => {
		stdoutBuffer += data;
		const lines = stdoutBuffer.split("\n");
		stdoutBuffer = lines.pop() ?? "";
		for (const line of lines) {
			if (line.trim()) stream.push(line);
		}
	};

	const runPromise = instance.commands
		.run(`node ${runnerPath} ${configPath}`, {
			timeoutMs: timeoutMs * 6,
			onStdout,
			onStderr: (data: string) => {
				if (stderrBuffer.length + data.length > 500) {
					stderrBuffer = (stderrBuffer + data).slice(-500);
				} else {
					stderrBuffer += data;
				}
			},
		})
		.then(() => {
			if (stdoutBuffer.trim()) stream.push(stdoutBuffer);
			stream.end();
		})
		.catch((err: unknown) => {
			stream.destroy(err instanceof Error ? err : new Error(String(err)));
		});

	try {
		for await (const line of stream) {
			const lineStr = String(line).trim();
			if (!lineStr) continue;

			try {
				const event = JSON.parse(lineStr) as SandcasterEvent;
				yield event;
			} catch {
				yield {
					type: "warning",
					content: `Failed to parse event line: ${lineStr.slice(0, 200)}`,
				} satisfies SandcasterEvent;
			}
		}
	} catch (streamErr) {
		const errMsg =
			streamErr instanceof Error ? streamErr.message : String(streamErr);
		const detail = stderrBuffer.trim()
			? `${errMsg}\nstderr: ${stderrBuffer.trim()}`
			: errMsg;
		yield {
			type: "error",
			content: redactApiKeys(`Runner error: ${detail}`, envs),
			code: "RUNNER_ERROR",
		} satisfies SandcasterEvent;
	}

	await runPromise.catch(() => {});

	// Extract generated files
	const inputFileNames = new Set(Object.keys(request.files ?? {}));
	const fileEvents = await extractGeneratedFiles(
		instance,
		inputFileNames,
		"",
		markerPath ?? "",
	);

	for (const fileEvent of fileEvents) {
		yield fileEvent as SandcasterEvent;
	}
}

// ---------------------------------------------------------------------------
// handleCompositeRequest — dispatch IPC action to the pool
// ---------------------------------------------------------------------------

async function handleCompositeRequest(
	pool: SandboxPool,
	req: ReturnType<typeof parseCompositeRequest> & {},
): Promise<Parameters<typeof serializeCompositeResponse>[0]> {
	switch (req.action) {
		case "spawn": {
			if (!req.name || !req.provider) {
				return {
					type: "composite_response",
					id: req.id,
					ok: false,
					error: "spawn requires name and provider",
				};
			}
			const spawned = await pool.spawn(
				req.name,
				req.provider as Parameters<
					InstanceType<typeof SandboxPool>["spawn"]
				>[1],
				req.template,
			);
			return {
				type: "composite_response",
				id: req.id,
				ok: true,
				workDir: spawned.workDir,
			};
		}

		case "exec": {
			if (!req.name || !req.command) {
				return {
					type: "composite_response",
					id: req.id,
					ok: false,
					error: "exec requires name and command",
				};
			}
			const result = await pool.execIn(req.name, req.command, {
				timeoutMs: req.timeout,
			});
			return {
				type: "composite_response",
				id: req.id,
				ok: true,
				result,
			};
		}

		case "transfer": {
			if (!req.from || !req.to || !req.paths) {
				return {
					type: "composite_response",
					id: req.id,
					ok: false,
					error: "transfer requires from, to, and paths",
				};
			}
			const transferResult = await pool.transferFiles(
				req.from,
				req.to,
				req.paths,
			);
			return {
				type: "composite_response",
				id: req.id,
				ok: true,
				result: transferResult,
			};
		}

		case "kill": {
			if (!req.name) {
				return {
					type: "composite_response",
					id: req.id,
					ok: false,
					error: "kill requires name",
				};
			}
			await pool.kill(req.name);
			return {
				type: "composite_response",
				id: req.id,
				ok: true,
			};
		}

		case "list": {
			const list = pool.listSandboxes();
			return {
				type: "composite_response",
				id: req.id,
				ok: true,
				result: list,
			};
		}

		default: {
			return {
				type: "composite_response",
				id: req.id,
				ok: false,
				error: `Unknown action: ${(req as { action: string }).action}`,
			};
		}
	}
}
