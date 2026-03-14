// ---------------------------------------------------------------------------
// Event types — standalone discriminated union (no import from @sandcaster/core)
// ---------------------------------------------------------------------------

export interface SystemEvent {
	type: "system";
	subtype?: string;
	content: string;
}

export interface AssistantEvent {
	type: "assistant";
	subtype?: "delta" | "complete";
	content: string;
}

export interface ToolUseEvent {
	type: "tool_use";
	toolName: string;
	content: string;
}

export interface ToolResultEvent {
	type: "tool_result";
	content: string;
	toolName: string;
	isError: boolean;
}

export interface ThinkingEvent {
	type: "thinking";
	subtype?: "delta" | "complete";
	content: string;
}

export interface FileEvent {
	type: "file";
	path: string;
	content: string;
}

export interface ResultEvent {
	type: "result";
	subtype?: string;
	content: string;
	costUsd?: number;
	numTurns?: number;
	durationSecs?: number;
	model?: string;
}

export interface StderrEvent {
	type: "stderr";
	content: string;
}

export interface WarningEvent {
	type: "warning";
	content: string;
}

export interface ErrorEvent {
	type: "error";
	content: string;
	code?: string;
	hint?: string;
}

export type SandcasterEvent =
	| SystemEvent
	| AssistantEvent
	| ToolUseEvent
	| ToolResultEvent
	| ThinkingEvent
	| FileEvent
	| ResultEvent
	| StderrEvent
	| WarningEvent
	| ErrorEvent;

export type SandcasterEventType = SandcasterEvent["type"];

// ---------------------------------------------------------------------------
// QueryRequest
// ---------------------------------------------------------------------------

export interface QueryRequest {
	prompt: string;
	apiKeys?: {
		anthropic?: string;
		e2b?: string;
		openrouter?: string;
		vercel?: string;
		cloudflare?: string;
	};
	model?: string;
	maxTurns?: number;
	outputFormat?: Record<string, unknown>;
	timeout?: number;
	files?: Record<string, string>;
	allowedSkills?: string[];
	allowedTools?: string[];
	allowedAgents?: string[];
	extraAgents?: Record<string, unknown>;
	extraSkills?: Record<string, string>;
	provider?: "anthropic" | "vertex" | "bedrock" | "openrouter";
	thinkingLevel?: "none" | "low" | "medium" | "high";
	sandboxProvider?: "e2b" | "vercel" | "docker" | "cloudflare";
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

export interface Run {
	id: string;
	prompt: string;
	model?: string;
	status: "running" | "completed" | "error";
	startedAt: string;
	costUsd?: number;
	numTurns?: number;
	durationSecs?: number;
	error?: string;
	filesCount: number;
	feedback?: string;
	feedbackUser?: string;
}

// ---------------------------------------------------------------------------
// SandcasterClientOptions
// ---------------------------------------------------------------------------

export interface SandcasterClientOptions {
	baseUrl: string;
	apiKey?: string;
}
