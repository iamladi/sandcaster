import * as z from "zod";

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
	webhookUrl: z.url().optional(),
	provider: z.enum(PROVIDER_VALUES).optional(),
	thinkingLevel: z.enum(THINKING_LEVEL_VALUES).optional(),
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
	}),
	z.object({
		type: z.literal("tool_result"),
		content: z.string(),
		toolName: z.string(),
		isError: z.boolean().default(false),
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
});

export type Run = z.infer<typeof RunSchema>;
