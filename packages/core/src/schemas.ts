import * as z from "zod";
import { BranchConfigSchema } from "./branching/types.js";

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

export const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
export const PROVIDER_VALUES = [
	"anthropic",
	"vertex",
	"bedrock",
	"openrouter",
] as const;
export const THINKING_LEVEL_VALUES = ["none", "low", "medium", "high"] as const;
export const SANDBOX_PROVIDER_VALUES = [
	"e2b",
	"vercel",
	"docker",
	"cloudflare",
] as const;

const WINDOWS_DRIVE_ABS_PATH = /^[a-zA-Z]:[\\/]/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a relative file path using POSIX semantics (resolves `.` and `..`
 * segments without touching the filesystem). Returns `null` if the path is
 * empty or resolves to a traversal.
 */
function normalizePosixPath(rawPath: string): string | null {
	// Convert backslashes to forward slashes first
	const parts = rawPath.replace(/\\/g, "/").split("/");
	const stack: string[] = [];
	let traversedAboveRoot = false;

	for (const part of parts) {
		if (part === "" || part === ".") {
			// skip empty segments and current-dir references
		} else if (part === "..") {
			if (stack.length === 0) {
				// would go above root — path escapes the sandbox
				traversedAboveRoot = true;
				break;
			}
			stack.pop();
		} else {
			stack.push(part);
		}
	}

	if (traversedAboveRoot) {
		return null;
	}

	const normalized = stack.join("/");

	if (!normalized || normalized === ".") {
		return null;
	}

	return normalized;
}

// ---------------------------------------------------------------------------
// Files field refinement + transform
// ---------------------------------------------------------------------------

const filesSchema = z
	.record(z.string(), z.string())
	.superRefine((v, ctx) => {
		const keys = Object.keys(v);

		// Validate paths first (cheap) before measuring size (expensive)
		for (const path of keys) {
			if (
				path.startsWith("/") ||
				path.startsWith("\\") ||
				WINDOWS_DRIVE_ABS_PATH.test(path)
			) {
				ctx.addIssue({
					code: "custom",
					message: `Absolute paths are not allowed: ${path}`,
				});
				return;
			}

			const normalized = normalizePosixPath(path);
			if (normalized === null) {
				ctx.addIssue({
					code: "custom",
					message: `Path traversal not allowed: ${path}`,
				});
				return;
			}
		}

		if (keys.length > 20) {
			ctx.addIssue({
				code: "custom",
				message: `Too many files: ${keys.length} (max 20)`,
			});
			return;
		}

		let totalSize = 0;
		for (const content of Object.values(v)) {
			totalSize += Buffer.byteLength(content, "utf8");
		}
		if (totalSize > 10_000_000) {
			ctx.addIssue({
				code: "custom",
				message: `Total file size ${totalSize.toLocaleString()} bytes exceeds 10MB limit`,
			});
		}
	})
	.transform((v) => {
		const safe: Record<string, string> = {};
		for (const [path, content] of Object.entries(v)) {
			safe[normalizePosixPath(path) as string] = content;
		}
		return safe;
	});

// ---------------------------------------------------------------------------
// QueryRequestSchema
// ---------------------------------------------------------------------------

export const QueryRequestSchema = z.object({
	prompt: z.string().min(1).max(1_000_000),
	apiKeys: z
		.object({
			anthropic: z.string().optional(),
			e2b: z.string().optional(),
			openrouter: z.string().optional(),
			vercel: z.string().optional(),
			cloudflare: z.string().optional(),
		})
		.optional(),
	model: z.string().min(1).optional(),
	maxTurns: z.int().gte(1).optional(),
	outputFormat: z.object({}).passthrough().optional(),
	timeout: z.int().gte(5).lte(3600).optional(),
	files: filesSchema.optional(),
	allowedSkills: z.array(z.string()).optional(),
	allowedTools: z.array(z.string()).optional(),
	allowedAgents: z.array(z.string()).optional(),
	extraAgents: z
		.record(z.string(), z.unknown())
		.refine((v) => Object.keys(v).every((k) => NAME_PATTERN.test(k)), {
			message: "Extra agent names must match [a-zA-Z0-9_-]+",
		})
		.optional(),
	extraSkills: z
		.record(z.string(), z.string())
		.refine((v) => Object.keys(v).every((k) => NAME_PATTERN.test(k)), {
			message: "Extra skill names must match [a-zA-Z0-9_-]+",
		})
		.optional(),
	provider: z.enum(PROVIDER_VALUES).optional(),
	thinkingLevel: z.enum(THINKING_LEVEL_VALUES).optional(),
	sandboxProvider: z.enum(SANDBOX_PROVIDER_VALUES).optional(),
	composite: z
		.object({
			maxSandboxes: z.int().gte(1).optional(),
			maxTotalSpawns: z.int().gte(1).optional(),
			allowedProviders: z.array(z.enum(SANDBOX_PROVIDER_VALUES)).optional(),
		})
		.optional(),
	branching: BranchConfigSchema.optional(),
});

