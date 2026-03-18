import { defineCommand } from "citty";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionListDeps {
	baseUrl: string;
	apiKey?: string;
	stdout: { write: (data: string) => boolean };
}

export interface SessionDeleteDeps {
	baseUrl: string;
	apiKey?: string;
	stdout: { write: (data: string) => boolean };
}

export interface SessionAttachDeps {
	baseUrl: string;
	apiKey?: string;
	stdout: { write: (data: string) => boolean };
}

// ---------------------------------------------------------------------------
// Core logic (injectable for testing)
// ---------------------------------------------------------------------------

export async function executeSessionList(deps: SessionListDeps): Promise<void> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (deps.apiKey) headers.Authorization = `Bearer ${deps.apiKey}`;

	const res = await fetch(`${deps.baseUrl}/sessions`, { headers });
	if (!res.ok) {
		deps.stdout.write(`Error: ${res.status} ${res.statusText}\n`);
		return;
	}

	const sessions = (await res.json()) as Array<{
		id: string;
		status: string;
		name?: string;
		createdAt: string;
		lastActivityAt: string;
		runsCount: number;
		totalCostUsd: number;
	}>;

	if (sessions.length === 0) {
		deps.stdout.write("No sessions found.\n");
		return;
	}

	// Simple table output
	deps.stdout.write("ID\tStatus\tName\tRuns\tCost\tCreated\n");
	for (const s of sessions) {
		deps.stdout.write(
			`${s.id}\t${s.status}\t${s.name ?? "-"}\t${s.runsCount}\t$${s.totalCostUsd.toFixed(4)}\t${s.createdAt}\n`,
		);
	}
}

export async function executeSessionDelete(
	sessionId: string,
	deps: SessionDeleteDeps,
): Promise<void> {
	const headers: Record<string, string> = {};
	if (deps.apiKey) headers.Authorization = `Bearer ${deps.apiKey}`;

	const res = await fetch(`${deps.baseUrl}/sessions/${sessionId}`, {
		method: "DELETE",
		headers,
	});

	if (!res.ok && res.status !== 204) {
		deps.stdout.write(`Error: ${res.status} ${res.statusText}\n`);
		return;
	}

	deps.stdout.write(`Session ${sessionId} deleted.\n`);
}

export async function executeSessionAttach(
	sessionId: string,
	deps: SessionAttachDeps,
): Promise<void> {
	const headers: Record<string, string> = {};
	if (deps.apiKey) headers.Authorization = `Bearer ${deps.apiKey}`;

	const res = await fetch(`${deps.baseUrl}/sessions/${sessionId}/events`, {
		headers,
	});

	if (!res.ok) {
		deps.stdout.write(`Error: ${res.status} ${res.statusText}\n`);
		return;
	}

	if (!res.body) {
		deps.stdout.write("No event stream available.\n");
		return;
	}

	// Read SSE stream and output events
	const reader = res.body.getReader();
	const decoder = new TextDecoder();

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			const text = decoder.decode(value, { stream: true });
			// Parse SSE lines and output event data
			for (const line of text.split("\n")) {
				if (line.startsWith("data: ")) {
					try {
						const event = JSON.parse(line.slice(6)) as {
							type: string;
							content?: string;
						};
						deps.stdout.write(`[${event.type}] ${event.content ?? ""}\n`);
					} catch {
						// skip malformed
					}
				}
			}
		}
	} finally {
		reader.releaseLock();
	}
}

// ---------------------------------------------------------------------------
// citty command definitions
// ---------------------------------------------------------------------------

const listSubcommand = defineCommand({
	meta: { name: "list", description: "List active and recent sessions" },
	async run() {
		const baseUrl = process.env.SANDCASTER_API_URL ?? "http://localhost:8000";
		const apiKey = process.env.SANDCASTER_API_KEY;
		await executeSessionList({ baseUrl, apiKey, stdout: process.stdout });
	},
});

const deleteSubcommand = defineCommand({
	meta: { name: "delete", description: "Delete a session" },
	args: {
		id: {
			type: "positional",
			description: "Session ID to delete",
			required: true,
		},
	},
	async run({ args }) {
		const baseUrl = process.env.SANDCASTER_API_URL ?? "http://localhost:8000";
		const apiKey = process.env.SANDCASTER_API_KEY;
		await executeSessionDelete(args.id as string, {
			baseUrl,
			apiKey,
			stdout: process.stdout,
		});
	},
});

const attachSubcommand = defineCommand({
	meta: { name: "attach", description: "Attach to a live session" },
	args: {
		id: {
			type: "positional",
			description: "Session ID to attach to",
			required: true,
		},
	},
	async run({ args }) {
		const baseUrl = process.env.SANDCASTER_API_URL ?? "http://localhost:8000";
		const apiKey = process.env.SANDCASTER_API_KEY;
		await executeSessionAttach(args.id as string, {
			baseUrl,
			apiKey,
			stdout: process.stdout,
		});
	},
});

export const sessionCommand = defineCommand({
	meta: {
		name: "session",
		description: "Manage sandbox sessions",
	},
	subCommands: {
		list: listSubcommand,
		delete: deleteSubcommand,
		attach: attachSubcommand,
	},
});
