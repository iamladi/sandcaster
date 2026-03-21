// ---------------------------------------------------------------------------
// Patch applier — clones a branch, writes agent fixes, commits and pushes
// ---------------------------------------------------------------------------

import type { AgentOutput, CommentReply, ResolvedToken } from "./types.js";

export interface PatchApplierDeps {
	exec: (cmd: string, opts?: { cwd?: string }) => Promise<string>;
	writeFile: (path: string, content: string) => Promise<void>;
	readFile: (path: string) => Promise<string>;
	mkTempDir: () => Promise<string>;
	rmDir: (path: string) => Promise<void>;
}

export interface PatchResult {
	commitSha: string;
	replies: CommentReply[];
}

interface ApplyAndPushParams {
	cloneUrl: string;
	branch: string;
	token: ResolvedToken;
	agentOutput: AgentOutput;
	isFork: boolean;
}

function buildAuthenticatedUrl(cloneUrl: string, token: string): string {
	// https://github.com/owner/repo.git → https://x-access-token:TOKEN@github.com/owner/repo.git
	return cloneUrl.replace("https://", `https://x-access-token:${token}@`);
}

function isPermissionError(err: unknown): boolean {
	const msg = err instanceof Error ? err.message.toLowerCase() : "";
	return msg.includes("permission") || msg.includes("denied");
}

function isNonFastForwardError(err: unknown): boolean {
	const msg = err instanceof Error ? err.message.toLowerCase() : "";
	return msg.includes("non-fast-forward") || msg.includes("[rejected]");
}

export function createPatchApplier(deps: PatchApplierDeps) {
	return {
		async applyAndPush(params: ApplyAndPushParams): Promise<PatchResult> {
			const { cloneUrl, branch, token, agentOutput, isFork } = params;
			const tempDir = await deps.mkTempDir();
			const repoDir = `${tempDir}/repo`;

			try {
				// Step 1: Clone with token-authenticated URL
				const authUrl = buildAuthenticatedUrl(cloneUrl, token.token);
				await deps.exec(`git clone ${authUrl} ${repoDir}`);

				// Step 2: Checkout branch
				await deps.exec(`git checkout ${branch}`, { cwd: repoDir });

				// Step 3: Configure git user
				await deps.exec(`git config user.email "bot@sandcaster.dev"`, {
					cwd: repoDir,
				});
				await deps.exec(`git config user.name "Sandcaster Bot"`, {
					cwd: repoDir,
				});

				// Step 4: Check for fixed results
				const fixedResults = agentOutput.results.filter((r) => r.fixed);
				const hasFixedResults = fixedResults.length > 0;

				let commitSha = "";
				let pushError: Error | null = null;

				if (hasFixedResults) {
					// Step 5: Write modified files
					for (const result of fixedResults) {
						for (const filePath of result.filesModified) {
							const destPath = `${repoDir}/${filePath}`;
							const content = await deps.readFile(destPath);
							await deps.writeFile(destPath, content);
						}
					}

					// Step 6: Stage all changes
					await deps.exec("git add -A", { cwd: repoDir });

					// Step 7: Commit
					await deps.exec(`git commit -m "fix: apply review bot suggestions"`, {
						cwd: repoDir,
					});

					// Step 8: Get commit SHA
					const rawSha = await deps.exec("git rev-parse HEAD", {
						cwd: repoDir,
					});
					commitSha = rawSha.trim();

					// Step 9: Push with retry logic
					try {
						await deps.exec(`git push origin ${branch}`, { cwd: repoDir });
					} catch (firstPushErr) {
						if (isNonFastForwardError(firstPushErr)) {
							// Try rebase and retry push
							try {
								await deps.exec("git pull --rebase", { cwd: repoDir });
								await deps.exec(`git push origin ${branch}`, {
									cwd: repoDir,
								});
							} catch (rebaseOrRetryErr) {
								pushError =
									rebaseOrRetryErr instanceof Error
										? rebaseOrRetryErr
										: new Error(String(rebaseOrRetryErr));
							}
						} else if (isPermissionError(firstPushErr)) {
							pushError =
								firstPushErr instanceof Error
									? firstPushErr
									: new Error(String(firstPushErr));
						} else {
							// Unknown push error — rethrow
							throw firstPushErr;
						}
					}
				}

				// Step 10: Build replies
				const replies: CommentReply[] = agentOutput.results.map((result) => {
					if (!result.fixed) {
						return {
							commentId: result.commentId,
							body: result.description,
						};
					}

					// Fixed result — check push outcome
					if (pushError !== null) {
						const errMsg = pushError.message.toLowerCase();
						if (
							errMsg.includes("permission") ||
							errMsg.includes("denied") ||
							isFork
						) {
							return {
								commentId: result.commentId,
								body: `Could not push the fix: this PR is from a fork and the bot does not have push permission to the fork branch. Please apply the suggested changes manually.`,
							};
						}
						// Conflict / rebase failure
						return {
							commentId: result.commentId,
							body: `Could not push the fix: a rebase conflict occurred while syncing with the remote branch. Please resolve the conflict manually and push. Error: ${pushError.message}`,
						};
					}

					// Push succeeded
					return {
						commentId: result.commentId,
						body: `Fix applied in commit \`${commitSha}\`: ${result.description}`,
					};
				});

				return { commitSha, replies };
			} finally {
				await deps.rmDir(tempDir);
			}
		},
	};
}
