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
				const output = [stdout, stderr].filter(Boolean).join("\n");
				return {
					content: [
						{
							type: "text" as const,
							text: output || String(err),
						},
					],
					details: { exitCode },
					isError: true,
				};
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
