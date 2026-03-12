import { describe, expectTypeOf, it } from "vitest";
import type {
	AssistantEvent,
	ErrorEvent,
	FileEvent,
	QueryRequest,
	ResultEvent,
	Run,
	SandcasterClientOptions,
	SandcasterEvent,
	SandcasterEventType,
	StderrEvent,
	SystemEvent,
	ThinkingEvent,
	ToolResultEvent,
	ToolUseEvent,
	WarningEvent,
} from "../types.js";

// ---------------------------------------------------------------------------
// Discriminated union narrowing
// ---------------------------------------------------------------------------

describe("SandcasterEvent discriminated union", () => {
	it("narrows to SystemEvent when type is 'system'", () => {
		const event = { type: "system", content: "hello" } as SandcasterEvent;
		if (event.type === "system") {
			expectTypeOf(event).toEqualTypeOf<SystemEvent>();
		}
	});

	it("narrows to AssistantEvent when type is 'assistant'", () => {
		const event = {
			type: "assistant",
			content: "hi",
		} as SandcasterEvent;
		if (event.type === "assistant") {
			expectTypeOf(event).toEqualTypeOf<AssistantEvent>();
		}
	});

	it("narrows to ToolUseEvent when type is 'tool_use'", () => {
		const event = {
			type: "tool_use",
			toolName: "bash",
			content: "ls",
		} as SandcasterEvent;
		if (event.type === "tool_use") {
			expectTypeOf(event).toEqualTypeOf<ToolUseEvent>();
		}
	});

	it("narrows to ToolResultEvent when type is 'tool_result'", () => {
		const event = {
			type: "tool_result",
			toolName: "bash",
			content: "output",
			isError: false,
		} as SandcasterEvent;
		if (event.type === "tool_result") {
			expectTypeOf(event).toEqualTypeOf<ToolResultEvent>();
		}
	});

	it("narrows to ThinkingEvent when type is 'thinking'", () => {
		const event = {
			type: "thinking",
			content: "...",
		} as SandcasterEvent;
		if (event.type === "thinking") {
			expectTypeOf(event).toEqualTypeOf<ThinkingEvent>();
		}
	});

	it("narrows to FileEvent when type is 'file'", () => {
		const event = {
			type: "file",
			path: "out.txt",
			content: "data",
		} as SandcasterEvent;
		if (event.type === "file") {
			expectTypeOf(event).toEqualTypeOf<FileEvent>();
		}
	});

	it("narrows to ResultEvent when type is 'result'", () => {
		const event = {
			type: "result",
			content: "done",
		} as SandcasterEvent;
		if (event.type === "result") {
			expectTypeOf(event).toEqualTypeOf<ResultEvent>();
		}
	});

	it("narrows to StderrEvent when type is 'stderr'", () => {
		const event = { type: "stderr", content: "err" } as SandcasterEvent;
		if (event.type === "stderr") {
			expectTypeOf(event).toEqualTypeOf<StderrEvent>();
		}
	});

	it("narrows to WarningEvent when type is 'warning'", () => {
		const event = {
			type: "warning",
			content: "warn",
		} as SandcasterEvent;
		if (event.type === "warning") {
			expectTypeOf(event).toEqualTypeOf<WarningEvent>();
		}
	});

	it("narrows to ErrorEvent when type is 'error'", () => {
		const event = { type: "error", content: "oops" } as SandcasterEvent;
		if (event.type === "error") {
			expectTypeOf(event).toEqualTypeOf<ErrorEvent>();
		}
	});

	it("ErrorEvent includes optional hint field", () => {
		const event: ErrorEvent = {
			type: "error",
			content: "fail",
			hint: "try this",
		};
		expectTypeOf(event.hint).toEqualTypeOf<string | undefined>();
	});
});

// ---------------------------------------------------------------------------
// SandcasterEventType
// ---------------------------------------------------------------------------

describe("SandcasterEventType", () => {
	it("is the union of all 10 type literals", () => {
		expectTypeOf<SandcasterEventType>().toEqualTypeOf<
			| "system"
			| "assistant"
			| "tool_use"
			| "tool_result"
			| "thinking"
			| "file"
			| "result"
			| "stderr"
			| "warning"
			| "error"
		>();
	});
});

// ---------------------------------------------------------------------------
// QueryRequest
// ---------------------------------------------------------------------------

describe("QueryRequest", () => {
	it("requires prompt field", () => {
		// satisfies confirms the type without widening
		const req = { prompt: "hello" } satisfies QueryRequest;
		expectTypeOf(req.prompt).toEqualTypeOf<string>();
	});

	it("has optional apiKeys with anthropic, e2b, openrouter", () => {
		const req: QueryRequest = {
			prompt: "test",
			apiKeys: { anthropic: "key", e2b: "key2", openrouter: "key3" },
		};
		expectTypeOf(req.apiKeys).toEqualTypeOf<
			{ anthropic?: string; e2b?: string; openrouter?: string } | undefined
		>();
	});

	it("has optional provider restricted to known values", () => {
		const req: QueryRequest = { prompt: "test", provider: "anthropic" };
		expectTypeOf(req.provider).toEqualTypeOf<
			"anthropic" | "vertex" | "bedrock" | "openrouter" | undefined
		>();
	});

	it("has optional thinkingLevel restricted to known values", () => {
		const req: QueryRequest = { prompt: "test", thinkingLevel: "high" };
		expectTypeOf(req.thinkingLevel).toEqualTypeOf<
			"none" | "low" | "medium" | "high" | undefined
		>();
	});
});

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

describe("Run", () => {
	it("has required id, prompt, status, startedAt, filesCount", () => {
		const run: Run = {
			id: "run-1",
			prompt: "hello",
			status: "running",
			startedAt: "2024-01-01T00:00:00Z",
			filesCount: 0,
		};
		expectTypeOf(run.id).toEqualTypeOf<string>();
		expectTypeOf(run.prompt).toEqualTypeOf<string>();
		expectTypeOf(run.status).toEqualTypeOf<"running" | "completed" | "error">();
		expectTypeOf(run.startedAt).toEqualTypeOf<string>();
		expectTypeOf(run.filesCount).toEqualTypeOf<number>();
	});

	it("has optional fields: model, costUsd, numTurns, durationSecs, error, feedback, feedbackUser", () => {
		const run: Run = {
			id: "run-1",
			prompt: "hello",
			status: "completed",
			startedAt: "2024-01-01T00:00:00Z",
			filesCount: 2,
			model: "claude-3-5-sonnet",
			costUsd: 0.01,
			numTurns: 3,
			durationSecs: 12.5,
			error: undefined,
			feedback: "good",
			feedbackUser: "alice",
		};
		expectTypeOf(run.model).toEqualTypeOf<string | undefined>();
		expectTypeOf(run.costUsd).toEqualTypeOf<number | undefined>();
	});
});

// ---------------------------------------------------------------------------
// SandcasterClientOptions
// ---------------------------------------------------------------------------

describe("SandcasterClientOptions", () => {
	it("requires baseUrl and has optional apiKey", () => {
		const opts: SandcasterClientOptions = { baseUrl: "http://localhost:3000" };
		expectTypeOf(opts.baseUrl).toEqualTypeOf<string>();
		expectTypeOf(opts.apiKey).toEqualTypeOf<string | undefined>();
	});
});