export type QueryRequest = z.infer<typeof QueryRequestSchema>;

// ---------------------------------------------------------------------------
// SandcasterConfigSchema
// ---------------------------------------------------------------------------

export const SandcasterConfigSchema = z.object({
	systemPrompt: z
		.union([
			z.string(),
			z.object({
				preset: z.string(),
				append: z.string().optional(),
			}),
		])
		.optional(),
	systemPromptAppend: z.string().optional(),
	model: z.string().optional(),
	maxTurns: z.int().gte(1).optional(),
	timeout: z.int().gte(5).lte(3600).optional(),
	outputFormat: z.object({}).passthrough().optional(),
	agents: z
		.union([z.record(z.string(), z.unknown()), z.array(z.unknown())])
		.optional(),
	skillsDir: z.string().optional(),
	allowedTools: z.array(z.string()).optional(),
	templateSkills: z.boolean().optional(),
	provider: z.enum(PROVIDER_VALUES).optional(),
	thinkingLevel: z.enum(THINKING_LEVEL_VALUES).optional(),
	sandboxProvider: z.enum(SANDBOX_PROVIDER_VALUES).optional(),
	composite: z
		.object({
			maxSandboxes: z.int().gte(1).lte(20).default(3),
			maxTotalSpawns: z.int().gte(1).lte(100).default(10),
			allowedProviders: z
				.array(z.enum(SANDBOX_PROVIDER_VALUES))
				.default([...SANDBOX_PROVIDER_VALUES]),
			pollIntervalMs: z.int().gte(10).lte(1000).default(50),
		})
		.optional(),
	branching: BranchConfigSchema.optional(),
});

export type SandcasterConfig = z.infer<typeof SandcasterConfigSchema>;

// ---------------------------------------------------------------------------
// SandcasterEventSchema
// ---------------------------------------------------------------------------

export const SandcasterEventSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("system"),
		subtype: z.string().optional(),
		content: z.string(),
	}),
	z.object({
		type: z.literal("assistant"),
		subtype: z.enum(["delta", "complete"]).optional(),
		content: z.string(),
	}),
	z.object({
		type: z.literal("tool_use"),
		toolName: z.string(),
		content: z.string(),
		sandbox: z.string().optional(),
	}),
	z.object({
		type: z.literal("tool_result"),
		content: z.string(),
		toolName: z.string(),
		isError: z.boolean().default(false),
		sandbox: z.string().optional(),
	}),
	z.object({
		type: z.literal("thinking"),
		subtype: z.enum(["delta", "complete"]).optional(),
		content: z.string(),
	}),
	z.object({
		type: z.literal("file"),
		path: z.string(),
		content: z.string(),
	}),
	z.object({
		type: z.literal("result"),
		subtype: z.string().optional(),
		content: z.string(),
		costUsd: z.number().optional(),
		numTurns: z.number().optional(),
		durationSecs: z.number().optional(),
		model: z.string().optional(),
	}),
	z.object({ type: z.literal("stderr"), content: z.string() }),
	z.object({ type: z.literal("warning"), content: z.string() }),
	z.object({
		type: z.literal("error"),
		content: z.string(),
		code: z.string().optional(),
		hint: z.string().optional(),
	}),
	z.object({
		type: z.literal("session_created"),
		sessionId: z.string(),
		content: z.string(),
	}),
	z.object({
		type: z.literal("session_expired"),
		sessionId: z.string(),
		content: z.string(),
	}),
	z.object({
		type: z.literal("session_command_result"),
		command: z.string(),
		content: z.string(),
		data: z.unknown().optional(),
	}),
	// --- Branch event types ---
	z.object({
		type: z.literal("branch_request"),
		alternatives: z.array(z.string().min(1)).min(1).max(10),
		reason: z.string().optional(),
	}),
	z.object({
		type: z.literal("confidence_report"),
		level: z.number().gte(0).lte(1),
		reason: z.string(),
	}),
	z.object({
		type: z.literal("branch_start"),
		branchId: z.string(),
		branchIndex: z.number(),
		totalBranches: z.number(),
		prompt: z.string(),
	}),
	z.object({
		type: z.literal("branch_progress"),
		branchId: z.string(),
		branchIndex: z.number(),
		status: z.enum(["running", "completed", "error"]),
		numTurns: z.number().optional(),
		costUsd: z.number().optional(),
	}),
	z.object({
		type: z.literal("branch_complete"),
		branchId: z.string(),
		status: z.enum(["success", "error"]),
		costUsd: z.number().optional(),
		numTurns: z.number().optional(),
		content: z.string().optional(),
	}),
	z.object({
		type: z.literal("branch_selected"),
		branchId: z.string(),
		branchIndex: z.number(),
		reason: z.string(),
		scores: z.record(z.string(), z.number()).optional(),
	}),
	z.object({
		type: z.literal("branch_summary"),
		totalBranches: z.number(),
		successCount: z.number(),
		totalCostUsd: z.number(),
		evaluator: z.string(),
		winnerId: z.string().optional(),
	}),
]);

