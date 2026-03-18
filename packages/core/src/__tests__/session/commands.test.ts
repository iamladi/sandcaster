import { describe, expect, it, vi } from "vitest";
import type { SandcasterEvent } from "../../schemas.js";
import { executeCommand, parseSessionCommand } from "../../session/commands.js";
import type { ActiveSession } from "../../session/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeActiveSession(overrides?: Partial<ActiveSession>): ActiveSession {
	return {
		session: {
			id: "sess_test-fox-1234",
			status: "active",
			sandboxProvider: "e2b",
			sandboxId: null,
			createdAt: "2026-03-15T00:00:00.000Z",
			lastActivityAt: "2026-03-15T00:00:00.000Z",
			idleTimeoutMs: 900_000,
			runs: [],
			totalCostUsd: 0.05,
			totalTurns: 3,
		},
		instance: {
			workDir: "/home/user",
			capabilities: {
				fileSystem: true,
				shellExec: true,
				envInjection: true,
				streaming: true,
				networkPolicy: false,
				snapshots: false,
				reconnect: false,
				customImage: false,
			},
			files: {
				write: vi.fn().mockResolvedValue(undefined),
				read: vi.fn().mockResolvedValue(""),
			},
			commands: {
				run: vi.fn().mockResolvedValue({
					stdout: "/home/user/file1.ts\n/home/user/file2.ts\n",
					stderr: "",
					exitCode: 0,
				}),
			},
			kill: vi.fn().mockResolvedValue(undefined),
		},
		history: [],
		idleTimer: null,
		abortController: null,
		clients: new Set(),
		...overrides,
	};
}

async function collectEvents(
	gen: AsyncGenerator<SandcasterEvent>,
): Promise<SandcasterEvent[]> {
	const events: SandcasterEvent[] = [];
	for await (const event of gen) events.push(event);
	return events;
}

// ---------------------------------------------------------------------------
// parseSessionCommand
// ---------------------------------------------------------------------------

