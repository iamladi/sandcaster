import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";

const DEFAULT_CWD = "/home/user";
const DEFAULT_SKILLS_DIR = "/home/user/.pi/skills";

export function createSandboxTools(options?: {
	cwd?: string;
	skillsDir?: string;
}): AgentTool<any>[] {
	const cwd = options?.cwd ?? DEFAULT_CWD;
	const skillsDir = options?.skillsDir ?? DEFAULT_SKILLS_DIR;

	const bash: AgentTool<any> = {
		name: "bash",
		description: "Execute a shell command in the sandbox",
		label: "Run shell command",
		parameters: Type.Object({
			command: Type.String({ description: "Shell command to execute" }),
			timeout: Type.Optional(
				Type.Number({ description: "Timeout in ms", default: 30000 }),
			),
		}),
		execute: async (_toolCallId, params) => {
			try {
				const stdout = execSync(params.command, {
					cwd,
					timeout: params.timeout ?? 30000,
					encoding: "utf-8",
					maxBuffer: 10 * 1024 * 1024,
				});
				return {
					content: [{ type: "text" as const, text: stdout }],
					details: { exitCode: 0 },
				};
			} catch (err: unknown) {
				const exitCode = (err as { status?: number }).status ?? 1;
				const stderr = (err as { stderr?: string }).stderr ?? "";
				const stdout = (err as { stdout?: string }).stdout ?? "";
				const message = (err as { message?: string }).message ?? "";
				const output = [stdout, stderr].filter(Boolean).join("\n");
				// Throw so pi-agent-core marks the tool call as `isError: true`
				// and providers (notably Gemini) emit the error-shaped tool
				// response. Returning `{ isError: true }` is ignored by the
				// framework — only thrown errors propagate as tool errors.
				throw new Error(
					output || message || `Command exited with code ${exitCode}`,
				);
			}
		},
	};

	const file_read: AgentTool<any> = {
		name: "file_read",
		description: "Read the contents of a file",
		label: "Read file",
		parameters: Type.Object({
			path: Type.String({ description: "Absolute path to read" }),
		}),
		execute: async (_toolCallId, params) => {
			const text = readFileSync(params.path, "utf-8");
			return {
				content: [{ type: "text" as const, text }],
				details: {},
			};
		},
	};

	const file_write: AgentTool<any> = {
		name: "file_write",
		description:
			"Write content to a file, creating parent directories as needed",
		label: "Write file",
		parameters: Type.Object({
			path: Type.String({ description: "Absolute path to write" }),
			content: Type.String({ description: "File content" }),
		}),
		execute: async (_toolCallId, params) => {
			mkdirSync(dirname(params.path), { recursive: true });
			writeFileSync(params.path, params.content, "utf-8");
			return {
				content: [
					{ type: "text" as const, text: `File written: ${params.path}` },
				],
				details: {},
			};
		},
	};

	const read_skill: AgentTool<any> = {
		name: "read_skill",
		description: "Read the SKILL.md documentation for a named skill",
		label: "Read skill",
		parameters: Type.Object({
			name: Type.String({ description: "Skill name (directory name)" }),
		}),
		execute: async (_toolCallId, params) => {
			const text = readFileSync(
				join(skillsDir, params.name, "SKILL.md"),
				"utf-8",
			);
			return {
				content: [{ type: "text" as const, text }],
				details: {},
			};
		},
	};

	return [bash, file_read, file_write, read_skill];
}

// ---------------------------------------------------------------------------
// Branch tools — created separately, used by runner when branching is enabled
// ---------------------------------------------------------------------------

export interface BranchToolsResult {
	tools: AgentTool<any>[];
	shouldAbort: () => boolean;
}

export function createBranchTools(options: {
	emit: (event: Record<string, unknown>) => void;
}): BranchToolsResult {
	let abortRequested = false;

	const branch: AgentTool<any> = {
		name: "branch",
		description:
			"Fork execution into multiple parallel branches with different approaches. Each branch runs in its own isolated sandbox. The best result is selected by an evaluator.",
		label: "Branch execution",
		parameters: Type.Object({
			alternatives: Type.Array(
				Type.String({
					description: "Alternative prompt/approach for a branch",
				}),
				{
					description:
						"Array of alternative prompts to try in parallel branches",
					minItems: 1,
					maxItems: 10,
				},
			),
			reason: Type.Optional(
				Type.String({ description: "Why branching is being requested" }),
			),
		}),
		execute: async (_toolCallId, params) => {
			const event: Record<string, unknown> = {
				type: "branch_request",
				alternatives: params.alternatives,
			};
			if (params.reason) {
				event.reason = params.reason;
			}
			options.emit(event);
			abortRequested = true;

			return {
				content: [
					{
						type: "text" as const,
						text: "Branching requested. Execution will fork into parallel branches.",
					},
				],
				details: {},
			};
		},
	};

	const reportConfidence: AgentTool<any> = {
		name: "report_confidence",
		description:
			"Report your confidence level in the current approach. If confidence is below the configured threshold, the system may automatically branch to explore alternatives.",
		label: "Report confidence",
		parameters: Type.Object({
			level: Type.Number({
				description:
					"Confidence level from 0.0 (no confidence) to 1.0 (fully confident)",
				minimum: 0,
				maximum: 1,
			}),
			reason: Type.String({
				description: "Explanation of why you have this confidence level",
			}),
		}),
		execute: async (_toolCallId, params) => {
			options.emit({
				type: "confidence_report",
				level: params.level,
				reason: params.reason,
			});

			return {
				content: [
					{
						type: "text" as const,
						text: `Confidence reported: ${params.level} — ${params.reason}`,
					},
				],
				details: {},
			};
		},
	};

	return {
		tools: [branch, reportConfidence],
		shouldAbort: () => abortRequested,
	};
}
