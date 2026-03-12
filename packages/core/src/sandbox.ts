import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { Sandbox } from "e2b";
import { SandcasterError } from "./errors.js";
import {
	createExtractionMarker,
	extractGeneratedFiles,
	uploadFiles,
	uploadSkills,
} from "./files.js";
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
			resolve(__dirname, "runner/dist/runner.mjs"),
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

/** Build the env vars to pass into the E2B sandbox */
function buildEnvs(request: QueryRequest): Record<string, string> {
	const envs: Record<string, string> = {};

	// Pull known API keys from process.env first, then let request override
	const keyMap: Record<string, string> = {
		ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
		OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
		GOOGLE_API_KEY: process.env.GOOGLE_API_KEY ?? "",
		E2B_API_KEY: process.env.E2B_API_KEY ?? "",
	};

	// Override with request.apiKeys if provided
	if (request.apiKeys) {
		if (request.apiKeys.anthropic) {
			keyMap.ANTHROPIC_API_KEY = request.apiKeys.anthropic;
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

	return agentConfig;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/** Run an AI agent in an E2B sandbox, yielding SandcasterEvents as they occur */
export async function* runAgentInSandbox(
	options: RunOptions,
): AsyncGenerator<SandcasterEvent> {
	const { request, config, requestId } = options;

	const template = process.env.SANDCASTER_TEMPLATE ?? "sandcaster";
	const timeoutSecs = request.timeout ?? config?.timeout ?? 300;
	const timeoutMs = timeoutSecs * 1000;
	const apiKey = request.apiKeys?.e2b ?? process.env.E2B_API_KEY;

	// ------------------------------------------------------------------
	// 1. Create sandbox
	// ------------------------------------------------------------------
	let sbx: Sandbox;
	try {
		sbx = await Sandbox.create(template, {
			apiKey,
			timeoutMs,
			envs: buildEnvs(request),
			metadata: {
				requestId: requestId ?? "unknown",
			},
		});
	} catch (err) {
		throw new SandboxError(
			`Failed to create sandbox: ${err instanceof Error ? err.message : String(err)}`,
			"create",
			err,
		);
	}

	try {
		// ------------------------------------------------------------------
		// 2. Upload runner bundle
		// ------------------------------------------------------------------
		await sbx.files.write("/opt/runner.mjs", _getRunnerBundle());

		// ------------------------------------------------------------------
		// 3. Upload agent config
		// ------------------------------------------------------------------
		const agentConfig = buildAgentConfig(request, config);
		await sbx.files.write(
			"/opt/agent_config.json",
			JSON.stringify(agentConfig),
		);

		// ------------------------------------------------------------------
		// 4. Upload user files
		// ------------------------------------------------------------------
		if (request.files && Object.keys(request.files).length > 0) {
			await uploadFiles(sbx, request.files);
		}

		// ------------------------------------------------------------------
		// 5. Upload skills
		// ------------------------------------------------------------------
		const extraSkills = request.extraSkills;
		if (extraSkills && Object.keys(extraSkills).length > 0) {
			const skillsList = Object.entries(extraSkills).map(([name, content]) => ({
				name,
				content,
			}));
			await uploadSkills(sbx, skillsList);
		}

		// ------------------------------------------------------------------
		// 6. Create extraction marker
		// ------------------------------------------------------------------
		const markerPath = await createExtractionMarker(sbx, requestId ?? "");

		// ------------------------------------------------------------------
		// 7 & 8. Execute runner + stream events via PassThrough bridge
		// ------------------------------------------------------------------
		const stream = new PassThrough({ objectMode: true });

		let stdoutBuffer = "";
		const onStdout = (data: string) => {
			stdoutBuffer += data;
			const lines = stdoutBuffer.split("\n");
			stdoutBuffer = lines.pop() ?? "";
			for (const line of lines) {
				if (line.trim()) stream.push(line);
			}
		};

		// Run the command — when it resolves/rejects, we end the stream
		const runPromise = sbx.commands
			.run("node /opt/runner.mjs", {
				timeoutMs: timeoutMs * 6, // give runner extra headroom
				onStdout,
				onStderr: (_data: string) => {
					// stderr is captured but not streamed as events here
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
		// 9. Parse JSON lines and yield events
		// ------------------------------------------------------------------
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
			// Stream was destroyed due to runner crash — yield error event
			yield {
				type: "error",
				content: `Runner error: ${streamErr instanceof Error ? streamErr.message : String(streamErr)}`,
				code: "RUNNER_ERROR",
			} satisfies SandcasterEvent;
		}

		// Wait for the run command promise to fully settle
		await runPromise.catch(() => {
			// Already handled via stream.destroy above
		});

		// ------------------------------------------------------------------
		// 10. Extract generated files
		// ------------------------------------------------------------------
		const inputFileNames = new Set(Object.keys(request.files ?? {}));
		const fileEvents = await extractGeneratedFiles(
			sbx,
			inputFileNames,
			requestId ?? "",
			markerPath ?? "",
		);

		for (const fileEvent of fileEvents) {
			yield fileEvent as SandcasterEvent;
		}
	} finally {
		// ------------------------------------------------------------------
		// 11. Kill sandbox (always)
		// ------------------------------------------------------------------
		try {
			await sbx.kill();
		} catch {
			// Ignore kill errors — best effort cleanup
		}
	}
}
