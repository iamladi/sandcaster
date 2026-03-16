import { describe, expect, it } from "vitest";
import {
	QueryRequestSchema,
	RunSchema,
	SandcasterConfigSchema,
	SandcasterEventSchema,
} from "../schemas.js";

// ---------------------------------------------------------------------------
// QueryRequestSchema
// ---------------------------------------------------------------------------

describe("QueryRequestSchema", () => {
	it("accepts a minimal request with just a prompt", () => {
		const result = QueryRequestSchema.safeParse({ prompt: "hello" });
		expect(result.success).toBe(true);
	});

	it("accepts a full valid request", () => {
		const result = QueryRequestSchema.safeParse({
			prompt: "do a thing",
			apiKeys: { anthropic: "key1", e2b: "key2", openrouter: "key3" },
			model: "sonnet",
			maxTurns: 5,
			outputFormat: { type: "json" },
			timeout: 300,
			files: { "src/main.ts": "console.log('hi')" },
			allowedSkills: ["search"],
			allowedTools: ["bash"],
			allowedAgents: ["coder"],
			extraAgents: { my_agent: { instructions: "do stuff" } },
			extraSkills: { my_skill: "## skill content" },
			provider: "anthropic",
			thinkingLevel: "medium",
		});
		expect(result.success).toBe(true);
	});

	it("rejects an empty prompt", () => {
		const result = QueryRequestSchema.safeParse({ prompt: "" });
		expect(result.success).toBe(false);
	});

	it("rejects a prompt over 1,000,000 characters", () => {
		const result = QueryRequestSchema.safeParse({
			prompt: "a".repeat(1_000_001),
		});
		expect(result.success).toBe(false);
	});

	it("rejects file paths with traversal (../)", () => {
		const result = QueryRequestSchema.safeParse({
			prompt: "test",
			files: { "../etc/passwd": "data" },
		});
		expect(result.success).toBe(false);
	});

	it("rejects absolute file paths starting with /", () => {
		const result = QueryRequestSchema.safeParse({
			prompt: "test",
			files: { "/etc/passwd": "data" },
		});
		expect(result.success).toBe(false);
	});

	it("rejects absolute file paths starting with \\", () => {
		const result = QueryRequestSchema.safeParse({
			prompt: "test",
			files: { "\\server\\share": "data" },
		});
		expect(result.success).toBe(false);
	});

	it("rejects Windows drive paths (C:\\...)", () => {
		const result = QueryRequestSchema.safeParse({
			prompt: "test",
			files: { "C:\\Users\\file.txt": "data" },
		});
		expect(result.success).toBe(false);
	});

	it("rejects more than 20 files", () => {
		const files: Record<string, string> = {};
		for (let i = 0; i < 21; i++) {
			files[`file${i}.txt`] = "content";
		}
		const result = QueryRequestSchema.safeParse({ prompt: "test", files });
		expect(result.success).toBe(false);
	});

	it("rejects files exceeding 10MB total", () => {
		const result = QueryRequestSchema.safeParse({
			prompt: "test",
			files: {
				"file1.txt": "a".repeat(5_000_001),
				"file2.txt": "a".repeat(5_000_000),
			},
		});
		expect(result.success).toBe(false);
	});

	it("normalizes file paths (removes leading redundant segments)", () => {
		const result = QueryRequestSchema.safeParse({
			prompt: "test",
			files: { "foo/../bar/baz.txt": "content" },
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.files).toEqual({ "bar/baz.txt": "content" });
		}
	});

	it("rejects paths that resolve to empty (e.g. 'foo/..')", () => {
		const result = QueryRequestSchema.safeParse({
			prompt: "test",
			files: { "foo/..": "data" },
		});
		expect(result.success).toBe(false);
	});

	it("rejects invalid extra agent names (spaces/special chars)", () => {
		const result = QueryRequestSchema.safeParse({
			prompt: "test",
			extraAgents: { "bad name!": {} },
		});
		expect(result.success).toBe(false);
	});

	it("rejects invalid extra skill names (spaces/special chars)", () => {
		const result = QueryRequestSchema.safeParse({
			prompt: "test",
			extraSkills: { "bad name!": "content" },
		});
		expect(result.success).toBe(false);
	});

	it("accepts all valid provider values", () => {
		const providers = ["anthropic", "vertex", "bedrock", "openrouter"] as const;
		for (const provider of providers) {
			const result = QueryRequestSchema.safeParse({ prompt: "test", provider });
			expect(result.success).toBe(true);
		}
	});

	it("rejects an invalid provider value", () => {
		const result = QueryRequestSchema.safeParse({
			prompt: "test",
			provider: "unknown-provider",
		});
		expect(result.success).toBe(false);
	});

	it("accepts all valid sandboxProvider values", () => {
		const sandboxProviders = ["e2b", "vercel", "docker", "cloudflare"] as const;
		for (const sandboxProvider of sandboxProviders) {
			const result = QueryRequestSchema.safeParse({
				prompt: "test",
				sandboxProvider,
			});
			expect(result.success).toBe(true);
		}
	});

	it("rejects an invalid sandboxProvider value", () => {
		const result = QueryRequestSchema.safeParse({
			prompt: "test",
			sandboxProvider: "unknown-sandbox",
		});
		expect(result.success).toBe(false);
	});

	it("accepts vercel and cloudflare apiKeys", () => {
		const result = QueryRequestSchema.safeParse({
			prompt: "test",
			apiKeys: { vercel: "v-tok", cloudflare: "cf-tok" },
		});
		expect(result.success).toBe(true);
	});

	it("rejects maxTurns of 0", () => {
		const result = QueryRequestSchema.safeParse({
			prompt: "test",
			maxTurns: 0,
		});
		expect(result.success).toBe(false);
	});

	it("rejects timeout below 5", () => {
		const result = QueryRequestSchema.safeParse({ prompt: "test", timeout: 4 });
		expect(result.success).toBe(false);
	});

	it("rejects timeout above 3600", () => {
		const result = QueryRequestSchema.safeParse({
			prompt: "test",
			timeout: 3601,
		});
		expect(result.success).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// SandcasterConfigSchema
// ---------------------------------------------------------------------------

describe("SandcasterConfigSchema", () => {
	it("accepts an empty config (all fields optional)", () => {
		const result = SandcasterConfigSchema.safeParse({});
		expect(result.success).toBe(true);
	});

	it("accepts a string systemPrompt", () => {
		const result = SandcasterConfigSchema.safeParse({
			systemPrompt: "You are a helpful assistant.",
		});
		expect(result.success).toBe(true);
	});

	it("accepts an object systemPrompt with preset and append", () => {
		const result = SandcasterConfigSchema.safeParse({
			systemPrompt: { preset: "default", append: "extra instructions" },
		});
		expect(result.success).toBe(true);
	});

	it("accepts an object systemPrompt with only preset", () => {
		const result = SandcasterConfigSchema.safeParse({
			systemPrompt: { preset: "coding" },
		});
		expect(result.success).toBe(true);
	});

	it("accepts agents as a dict (Record<string, unknown>)", () => {
		const result = SandcasterConfigSchema.safeParse({
			agents: { coder: { instructions: "write code" } },
		});
		expect(result.success).toBe(true);
	});

	it("accepts agents as a list (array)", () => {
		const result = SandcasterConfigSchema.safeParse({
			agents: [{ name: "coder" }, { name: "tester" }],
		});
		expect(result.success).toBe(true);
	});

	it("rejects maxTurns of 0", () => {
		const result = SandcasterConfigSchema.safeParse({ maxTurns: 0 });
		expect(result.success).toBe(false);
	});

	it("rejects timeout of 1 (below minimum of 5)", () => {
		const result = SandcasterConfigSchema.safeParse({ timeout: 1 });
		expect(result.success).toBe(false);
	});

	it("accepts valid provider and thinkingLevel", () => {
		const result = SandcasterConfigSchema.safeParse({
			provider: "vertex",
			thinkingLevel: "high",
		});
		expect(result.success).toBe(true);
	});

	it("accepts all valid sandboxProvider values", () => {
		const sandboxProviders = ["e2b", "vercel", "docker", "cloudflare"] as const;
		for (const sandboxProvider of sandboxProviders) {
			const result = SandcasterConfigSchema.safeParse({ sandboxProvider });
			expect(result.success).toBe(true);
		}
	});

	it("rejects an invalid sandboxProvider value", () => {
		const result = SandcasterConfigSchema.safeParse({
			sandboxProvider: "unknown-sandbox",
		});
		expect(result.success).toBe(false);
	});

	it("accepts a valid composite config", () => {
		const result = SandcasterConfigSchema.safeParse({
			composite: {
				maxSandboxes: 5,
				maxTotalSpawns: 20,
				allowedProviders: ["e2b", "docker"],
				pollIntervalMs: 100,
			},
		});
		expect(result.success).toBe(true);
	});

	it("composite defaults maxSandboxes to 3 when omitted", () => {
		const result = SandcasterConfigSchema.safeParse({
			composite: {},
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.composite?.maxSandboxes).toBe(3);
		}
	});

	it("composite defaults maxTotalSpawns to 10 when omitted", () => {
		const result = SandcasterConfigSchema.safeParse({
			composite: {},
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.composite?.maxTotalSpawns).toBe(10);
		}
	});

	it("composite defaults pollIntervalMs to 50 when omitted", () => {
		const result = SandcasterConfigSchema.safeParse({
			composite: {},
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.composite?.pollIntervalMs).toBe(50);
		}
	});

	it("composite defaults allowedProviders to all providers when omitted", () => {
		const result = SandcasterConfigSchema.safeParse({
			composite: {},
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.composite?.allowedProviders).toEqual(
				expect.arrayContaining(["e2b", "vercel", "docker", "cloudflare"]),
			);
		}
	});

	it("composite rejects maxSandboxes above 20", () => {
		const result = SandcasterConfigSchema.safeParse({
			composite: { maxSandboxes: 21 },
		});
		expect(result.success).toBe(false);
	});

	it("composite rejects maxSandboxes of 0", () => {
		const result = SandcasterConfigSchema.safeParse({
			composite: { maxSandboxes: 0 },
		});
		expect(result.success).toBe(false);
	});

	it("composite rejects maxTotalSpawns above 100", () => {
		const result = SandcasterConfigSchema.safeParse({
			composite: { maxTotalSpawns: 101 },
		});
		expect(result.success).toBe(false);
	});

	it("composite rejects pollIntervalMs below 10", () => {
		const result = SandcasterConfigSchema.safeParse({
			composite: { pollIntervalMs: 9 },
		});
		expect(result.success).toBe(false);
	});

	it("composite rejects pollIntervalMs above 1000", () => {
		const result = SandcasterConfigSchema.safeParse({
			composite: { pollIntervalMs: 1001 },
		});
		expect(result.success).toBe(false);
	});

	it("composite rejects unknown provider values", () => {
		const result = SandcasterConfigSchema.safeParse({
			composite: { allowedProviders: ["unknown"] },
		});
		expect(result.success).toBe(false);
	});

	it("omitting composite field entirely is valid", () => {
		const result = SandcasterConfigSchema.safeParse({});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.composite).toBeUndefined();
		}
	});
});

// ---------------------------------------------------------------------------
// QueryRequestSchema — composite field
// ---------------------------------------------------------------------------

describe("QueryRequestSchema — composite field", () => {
	it("accepts a request with a composite field", () => {
		const result = QueryRequestSchema.safeParse({
			prompt: "test",
			composite: {
				maxSandboxes: 2,
				maxTotalSpawns: 5,
				allowedProviders: ["e2b"],
			},
		});
		expect(result.success).toBe(true);
	});

	it("accepts composite with only maxSandboxes", () => {
		const result = QueryRequestSchema.safeParse({
			prompt: "test",
			composite: { maxSandboxes: 1 },
		});
		expect(result.success).toBe(true);
	});

	it("accepts composite with only allowedProviders", () => {
		const result = QueryRequestSchema.safeParse({
			prompt: "test",
			composite: { allowedProviders: ["docker", "vercel"] },
		});
		expect(result.success).toBe(true);
	});

	it("accepts an empty composite object", () => {
		const result = QueryRequestSchema.safeParse({
			prompt: "test",
			composite: {},
		});
		expect(result.success).toBe(true);
	});

	it("omitting composite is valid", () => {
		const result = QueryRequestSchema.safeParse({ prompt: "test" });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.composite).toBeUndefined();
		}
	});

	it("rejects composite maxSandboxes of 0", () => {
		const result = QueryRequestSchema.safeParse({
			prompt: "test",
			composite: { maxSandboxes: 0 },
		});
		expect(result.success).toBe(false);
	});

	it("rejects composite maxTotalSpawns of 0", () => {
		const result = QueryRequestSchema.safeParse({
			prompt: "test",
			composite: { maxTotalSpawns: 0 },
		});
		expect(result.success).toBe(false);
	});

	it("rejects unknown sandbox provider in composite allowedProviders", () => {
		const result = QueryRequestSchema.safeParse({
			prompt: "test",
			composite: { allowedProviders: ["unknown-provider"] },
		});
		expect(result.success).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// SandcasterEventSchema
// ---------------------------------------------------------------------------

describe("SandcasterEventSchema", () => {
	it("parses a system event", () => {
		const result = SandcasterEventSchema.safeParse({
			type: "system",
			content: "System started",
		});
		expect(result.success).toBe(true);
		if (result.success) expect(result.data.type).toBe("system");
	});

	it("parses a system event with subtype", () => {
		const result = SandcasterEventSchema.safeParse({
			type: "system",
			subtype: "init",
			content: "Agent started",
		});
		expect(result.success).toBe(true);
		if (result.success && result.data.type === "system") {
			expect(result.data.subtype).toBe("init");
		}
	});

	it("parses an assistant event", () => {
		const result = SandcasterEventSchema.safeParse({
			type: "assistant",
			content: "Hello!",
		});
		expect(result.success).toBe(true);
	});

	it("parses an assistant delta event", () => {
		const result = SandcasterEventSchema.safeParse({
			type: "assistant",
			subtype: "delta",
			content: "Hel",
		});
		expect(result.success).toBe(true);
		if (result.success && result.data.type === "assistant") {
			expect(result.data.subtype).toBe("delta");
		}
	});

	it("parses an assistant complete event", () => {
		const result = SandcasterEventSchema.safeParse({
			type: "assistant",
			subtype: "complete",
			content: "Hello world!",
		});
		expect(result.success).toBe(true);
	});

	it("parses a tool_use event", () => {
		const result = SandcasterEventSchema.safeParse({
			type: "tool_use",
			toolName: "bash",
			content: '{"command":"ls"}',
		});
		expect(result.success).toBe(true);
		if (result.success && result.data.type === "tool_use") {
			expect(result.data.toolName).toBe("bash");
		}
	});

	it("parses a tool_result event", () => {
		const result = SandcasterEventSchema.safeParse({
			type: "tool_result",
			content: "output",
			toolName: "bash",
		});
		expect(result.success).toBe(true);
		if (result.success && result.data.type === "tool_result") {
			expect(result.data.toolName).toBe("bash");
		}
	});

	it("parses a tool_result event with isError", () => {
		const result = SandcasterEventSchema.safeParse({
			type: "tool_result",
			content: "command not found",
			toolName: "bash",
			isError: true,
		});
		expect(result.success).toBe(true);
		if (result.success && result.data.type === "tool_result") {
			expect(result.data.isError).toBe(true);
		}
	});

	it("parses a thinking event", () => {
		const result = SandcasterEventSchema.safeParse({
			type: "thinking",
			content: "Reasoning...",
		});
		expect(result.success).toBe(true);
	});

	it("parses a thinking delta event", () => {
		const result = SandcasterEventSchema.safeParse({
			type: "thinking",
			subtype: "delta",
			content: "Let me think...",
		});
		expect(result.success).toBe(true);
	});

	it("parses a file event", () => {
		const result = SandcasterEventSchema.safeParse({
			type: "file",
			path: "output.txt",
			content: "file contents",
		});
		expect(result.success).toBe(true);
	});

	it("parses a result event with all optional fields", () => {
		const result = SandcasterEventSchema.safeParse({
			type: "result",
			subtype: "success",
			content: "done",
			costUsd: 0.05,
			numTurns: 3,
			durationSecs: 12.5,
			model: "claude-sonnet-4-5",
		});
		expect(result.success).toBe(true);
		if (result.success && result.data.type === "result") {
			expect(result.data.costUsd).toBe(0.05);
			expect(result.data.numTurns).toBe(3);
			expect(result.data.subtype).toBe("success");
		}
	});

	it("parses a result event without optional fields", () => {
		const result = SandcasterEventSchema.safeParse({
			type: "result",
			content: "done",
		});
		expect(result.success).toBe(true);
	});

	it("parses a stderr event", () => {
		const result = SandcasterEventSchema.safeParse({
			type: "stderr",
			content: "error output",
		});
		expect(result.success).toBe(true);
	});

	it("parses a warning event", () => {
		const result = SandcasterEventSchema.safeParse({
			type: "warning",
			content: "something may be wrong",
		});
		expect(result.success).toBe(true);
	});

	it("parses an error event with optional code", () => {
		const result = SandcasterEventSchema.safeParse({
			type: "error",
			content: "something went wrong",
			code: "TIMEOUT",
		});
		expect(result.success).toBe(true);
		if (result.success && result.data.type === "error") {
			expect(result.data.code).toBe("TIMEOUT");
		}
	});

	it("parses an error event without code", () => {
		const result = SandcasterEventSchema.safeParse({
			type: "error",
			content: "something went wrong",
		});
		expect(result.success).toBe(true);
	});

	it("rejects an unknown event type", () => {
		const result = SandcasterEventSchema.safeParse({
			type: "unknown_type",
			content: "test",
		});
		expect(result.success).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// RunSchema
// ---------------------------------------------------------------------------

describe("RunSchema", () => {
	const validRun = {
		id: "run_abc123",
		prompt: "do something",
		status: "running" as const,
		startedAt: "2024-01-01T00:00:00.000Z",
		filesCount: 2,
	};

	it("parses a valid run", () => {
		const result = RunSchema.safeParse(validRun);
		expect(result.success).toBe(true);
	});

	it("defaults filesCount to 0 when omitted", () => {
		const { filesCount: _, ...withoutFilesCount } = validRun;
		const result = RunSchema.safeParse(withoutFilesCount);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.filesCount).toBe(0);
		}
	});

	it("parses a completed run with all optional fields", () => {
		const result = RunSchema.safeParse({
			...validRun,
			model: "claude-sonnet-4-5",
			status: "completed",
			costUsd: 0.12,
			numTurns: 5,
			durationSecs: 30.2,
			feedback: "looks good",
			feedbackUser: "user123",
		});
		expect(result.success).toBe(true);
	});

	it("parses an error run with error field", () => {
		const result = RunSchema.safeParse({
			...validRun,
			status: "error",
			error: "Sandbox timed out",
		});
		expect(result.success).toBe(true);
	});

	it("rejects an invalid status value", () => {
		const result = RunSchema.safeParse({ ...validRun, status: "pending" });
		expect(result.success).toBe(false);
	});

	it("rejects a run missing required id", () => {
		const { id: _, ...withoutId } = validRun;
		const result = RunSchema.safeParse(withoutId);
		expect(result.success).toBe(false);
	});
});