describe("parseSessionCommand", () => {
	it('parses "/status"', () => {
		expect(parseSessionCommand("/status")).toEqual({ type: "status" });
	});

	it('parses "/files"', () => {
		expect(parseSessionCommand("/files")).toEqual({ type: "files" });
	});

	it('parses "/clear"', () => {
		expect(parseSessionCommand("/clear")).toEqual({ type: "clear" });
	});

	it('parses "/compact"', () => {
		expect(parseSessionCommand("/compact")).toEqual({ type: "compact" });
	});

	it("ignores trailing text after valid command", () => {
		expect(parseSessionCommand("/status with extra text")).toEqual({
			type: "status",
		});
	});

	it('returns null for "/unknown"', () => {
		expect(parseSessionCommand("/unknown")).toBeNull();
	});

	it("returns null for regular prompt", () => {
		expect(parseSessionCommand("regular prompt")).toBeNull();
	});

	it('returns null for "/ status" (space after slash)', () => {
		expect(parseSessionCommand("/ status")).toBeNull();
	});

	it("returns null for empty string", () => {
		expect(parseSessionCommand("")).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// executeCommand — /status
// ---------------------------------------------------------------------------

describe("executeCommand /status", () => {
	it("returns session metadata", async () => {
		const session = makeActiveSession();
		const events = await collectEvents(
			executeCommand(session, { type: "status" }),
		);
		expect(events).toHaveLength(1);
		const event = events[0];
		expect(event.type).toBe("session_command_result");
		if (event.type === "session_command_result") {
			expect(event.command).toBe("status");
			expect(event.content).toContain("sess_test-fox-1234");
			expect(event.content).toContain("active");
			expect(event.content).toContain("3");
			expect(event.content).toContain("0.0500");
			expect(event.data).toMatchObject({
				id: "sess_test-fox-1234",
				status: "active",
				totalTurns: 3,
				totalCostUsd: 0.05,
				historyLength: 0,
				createdAt: "2026-03-15T00:00:00.000Z",
				lastActivityAt: "2026-03-15T00:00:00.000Z",
			});
		}
	});
});

// ---------------------------------------------------------------------------
// executeCommand — /files
// ---------------------------------------------------------------------------

describe("executeCommand /files", () => {
	it("lists files in sandbox workspace", async () => {
		const session = makeActiveSession();
		const events = await collectEvents(
			executeCommand(session, { type: "files" }),
		);
		expect(events).toHaveLength(1);
		const event = events[0];
		expect(event.type).toBe("session_command_result");
		if (event.type === "session_command_result") {
			expect(event.command).toBe("files");
			expect(event.content).toContain("file1.ts");
			expect(event.content).toContain("file2.ts");
			expect(event.data).toMatchObject({
				files: ["/home/user/file1.ts", "/home/user/file2.ts"],
				truncated: false,
			});
		}
	});

	it("yields error event when instance is null", async () => {
		const session = makeActiveSession({ instance: null });
		const events = await collectEvents(
			executeCommand(session, { type: "files" }),
		);
		expect(events).toHaveLength(1);
		expect(events[0].type).toBe("error");
	});

	it("sets truncated flag when output has 200+ files", async () => {
		const manyFiles = Array.from(
			{ length: 200 },
			(_, i) => `/home/user/file${i}.ts`,
		).join("\n");
		const session = makeActiveSession({
			instance: {
				workDir: "/home/user",
				capabilities: {
					fileSystem: true,
					shellExec: true,
					envInjection: true,
					streaming: true,
					networkPolicy: false,
					snapshots: false,
					reconnect: false,
					customImage: false,
				},
				files: {
					write: vi.fn().mockResolvedValue(undefined),
					read: vi.fn().mockResolvedValue(""),
				},
				commands: {
					run: vi.fn().mockResolvedValue({
						stdout: manyFiles,
						stderr: "",
						exitCode: 0,
					}),
				},
				kill: vi.fn().mockResolvedValue(undefined),
			},
		});
		const events = await collectEvents(
			executeCommand(session, { type: "files" }),
		);
		expect(events).toHaveLength(1);
		const event = events[0];
		expect(event.type).toBe("session_command_result");
		if (event.type === "session_command_result") {
			expect((event.data as { truncated: boolean }).truncated).toBe(true);
			expect(event.content).toContain("truncated");
		}
	});
});

// ---------------------------------------------------------------------------
// executeCommand — /clear
// ---------------------------------------------------------------------------

describe("executeCommand /clear", () => {
	it("resets conversation history", async () => {
		const session = makeActiveSession({
			history: [
				{ role: "user", content: "hello" },
				{ role: "assistant", content: "hi" },
			],
		});
		const events = await collectEvents(
			executeCommand(session, { type: "clear" }),
		);
		expect(events).toHaveLength(1);
		expect(events[0].type).toBe("session_command_result");
		if (events[0].type === "session_command_result") {
			expect(events[0].command).toBe("clear");
		}
		expect(session.history).toHaveLength(0);
	});

	it("clears conversationSummary", async () => {
		const session = makeActiveSession({ conversationSummary: "some summary" });
		await collectEvents(executeCommand(session, { type: "clear" }));
		expect(session.conversationSummary).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// executeCommand — /compact
// ---------------------------------------------------------------------------

describe("executeCommand /compact", () => {
	it("compacts history via summarizer on success", async () => {
		const session = makeActiveSession({
			history: [
				{ role: "user", content: "hello" },
				{ role: "assistant", content: "hi" },
			],
		});
		const summarizer = vi.fn().mockResolvedValue("compact summary text");
		const events = await collectEvents(
			executeCommand(session, { type: "compact" }, { summarizer }),
		);
		expect(events).toHaveLength(1);
		const event = events[0];
		expect(event.type).toBe("session_command_result");
		if (event.type === "session_command_result") {
			expect(event.command).toBe("compact");
			expect(event.content).toContain("compact summary text".length.toString());
		}
		expect(session.conversationSummary).toBe("compact summary text");
	});

	it("yields error event when summarizer fails", async () => {
		const session = makeActiveSession({
			history: [{ role: "user", content: "hello" }],
		});
		const originalHistory = [...session.history];
		const summarizer = vi.fn().mockRejectedValue(new Error("LLM down"));
		const events = await collectEvents(
			executeCommand(session, { type: "compact" }, { summarizer }),
		);
		expect(events).toHaveLength(1);
		expect(events[0].type).toBe("error");
		if (events[0].type === "error") {
			expect(events[0].content).toContain("LLM down");
		}
		// history must be unchanged
		expect(session.history).toHaveLength(originalHistory.length);
	});

	it("yields error when no summarizer configured", async () => {
		const session = makeActiveSession({
			history: [{ role: "user", content: "hello" }],
		});
		const events = await collectEvents(
			executeCommand(session, { type: "compact" }),
		);
		expect(events).toHaveLength(1);
		expect(events[0].type).toBe("error");
	});

	it("returns nothing-to-compact message when history is empty", async () => {
		const session = makeActiveSession({ history: [] });
		const summarizer = vi.fn().mockResolvedValue("summary");
		const events = await collectEvents(
			executeCommand(session, { type: "compact" }, { summarizer }),
		);
		expect(events).toHaveLength(1);
		const event = events[0];
		expect(event.type).toBe("session_command_result");
		if (event.type === "session_command_result") {
			expect(event.command).toBe("compact");
			expect(event.content).toContain("empty");
		}
		expect(summarizer).not.toHaveBeenCalled();
	});
});
