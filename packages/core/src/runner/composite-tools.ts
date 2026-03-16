import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { IpcClient } from "./ipc-client.js";

function errorResult(text: string) {
	return {
		content: [{ type: "text" as const, text }],
		details: {},
		isError: true as const,
	};
}

function successResult(text: string) {
	return {
		content: [{ type: "text" as const, text }],
		details: {},
	};
}

export function createCompositeTools(ipcClient: IpcClient): AgentTool<any>[] {
	const spawn_sandbox: AgentTool<any> = {
		name: "spawn_sandbox",
		description:
			"Spawn a new sandbox by name and provider. Returns the working directory of the new sandbox.",
		label: "Spawn sandbox",
		parameters: Type.Object({
			name: Type.String({ description: "Unique name for the sandbox" }),
			provider: Type.String({
				description: "Provider to use (e.g. e2b, docker)",
			}),
			template: Type.Optional(
				Type.String({ description: "Template or image to use" }),
			),
		}),
		execute: async (_toolCallId, params) => {
			const response = await ipcClient.request("spawn", {
				name: params.name,
				provider: params.provider,
				template: params.template,
			});
			if (!response.ok) {
				return errorResult(response.error ?? "spawn failed");
			}
			return successResult(
				`Spawned sandbox '${params.name}' (workDir: ${response.workDir})`,
			);
		},
	};

	const exec_in: AgentTool<any> = {
		name: "exec_in",
		description:
			"Execute a shell command inside a named sandbox. Use the bash tool for the primary sandbox.",
		label: "Execute in sandbox",
		parameters: Type.Object({
			sandbox: Type.String({ description: "Name of the target sandbox" }),
			command: Type.String({ description: "Shell command to execute" }),
			timeout: Type.Optional(
				Type.Number({
					description: "Timeout in ms (max 300000, default 30000)",
					default: 30000,
				}),
			),
		}),
		execute: async (_toolCallId, params) => {
			if (params.sandbox.trim().toLowerCase() === "primary") {
				return errorResult(
					"Cannot exec_in 'primary' — use the bash tool for the primary sandbox.",
				);
			}
			const clampedTimeout = Math.min(params.timeout ?? 30000, 300000);
			const response = await ipcClient.request("exec", {
				name: params.sandbox,
				command: params.command,
				timeout: clampedTimeout,
			});
			if (!response.ok) {
				return errorResult(response.error ?? "exec failed");
			}
			const result = response.result as
				| { stdout?: string; stderr?: string }
				| undefined;
			const stdout = result?.stdout ?? "";
			const stderr = result?.stderr ?? "";
			const output = [stdout, stderr].filter(Boolean).join("\n");
			return successResult(output);
		},
	};

	const transfer_files: AgentTool<any> = {
		name: "transfer_files",
		description:
			"Transfer files between sandboxes. Specify source sandbox, destination sandbox, and paths to copy.",
		label: "Transfer files",
		parameters: Type.Object({
			from: Type.String({ description: "Source sandbox name" }),
			to: Type.String({ description: "Destination sandbox name" }),
			paths: Type.Array(Type.String(), {
				description: "List of file paths to transfer",
			}),
		}),
		execute: async (_toolCallId, params) => {
			const response = await ipcClient.request("transfer", {
				from: params.from,
				to: params.to,
				paths: params.paths,
			});
			if (!response.ok) {
				return errorResult(response.error ?? "transfer failed");
			}
			const result = response.result as
				| { transferred?: string[]; failed?: string[] }
				| undefined;
			const transferred = result?.transferred ?? [];
			const failed = result?.failed ?? [];
			const lines: string[] = [
				`Transferred ${transferred.length} file(s): ${transferred.join(", ") || "(none)"}`,
			];
			if (failed.length > 0) {
				lines.push(`Failed (${failed.length}): ${failed.join(", ")}`);
			}
			return successResult(lines.join("\n"));
		},
	};

	const kill_sandbox: AgentTool<any> = {
		name: "kill_sandbox",
		description:
			"Kill and remove a named sandbox. The primary sandbox cannot be killed this way.",
		label: "Kill sandbox",
		parameters: Type.Object({
			name: Type.String({ description: "Name of the sandbox to kill" }),
		}),
		execute: async (_toolCallId, params) => {
			if (params.name.trim().toLowerCase() === "primary") {
				return errorResult(
					"Cannot kill 'primary' — the primary sandbox is host-owned.",
				);
			}
			const response = await ipcClient.request("kill", { name: params.name });
			if (!response.ok) {
				return errorResult(response.error ?? "kill failed");
			}
			return successResult(`Killed sandbox '${params.name}'`);
		},
	};

	const list_sandboxes: AgentTool<any> = {
		name: "list_sandboxes",
		description: "List all active sandboxes in the current session.",
		label: "List sandboxes",
		parameters: Type.Object({}),
		execute: async (_toolCallId, _params) => {
			const response = await ipcClient.request("list", {});
			if (!response.ok) {
				return errorResult(response.error ?? "list failed");
			}
			const sandboxes = response.result as
				| Array<Record<string, unknown>>
				| undefined;
			if (!sandboxes || sandboxes.length === 0) {
				return successResult("No active sandboxes.");
			}
			const lines = sandboxes.map((s) => {
				const name = s.name ?? "(unknown)";
				const provider = s.provider ? ` [${s.provider}]` : "";
				return `- ${name}${provider}`;
			});
			return successResult(lines.join("\n"));
		},
	};

	return [spawn_sandbox, exec_in, transfer_files, kill_sandbox, list_sandboxes];
}