export type SandcasterEvent = z.infer<typeof SandcasterEventSchema>;

// ---------------------------------------------------------------------------
// RunSchema
// ---------------------------------------------------------------------------

export const RunSchema = z.object({
	id: z.string(),
	prompt: z.string(),
	model: z.string().optional(),
	status: z.enum(["running", "completed", "error"]),
	startedAt: z.string(),
	costUsd: z.number().optional(),
	numTurns: z.number().optional(),
	durationSecs: z.number().optional(),
	error: z.string().optional(),
	filesCount: z.number().default(0),
	feedback: z.string().optional(),
	feedbackUser: z.string().optional(),
	// Branch metadata (additive — present only for branched runs)
	branchCount: z.number().optional(),
	branchWinnerId: z.string().optional(),
	evaluatorType: z.string().optional(),
});

export type Run = z.infer<typeof RunSchema>;

// ---------------------------------------------------------------------------
// SessionConfigSchema
// ---------------------------------------------------------------------------

export const SessionConfigSchema = z.object({
	idleTimeoutSecs: z.int().gte(30).lte(86400).optional(), // default 900 (15min)
	name: z.string().max(100).optional(),
	maxHistoryTurns: z.int().gte(1).lte(500).optional(), // default 50
});
export type SessionConfig = z.infer<typeof SessionConfigSchema>;

// ---------------------------------------------------------------------------
// SessionCreateRequestSchema
// ---------------------------------------------------------------------------

export const SessionCreateRequestSchema = QueryRequestSchema.extend({
	sessionConfig: SessionConfigSchema.optional(),
});
export type SessionCreateRequest = z.infer<typeof SessionCreateRequestSchema>;

// ---------------------------------------------------------------------------
// SessionMessageRequestSchema
// ---------------------------------------------------------------------------

export const SessionMessageRequestSchema = z.object({
	prompt: z.string().min(1).max(1_000_000),
	files: filesSchema.optional(),
});
export type SessionMessageRequest = z.infer<typeof SessionMessageRequestSchema>;

// ---------------------------------------------------------------------------
// SessionCommandSchema
// ---------------------------------------------------------------------------

export const SessionCommandSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("status") }),
	z.object({ type: z.literal("files") }),
	z.object({ type: z.literal("clear") }),
	z.object({ type: z.literal("compact") }),
]);
export type SessionCommand = z.infer<typeof SessionCommandSchema>;

// ---------------------------------------------------------------------------
// SessionSchema
// ---------------------------------------------------------------------------

export const SESSION_STATUS_VALUES = [
	"initializing",
	"active",
	"running",
	"expired",
	"ended",
	"failed",
] as const;

export const SessionSchema = z.object({
	id: z.string(),
	status: z.enum(SESSION_STATUS_VALUES),
	sandboxProvider: z.enum(SANDBOX_PROVIDER_VALUES),
	sandboxId: z.string().nullable(),
	config: SandcasterConfigSchema.optional(),
	sessionConfig: SessionConfigSchema.optional(),
	createdAt: z.string(),
	lastActivityAt: z.string(),
	idleTimeoutMs: z.number(),
	runs: z.array(
		z.object({
			id: z.string(),
			prompt: z.string(),
			startedAt: z.string(),
			costUsd: z.number().optional(),
			numTurns: z.number().optional(),
			durationSecs: z.number().optional(),
			status: z.enum(["running", "completed", "error"]),
		}),
	),
	totalCostUsd: z.number(),
	totalTurns: z.number(),
	name: z.string().optional(),
});
export type Session = z.infer<typeof SessionSchema>;

// ---------------------------------------------------------------------------
// SessionRecordSchema
// ---------------------------------------------------------------------------

export const SessionRecordSchema = z.object({
	id: z.string(),
	status: z.enum(SESSION_STATUS_VALUES),
	sandboxProvider: z.enum(SANDBOX_PROVIDER_VALUES),
	sandboxId: z.string().nullable(),
	createdAt: z.string(),
	lastActivityAt: z.string(),
	runsCount: z.number(),
	totalCostUsd: z.number(),
	totalTurns: z.number(),
	name: z.string().optional(),
	conversationSummary: z.string().optional(),
});
export type SessionRecord = z.infer<typeof SessionRecordSchema>;
