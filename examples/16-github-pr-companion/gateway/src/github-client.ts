import type { CommentReply, GitHubClientDeps, ReviewComment } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseNextLink(linkHeader: string | null): string | null {
	if (!linkHeader) return null;
	const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
	return match?.[1] ?? null;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

export function createGitHubClient(config: GitHubClientDeps) {
	async function authHeader(): Promise<string> {
		const resolved = await config.getToken();
		return `${resolved.authHeader} ${resolved.token}`;
	}

	async function fetchReviewComments(
		owner: string,
		repo: string,
		prNumber: number,
		reviewId: number,
	): Promise<ReviewComment[]> {
		const auth = await authHeader();
		const baseUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/reviews/${reviewId}/comments?per_page=100`;

		const results: ReviewComment[] = [];
		let url: string | null = baseUrl;

		while (url !== null) {
			const response = await fetch(url, {
				headers: {
					Authorization: auth,
					Accept: "application/vnd.github+json",
				},
			});

			const data = (await response.json()) as Array<{
				id: number;
				path: string;
				line: number | null;
				body: string;
				diff_hunk: string;
				[key: string]: unknown;
			}>;

			for (const item of data) {
				results.push({
					id: item.id,
					path: item.path,
					line: item.line,
					body: item.body,
					diff_hunk: item.diff_hunk,
				});
			}

			url = parseNextLink(response.headers.get("Link"));
		}

		return results;
	}

	async function postReplies(
		owner: string,
		repo: string,
		prNumber: number,
		replies: CommentReply[],
	): Promise<void> {
		if (replies.length === 0) return;

		const auth = await authHeader();

		for (let i = 0; i < replies.length; i++) {
			if (i > 0) {
				await delay(1000);
			}

			const reply = replies[i];
			await fetch(
				`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/comments/${reply.commentId}/replies`,
				{
					method: "POST",
					headers: {
						Authorization: auth,
						Accept: "application/vnd.github+json",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ body: reply.body }),
				},
			);
		}
	}

	async function fetchPrDetails(
		owner: string,
		repo: string,
		prNumber: number,
	): Promise<{
		cloneUrl: string;
		isFork: boolean;
		branch: string;
		headSha: string;
	}> {
		const auth = await authHeader();

		const response = await fetch(
			`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`,
			{
				headers: {
					Authorization: auth,
					Accept: "application/vnd.github+json",
				},
			},
		);

		const data = (await response.json()) as {
			head: {
				ref: string;
				sha: string;
				repo: {
					full_name: string;
					clone_url: string;
				};
			};
			base: {
				repo: {
					full_name: string;
					clone_url: string;
				};
			};
		};

		const isFork = data.head.repo.full_name !== data.base.repo.full_name;
		const cloneUrl = isFork
			? data.head.repo.clone_url
			: data.base.repo.clone_url;

		return {
			cloneUrl,
			isFork,
			branch: data.head.ref,
			headSha: data.head.sha,
		};
	}

	return { fetchReviewComments, postReplies, fetchPrDetails };
}
