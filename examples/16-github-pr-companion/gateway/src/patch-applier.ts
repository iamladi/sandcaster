import { shellQuote } from "@sandcaster/core";
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
	return cloneUrl.replace("https://", `https://x-access-token:${token}@`);
}

function validateBranchName(branch: string): void {
	if (
		/[\s~^:?*[\]\\]/.test(branch) ||
		branch.includes("..") ||
		branch.startsWith("-")
	) {
		throw new Error(`Invalid branch name: ${branch}`);
	}
}

function toError(err: unknown): Error {
	return err instanceof Error ? err : new Error(String(err));
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
			validateBranchName(branch);
			const tempDir = await deps.mkTempDir();
			const repoDir = `${tempDir}/repo`;

			try {
				const authUrl = buildAuthenticatedUrl(cloneUrl, token.token);
				await deps.exec(
					`git clone ${shellQuote(authUrl)} ${shellQuote(repoDir)}`,
				);

				await deps.exec(`git checkout ${shellQuote(branch)}`, {
					cwd: repoDir,
				});

				await Promise.all([
					deps.exec(`git config user.email "bot@sandcaster.dev"`, {
						cwd: repoDir,
					}),
					deps.exec(`git config user.name "Sandcaster Bot"`, {
						cwd: repoDir,
					}),
				]);

				const fixedResults = agentOutput.results.filter((r) => r.fixed);

				let commitSha = "";
				let pushError: Error | null = null;

				if (fixedResults.length > 0) {
					for (const result of fixedResults) {
						for (const filePath of result.filesModified) {
							const destPath = `${repoDir}/${filePath}`;
							const content = await deps.readFile(destPath);
							await deps.writeFile(destPath, content);
						}
					}

					await deps.exec("git add -A", { cwd: repoDir });

					await deps.exec(`git commit -m "fix: apply review bot suggestions"`, {
						cwd: repoDir,
					});

					const rawSha = await deps.exec("git rev-parse HEAD", {
						cwd: repoDir,
					});
					commitSha = rawSha.trim();

					try {
						await deps.exec(`git push origin ${shellQuote(branch)}`, {
							cwd: repoDir,
						});
					} catch (firstPushErr) {
						if (isNonFastForwardError(firstPushErr)) {
							try {
								await deps.exec("git pull --rebase", { cwd: repoDir });
								await deps.exec(`git push origin ${shellQuote(branch)}`, {
									cwd: repoDir,
								});
								const newSha = await deps.exec("git rev-parse HEAD", {
									cwd: repoDir,
								});
								commitSha = newSha.trim();
							} catch (rebaseOrRetryErr) {
								pushError = toError(rebaseOrRetryErr);
							}
						} else if (isPermissionError(firstPushErr)) {
							pushError = toError(firstPushErr);
						} else {
							throw firstPushErr;
						}
					}
				}

				const replies: CommentReply[] = agentOutput.results.map((result) => {
					if (!result.fixed) {
						return {
							commentId: result.commentId,
							body: result.description,
						};
					}

					if (pushError !== null) {
						if (isPermissionError(pushError) || isFork) {
							return {
								commentId: result.commentId,
								body: `Could not push the fix: this PR is from a fork and the bot does not have push permission to the fork branch. Please apply the suggested changes manually.`,
							};
						}
						return {
							commentId: result.commentId,
							body: `Could not push the fix: a rebase conflict occurred while syncing with the remote branch. Please resolve the conflict manually and push. Error: ${pushError.message}`,
						};
					}

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
