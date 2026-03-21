import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from "vitest";
import { createGitHubClient } from "../github-client.js";
import type { CommentReply, ResolvedToken, ReviewComment } from "../types.js";

// ---------------------------------------------------------------------------
// MSW server
// ---------------------------------------------------------------------------

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RESOLVED_TOKEN: ResolvedToken = {
	token: "ghs_test_token",
	authHeader: "x-access-token",
};

function makeClient(token: ResolvedToken = RESOLVED_TOKEN) {
	return createGitHubClient({ getToken: () => Promise.resolve(token) });
}

function makeReviewComment(overrides?: Partial<ReviewComment>): ReviewComment {
	return {
		id: 1,
		path: "src/index.ts",
		line: 42,
		body: "This needs to be fixed",
		diff_hunk: "@@ -1,3 +1,4 @@",
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// fetchReviewComments
// ---------------------------------------------------------------------------

describe("fetchReviewComments", () => {
	test("fetches from the correct endpoint", async () => {
		let capturedUrl: string | undefined;

		server.use(
			http.get(
				"https://api.github.com/repos/acme/myrepo/pulls/7/reviews/999/comments",
				({ request }) => {
					capturedUrl = request.url;
					return HttpResponse.json([makeReviewComment()]);
				},
			),
		);

		const client = makeClient();
		await client.fetchReviewComments("acme", "myrepo", 7, 999);

		expect(capturedUrl).toBeDefined();
		expect(new URL(capturedUrl!).pathname).toBe(
			"/repos/acme/myrepo/pulls/7/reviews/999/comments",
		);
	});

	test("passes per_page=100 query parameter", async () => {
		let capturedUrl: string | undefined;

		server.use(
			http.get(
				"https://api.github.com/repos/acme/myrepo/pulls/7/reviews/999/comments",
				({ request }) => {
					capturedUrl = request.url;
					return HttpResponse.json([]);
				},
			),
		);

		const client = makeClient();
		await client.fetchReviewComments("acme", "myrepo", 7, 999);

		const params = new URL(capturedUrl!).searchParams;
		expect(params.get("per_page")).toBe("100");
	});

	test("returns parsed ReviewComment array with correct fields", async () => {
		const raw = [
			{
				id: 10,
				path: "README.md",
				line: 5,
				body: "Fix this",
				diff_hunk: "@@ -0,0 +1 @@",
				// extra field that should be ignored
				url: "https://api.github.com/repos/acme/myrepo/pulls/comments/10",
			},
			{
				id: 11,
				path: "src/app.ts",
				line: null,
				body: "No line",
				diff_hunk: "@@ -1,1 +1,1 @@",
			},
		];

		server.use(
			http.get(
				"https://api.github.com/repos/acme/myrepo/pulls/7/reviews/999/comments",
				() => HttpResponse.json(raw),
			),
		);

		const client = makeClient();
		const comments = await client.fetchReviewComments("acme", "myrepo", 7, 999);

		expect(comments).toHaveLength(2);
		expect(comments[0]).toMatchObject<ReviewComment>({
			id: 10,
			path: "README.md",
			line: 5,
			body: "Fix this",
			diff_hunk: "@@ -0,0 +1 @@",
		});
		expect(comments[1]).toMatchObject<ReviewComment>({
			id: 11,
			path: "src/app.ts",
			line: null,
			body: "No line",
			diff_hunk: "@@ -1,1 +1,1 @@",
		});
	});

	test("returns empty array when no comments", async () => {
		server.use(
			http.get(
				"https://api.github.com/repos/acme/myrepo/pulls/7/reviews/999/comments",
				() => HttpResponse.json([]),
			),
		);

		const client = makeClient();
		const comments = await client.fetchReviewComments("acme", "myrepo", 7, 999);

		expect(comments).toEqual([]);
	});

	test("follows Link header pagination to collect all comments", async () => {
		const page1 = [makeReviewComment({ id: 1 }), makeReviewComment({ id: 2 })];
		const page2 = [makeReviewComment({ id: 3 })];

		server.use(
			http.get(
				"https://api.github.com/repos/acme/myrepo/pulls/7/reviews/999/comments",
				({ request }) => {
					const page = new URL(request.url).searchParams.get("page");
					if (page === "2") {
						return HttpResponse.json(page2);
					}
					return HttpResponse.json(page1, {
						headers: {
							Link: '<https://api.github.com/repos/acme/myrepo/pulls/7/reviews/999/comments?page=2>; rel="next"',
						},
					});
				},
			),
		);

		const client = makeClient();
		const comments = await client.fetchReviewComments("acme", "myrepo", 7, 999);

		expect(comments).toHaveLength(3);
		expect(comments.map((c) => c.id)).toEqual([1, 2, 3]);
	});

	test("sets Authorization header from token provider", async () => {
		let capturedAuth: string | null = null;

		server.use(
			http.get(
				"https://api.github.com/repos/acme/myrepo/pulls/7/reviews/999/comments",
				({ request }) => {
					capturedAuth = request.headers.get("Authorization");
					return HttpResponse.json([]);
				},
			),
		);

		const client = makeClient({
			token: "ghs_abc123",
			authHeader: "x-access-token",
		});
		await client.fetchReviewComments("acme", "myrepo", 7, 999);

		expect(capturedAuth).toBe("x-access-token ghs_abc123");
	});
});

// ---------------------------------------------------------------------------
// postReplies
// ---------------------------------------------------------------------------

describe("postReplies", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	test("posts to the correct endpoint for each reply", async () => {
		const capturedUrls: string[] = [];

		server.use(
			http.post(
				"https://api.github.com/repos/acme/myrepo/pulls/7/comments/:commentId/replies",
				({ request, params }) => {
					capturedUrls.push(request.url);
					return HttpResponse.json(
						{ id: Number(params.commentId) },
						{ status: 201 },
					);
				},
			),
		);

		const client = makeClient();
		const replies: CommentReply[] = [
			{ commentId: 42, body: "Fixed in latest commit" },
		];

		const promise = client.postReplies("acme", "myrepo", 7, replies);
		await vi.runAllTimersAsync();
		await promise;

		expect(capturedUrls).toHaveLength(1);
		expect(new URL(capturedUrls[0]).pathname).toBe(
			"/repos/acme/myrepo/pulls/7/comments/42/replies",
		);
	});

	test("sends body in correct format { body: string }", async () => {
		let capturedBody: unknown;

		server.use(
			http.post(
				"https://api.github.com/repos/acme/myrepo/pulls/7/comments/:commentId/replies",
				async ({ request }) => {
					capturedBody = await request.json();
					return HttpResponse.json({}, { status: 201 });
				},
			),
		);

		const client = makeClient();
		const replies: CommentReply[] = [
			{ commentId: 55, body: "Addressed this concern" },
		];

		const promise = client.postReplies("acme", "myrepo", 7, replies);
		await vi.runAllTimersAsync();
		await promise;

		expect(capturedBody).toEqual({ body: "Addressed this concern" });
	});

	test("respects 1s delay between replies", async () => {
		const timestamps: number[] = [];

		server.use(
			http.post(
				"https://api.github.com/repos/acme/myrepo/pulls/7/comments/:commentId/replies",
				() => {
					timestamps.push(Date.now());
					return HttpResponse.json({}, { status: 201 });
				},
			),
		);

		const client = makeClient();
		const replies: CommentReply[] = [
			{ commentId: 1, body: "First reply" },
			{ commentId: 2, body: "Second reply" },
			{ commentId: 3, body: "Third reply" },
		];

		const promise = client.postReplies("acme", "myrepo", 7, replies);
		await vi.runAllTimersAsync();
		await promise;

		expect(timestamps).toHaveLength(3);
		// Each subsequent post should be at least 1000ms after the previous
		expect(timestamps[1] - timestamps[0]).toBeGreaterThanOrEqual(1000);
		expect(timestamps[2] - timestamps[1]).toBeGreaterThanOrEqual(1000);
	});

	test("handles empty replies array without making any requests", async () => {
		const handler = vi.fn(() => HttpResponse.json({}, { status: 201 }));

		server.use(
			http.post(
				"https://api.github.com/repos/acme/myrepo/pulls/7/comments/:commentId/replies",
				handler,
			),
		);

		const client = makeClient();
		const promise = client.postReplies("acme", "myrepo", 7, []);
		await vi.runAllTimersAsync();
		await promise;

		expect(handler).not.toHaveBeenCalled();
	});

	test("sets Authorization header from token provider", async () => {
		let capturedAuth: string | null = null;

		server.use(
			http.post(
				"https://api.github.com/repos/acme/myrepo/pulls/7/comments/:commentId/replies",
				({ request }) => {
					capturedAuth = request.headers.get("Authorization");
					return HttpResponse.json({}, { status: 201 });
				},
			),
		);

		const client = makeClient({
			token: "ghs_xyz789",
			authHeader: "x-access-token",
		});
		const promise = client.postReplies("acme", "myrepo", 7, [
			{ commentId: 1, body: "done" },
		]);
		await vi.runAllTimersAsync();
		await promise;

		expect(capturedAuth).toBe("x-access-token ghs_xyz789");
	});
});

// ---------------------------------------------------------------------------
// fetchPrDetails
// ---------------------------------------------------------------------------

describe("fetchPrDetails", () => {
	test("fetches from the correct endpoint", async () => {
		let capturedUrl: string | undefined;

		server.use(
			http.get(
				"https://api.github.com/repos/acme/myrepo/pulls/12",
				({ request }) => {
					capturedUrl = request.url;
					return HttpResponse.json({
						head: {
							ref: "feature-branch",
							sha: "abc123def456",
							repo: {
								full_name: "acme/myrepo",
								clone_url: "https://github.com/acme/myrepo.git",
							},
						},
						base: {
							repo: {
								full_name: "acme/myrepo",
								clone_url: "https://github.com/acme/myrepo.git",
							},
						},
					});
				},
			),
		);

		const client = makeClient();
		await client.fetchPrDetails("acme", "myrepo", 12);

		expect(new URL(capturedUrl!).pathname).toBe("/repos/acme/myrepo/pulls/12");
	});

	test("detects same-repo PR and returns base clone URL", async () => {
		server.use(
			http.get("https://api.github.com/repos/acme/myrepo/pulls/12", () =>
				HttpResponse.json({
					head: {
						ref: "feature-branch",
						sha: "abc123def456",
						repo: {
							full_name: "acme/myrepo",
							clone_url: "https://github.com/acme/myrepo.git",
						},
					},
					base: {
						repo: {
							full_name: "acme/myrepo",
							clone_url: "https://github.com/acme/myrepo.git",
						},
					},
				}),
			),
		);

		const client = makeClient();
		const details = await client.fetchPrDetails("acme", "myrepo", 12);

		expect(details.isFork).toBe(false);
		expect(details.cloneUrl).toBe("https://github.com/acme/myrepo.git");
	});

	test("detects fork PR and returns head repo clone URL", async () => {
		server.use(
			http.get("https://api.github.com/repos/acme/myrepo/pulls/12", () =>
				HttpResponse.json({
					head: {
						ref: "fix-bug",
						sha: "deadbeef1234",
						repo: {
							full_name: "contributor/myrepo",
							clone_url: "https://github.com/contributor/myrepo.git",
						},
					},
					base: {
						repo: {
							full_name: "acme/myrepo",
							clone_url: "https://github.com/acme/myrepo.git",
						},
					},
				}),
			),
		);

		const client = makeClient();
		const details = await client.fetchPrDetails("acme", "myrepo", 12);

		expect(details.isFork).toBe(true);
		expect(details.cloneUrl).toBe("https://github.com/contributor/myrepo.git");
	});

	test("extracts branch name and head SHA", async () => {
		server.use(
			http.get("https://api.github.com/repos/acme/myrepo/pulls/12", () =>
				HttpResponse.json({
					head: {
						ref: "my-feature-branch",
						sha: "0a1b2c3d4e5f",
						repo: {
							full_name: "acme/myrepo",
							clone_url: "https://github.com/acme/myrepo.git",
						},
					},
					base: {
						repo: {
							full_name: "acme/myrepo",
							clone_url: "https://github.com/acme/myrepo.git",
						},
					},
				}),
			),
		);

		const client = makeClient();
		const details = await client.fetchPrDetails("acme", "myrepo", 12);

		expect(details.branch).toBe("my-feature-branch");
		expect(details.headSha).toBe("0a1b2c3d4e5f");
	});

	test("sets Authorization header from token provider", async () => {
		let capturedAuth: string | null = null;

		server.use(
			http.get(
				"https://api.github.com/repos/acme/myrepo/pulls/12",
				({ request }) => {
					capturedAuth = request.headers.get("Authorization");
					return HttpResponse.json({
						head: {
							ref: "main",
							sha: "aaabbbccc",
							repo: {
								full_name: "acme/myrepo",
								clone_url: "https://github.com/acme/myrepo.git",
							},
						},
						base: {
							repo: {
								full_name: "acme/myrepo",
								clone_url: "https://github.com/acme/myrepo.git",
							},
						},
					});
				},
			),
		);

		const client = makeClient({
			token: "pat_secrettoken",
			authHeader: "pat_secrettoken",
		});
		await client.fetchPrDetails("acme", "myrepo", 12);

		expect(capturedAuth).toBe("pat_secrettoken pat_secrettoken");
	});
});
