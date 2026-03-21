import { beforeEach, describe, expect, test } from "vitest";
import { createPatchApplier } from "../patch-applier.js";
import type { AgentOutput, CommentReply, ResolvedToken } from "../types.js";

// ---------------------------------------------------------------------------
// Fake deps factory
// ---------------------------------------------------------------------------

interface FakeDeps {
	exec: (cmd: string, opts?: { cwd?: string }) => Promise<string>;
	writeFile: (path: string, content: string) => Promise<void>;
	readFile: (path: string) => Promise<string>;
	mkTempDir: () => Promise<string>;
	rmDir: (path: string) => Promise<void>;
	// assertion helpers
	executedCommands: Array<{ cmd: string; cwd?: string }>;
	writtenFiles: Array<{ path: string; content: string }>;
	removedDirs: string[];
	setExecResponse: (pattern: string, response: string) => void;
	setExecError: (pattern: string, error: Error) => void;
}

function createFakeDeps(tempDir = "/tmp/fake-sandbox-abc123"): FakeDeps {
	const executedCommands: Array<{ cmd: string; cwd?: string }> = [];
	const writtenFiles: Array<{ path: string; content: string }> = [];
	const removedDirs: string[] = [];

	// Map of command pattern -> response (substring match)
	const responses = new Map<string, string>();
	const errors = new Map<string, Error>();

	// Default git command responses
	responses.set("git rev-parse HEAD", "deadbeef1234567890abcdef");
	responses.set("git clone", "");
	responses.set("git checkout", "");
	responses.set("git add", "");
	responses.set("git commit", "");
	responses.set("git push", "");
	responses.set("git pull --rebase", "");
	responses.set("git config", "");

	const exec = async (
		cmd: string,
		opts?: { cwd?: string },
	): Promise<string> => {
		executedCommands.push({ cmd, cwd: opts?.cwd });

		// Check for errors first (exact substring match)
		for (const [pattern, err] of errors) {
			if (cmd.includes(pattern)) {
				throw err;
			}
		}

		// Return canned response (exact substring match, most specific wins)
		for (const [pattern, response] of responses) {
			if (cmd.includes(pattern)) {
				return response;
			}
		}

		return "";
	};

	const writeFile = async (path: string, content: string): Promise<void> => {
		writtenFiles.push({ path, content });
	};

	const readFile = async (_path: string): Promise<string> => {
		return "";
	};

	const mkTempDir = async (): Promise<string> => {
		return tempDir;
	};

	const rmDir = async (path: string): Promise<void> => {
		removedDirs.push(path);
	};

	const setExecResponse = (pattern: string, response: string): void => {
		responses.set(pattern, response);
	};

	const setExecError = (pattern: string, error: Error): void => {
		errors.set(pattern, error);
	};

	return {
		exec,
		writeFile,
		readFile,
		mkTempDir,
		rmDir,
		executedCommands,
		writtenFiles,
		removedDirs,
		setExecResponse,
		setExecError,
	};
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TEMP_DIR = "/tmp/fake-sandbox-abc123";

const TOKEN: ResolvedToken = {
	token: "ghs_test_token_abc",
	authHeader: "token ghs_test_token_abc",
};

const BASE_PARAMS = {
	cloneUrl: "https://github.com/owner/repo.git",
	branch: "feature/my-branch",
	token: TOKEN,
	isFork: false,
};

function makeAgentOutput(overrides?: Partial<AgentOutput>): AgentOutput {
	return {
		results: [
			{
				commentId: 101,
				fixed: true,
				description: "Renamed variable to follow conventions",
				filesModified: ["src/index.ts"],
			},
		],
		summary: "Fixed 1 of 1 comments",
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createPatchApplier — applyAndPush", () => {
	let deps: FakeDeps;

	beforeEach(() => {
		deps = createFakeDeps(TEMP_DIR);
	});

	// -------------------------------------------------------------------------
	// Scenario 1: Successful fix
	// -------------------------------------------------------------------------

	describe("successful fix", () => {
		test("clones with token-authenticated URL", async () => {
			const applier = createPatchApplier(deps);
			await applier.applyAndPush({
				...BASE_PARAMS,
				agentOutput: makeAgentOutput(),
			});

			const cloneCmd = deps.executedCommands.find((c) =>
				c.cmd.startsWith("git clone"),
			);
			expect(cloneCmd).toBeDefined();
			expect(cloneCmd!.cmd).toContain(
				"https://x-access-token:ghs_test_token_abc@github.com/owner/repo.git",
			);
		});

		test("checks out the correct branch", async () => {
			const applier = createPatchApplier(deps);
			await applier.applyAndPush({
				...BASE_PARAMS,
				agentOutput: makeAgentOutput(),
			});

			const checkoutCmd = deps.executedCommands.find((c) =>
				c.cmd.includes("git checkout"),
			);
			expect(checkoutCmd).toBeDefined();
			expect(checkoutCmd!.cmd).toContain("feature/my-branch");
		});

		test("writes modified files from agent output into the cloned repo", async () => {
			const applier = createPatchApplier(deps);
			await applier.applyAndPush({
				...BASE_PARAMS,
				agentOutput: makeAgentOutput({
					results: [
						{
							commentId: 101,
							fixed: true,
							description: "Renamed variable",
							filesModified: ["src/index.ts"],
						},
					],
					summary: "Fixed 1 comment",
				}),
			});

			const written = deps.writtenFiles.find((f) =>
				f.path.includes("src/index.ts"),
			);
			expect(written).toBeDefined();
			// File path should be within the cloned repo temp directory
			expect(written!.path).toContain(TEMP_DIR);
		});

		test("commits with a descriptive message", async () => {
			const applier = createPatchApplier(deps);
			await applier.applyAndPush({
				...BASE_PARAMS,
				agentOutput: makeAgentOutput(),
			});

			const commitCmd = deps.executedCommands.find((c) =>
				c.cmd.includes("git commit"),
			);
			expect(commitCmd).toBeDefined();
			expect(commitCmd!.cmd).toContain("-m");
		});

		test("pushes to the correct branch", async () => {
			const applier = createPatchApplier(deps);
			await applier.applyAndPush({
				...BASE_PARAMS,
				branch: "feature/my-branch",
				agentOutput: makeAgentOutput(),
			});

			const pushCmd = deps.executedCommands.find((c) =>
				c.cmd.includes("git push"),
			);
			expect(pushCmd).toBeDefined();
			expect(pushCmd!.cmd).toContain("feature/my-branch");
		});

		test("returns commit SHA from git rev-parse HEAD", async () => {
			const commitSha = "deadbeef1234567890abcdef";
			deps.setExecResponse("git rev-parse HEAD", commitSha);

			const applier = createPatchApplier(deps);
			const result = await applier.applyAndPush({
				...BASE_PARAMS,
				agentOutput: makeAgentOutput(),
			});

			expect(result.commitSha).toBe(commitSha);
		});

		test("formats reply for each fixed comment with commit SHA", async () => {
			const commitSha = "abc1234";
			deps.setExecResponse("git rev-parse HEAD", commitSha);

			const applier = createPatchApplier(deps);
			const result = await applier.applyAndPush({
				...BASE_PARAMS,
				agentOutput: makeAgentOutput({
					results: [
						{
							commentId: 101,
							fixed: true,
							description: "Renamed variable",
							filesModified: ["src/index.ts"],
						},
					],
					summary: "Fixed 1 comment",
				}),
			});

			expect(result.replies).toHaveLength(1);
			expect(result.replies[0].commentId).toBe(101);
			expect(result.replies[0].body).toContain(commitSha);
		});
	});

	// -------------------------------------------------------------------------
	// Scenario 2: Partial fixes
	// -------------------------------------------------------------------------

	describe("partial fixes", () => {
		const partialOutput: AgentOutput = {
			results: [
				{
					commentId: 201,
					fixed: true,
					description: "Fixed the null check",
					filesModified: ["src/util.ts"],
				},
				{
					commentId: 202,
					fixed: false,
					description: "Could not determine correct type without more context",
					filesModified: [],
				},
			],
			summary: "Fixed 1 of 2 comments",
		};

		test("still commits and pushes the fixed files", async () => {
			const applier = createPatchApplier(deps);
			await applier.applyAndPush({
				...BASE_PARAMS,
				agentOutput: partialOutput,
			});

			const commitCmd = deps.executedCommands.find((c) =>
				c.cmd.includes("git commit"),
			);
			const pushCmd = deps.executedCommands.find((c) =>
				c.cmd.includes("git push"),
			);
			expect(commitCmd).toBeDefined();
			expect(pushCmd).toBeDefined();
		});

		test("reply for fixed comment includes commit SHA", async () => {
			const commitSha = "fixedsha123";
			deps.setExecResponse("git rev-parse HEAD", commitSha);

			const applier = createPatchApplier(deps);
			const result = await applier.applyAndPush({
				...BASE_PARAMS,
				agentOutput: partialOutput,
			});

			const fixedReply = result.replies.find(
				(r: CommentReply) => r.commentId === 201,
			);
			expect(fixedReply).toBeDefined();
			expect(fixedReply!.body).toContain(commitSha);
		});

		test("reply for unfixed comment includes agent explanation", async () => {
			const applier = createPatchApplier(deps);
			const result = await applier.applyAndPush({
				...BASE_PARAMS,
				agentOutput: partialOutput,
			});

			const unfixedReply = result.replies.find(
				(r: CommentReply) => r.commentId === 202,
			);
			expect(unfixedReply).toBeDefined();
			expect(unfixedReply!.body).toContain(
				"Could not determine correct type without more context",
			);
		});

		test("returns a reply for every comment", async () => {
			const applier = createPatchApplier(deps);
			const result = await applier.applyAndPush({
				...BASE_PARAMS,
				agentOutput: partialOutput,
			});

			expect(result.replies).toHaveLength(2);
		});
	});

	// -------------------------------------------------------------------------
	// Scenario 3: No fixes
	// -------------------------------------------------------------------------

	describe("no fixes", () => {
		const noFixOutput: AgentOutput = {
			results: [
				{
					commentId: 301,
					fixed: false,
					description: "This requires a design decision outside my scope",
					filesModified: [],
				},
				{
					commentId: 302,
					fixed: false,
					description: "The code is correct as-is per the spec",
					filesModified: [],
				},
			],
			summary: "Could not fix any comments",
		};

		test("does NOT commit when no files were fixed", async () => {
			const applier = createPatchApplier(deps);
			await applier.applyAndPush({
				...BASE_PARAMS,
				agentOutput: noFixOutput,
			});

			const commitCmd = deps.executedCommands.find((c) =>
				c.cmd.includes("git commit"),
			);
			expect(commitCmd).toBeUndefined();
		});

		test("does NOT push when no files were fixed", async () => {
			const applier = createPatchApplier(deps);
			await applier.applyAndPush({
				...BASE_PARAMS,
				agentOutput: noFixOutput,
			});

			const pushCmd = deps.executedCommands.find((c) =>
				c.cmd.includes("git push"),
			);
			expect(pushCmd).toBeUndefined();
		});

		test("returns replies explaining why each comment could not be fixed", async () => {
			const applier = createPatchApplier(deps);
			const result = await applier.applyAndPush({
				...BASE_PARAMS,
				agentOutput: noFixOutput,
			});

			expect(result.replies).toHaveLength(2);

			const reply301 = result.replies.find(
				(r: CommentReply) => r.commentId === 301,
			);
			const reply302 = result.replies.find(
				(r: CommentReply) => r.commentId === 302,
			);

			expect(reply301!.body).toContain(
				"This requires a design decision outside my scope",
			);
			expect(reply302!.body).toContain(
				"The code is correct as-is per the spec",
			);
		});

		test("returns empty commitSha when nothing was committed", async () => {
			const applier = createPatchApplier(deps);
			const result = await applier.applyAndPush({
				...BASE_PARAMS,
				agentOutput: noFixOutput,
			});

			expect(result.commitSha).toBe("");
		});
	});

	// -------------------------------------------------------------------------
	// Scenario 4: Fork PR (push permission denied)
	// -------------------------------------------------------------------------

	describe("fork PR — push fails with permission denied", () => {
		const forkOutput: AgentOutput = {
			results: [
				{
					commentId: 401,
					fixed: true,
					description: "Fixed the import",
					filesModified: ["src/app.ts"],
				},
			],
			summary: "Fixed 1 comment",
		};

		test("attempts push even for fork PRs", async () => {
			// Push succeeds by default; verify the push was attempted
			const applier = createPatchApplier(deps);
			await applier.applyAndPush({
				...BASE_PARAMS,
				isFork: true,
				agentOutput: forkOutput,
			});

			const pushCmd = deps.executedCommands.find((c) =>
				c.cmd.includes("git push"),
			);
			expect(pushCmd).toBeDefined();
		});

		test("catches push permission error and returns fork explanation in replies", async () => {
			const permissionError = new Error(
				"remote: Permission to contributor/repo.git denied to bot",
			);
			deps.setExecError("git push", permissionError);

			const applier = createPatchApplier(deps);
			const result = await applier.applyAndPush({
				...BASE_PARAMS,
				isFork: true,
				agentOutput: forkOutput,
			});

			expect(result.replies).toHaveLength(1);
			// Reply should mention the fork / push limitation
			const reply = result.replies[0];
			expect(reply.commentId).toBe(401);
			expect(reply.body.toLowerCase()).toMatch(/fork|permission|push/);
		});
	});

	// -------------------------------------------------------------------------
	// Scenario 5: Push fails — branch drift, rebase, retry
	// -------------------------------------------------------------------------

	describe("push fails with non-fast-forward — rebase and retry", () => {
		const fixOutput: AgentOutput = {
			results: [
				{
					commentId: 501,
					fixed: true,
					description: "Fixed the type error",
					filesModified: ["src/types.ts"],
				},
			],
			summary: "Fixed 1 comment",
		};

		test("attempts git pull --rebase after non-fast-forward push failure", async () => {
			let pushAttempts = 0;
			const originalExec = deps.exec;

			// Override exec to fail first push, succeed on retry
			const trackingExec = async (
				cmd: string,
				opts?: { cwd?: string },
			): Promise<string> => {
				if (cmd.includes("git push")) {
					pushAttempts++;
					if (pushAttempts === 1) {
						throw new Error(
							"! [rejected] feature/branch -> feature/branch (non-fast-forward)",
						);
					}
				}
				return originalExec(cmd, opts);
			};
			deps.exec = trackingExec;

			const applier = createPatchApplier(deps);
			await applier.applyAndPush({
				...BASE_PARAMS,
				agentOutput: fixOutput,
			});

			const rebaseCmd = deps.executedCommands.find((c) =>
				c.cmd.includes("git pull --rebase"),
			);
			expect(rebaseCmd).toBeDefined();
		});

		test("returns error replies when rebase fails due to conflicts", async () => {
			// Both push and rebase fail
			deps.setExecError(
				"git push",
				new Error(
					"! [rejected] feature/branch -> feature/branch (non-fast-forward)",
				),
			);
			deps.setExecError(
				"git pull --rebase",
				new Error("CONFLICT (content): Merge conflict in src/types.ts"),
			);

			const applier = createPatchApplier(deps);
			const result = await applier.applyAndPush({
				...BASE_PARAMS,
				agentOutput: fixOutput,
			});

			// Should return replies indicating the push/rebase failure
			expect(result.replies).toHaveLength(1);
			const reply = result.replies[0];
			expect(reply.commentId).toBe(501);
			expect(reply.body.toLowerCase()).toMatch(/conflict|rebase|push|fail/);
		});
	});

	// -------------------------------------------------------------------------
	// Scenario 6: Cleanup — always removes temp directory
	// -------------------------------------------------------------------------

	describe("cleanup", () => {
		test("removes the temp directory after successful apply and push", async () => {
			const applier = createPatchApplier(deps);
			await applier.applyAndPush({
				...BASE_PARAMS,
				agentOutput: makeAgentOutput(),
			});

			expect(deps.removedDirs).toContain(TEMP_DIR);
		});

		test("removes the temp directory even when exec throws during clone", async () => {
			deps.setExecError(
				"git clone",
				new Error("Network error: connection refused"),
			);

			const applier = createPatchApplier(deps);

			await expect(
				applier.applyAndPush({
					...BASE_PARAMS,
					agentOutput: makeAgentOutput(),
				}),
			).rejects.toThrow();

			expect(deps.removedDirs).toContain(TEMP_DIR);
		});

		test("removes the temp directory even when commit fails", async () => {
			deps.setExecError("git commit", new Error("nothing to commit"));

			const applier = createPatchApplier(deps);

			// commit failure should be tolerated (nothing changed) or re-thrown
			// Either way, cleanup must happen
			try {
				await applier.applyAndPush({
					...BASE_PARAMS,
					agentOutput: makeAgentOutput(),
				});
			} catch {
				// ignore — we only care that cleanup ran
			}

			expect(deps.removedDirs).toContain(TEMP_DIR);
		});
	});
});
