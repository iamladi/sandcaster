export interface ReviewComment {
	id: number;
	path: string;
	line: number | null;
	body: string;
	diff_hunk: string;
}

/** Parsed webhook payload after filtering */
export interface ReviewEvent {
	deliveryId: string;
	reviewId: number;
	prNumber: number;
	owner: string;
	repo: string;
	branch: string;
	headSha: string;
	/** Clone URL for the head repo (may differ from base for forks) */
	cloneUrl: string;
	/** True if the PR is from a fork */
	isFork: boolean;
	reviewerLogin: string;
}

/** Agent output for a single comment fix */
export interface CommentResult {
	commentId: number;
	fixed: boolean;
	description: string;
	filesModified: string[];
}

/** Full structured output from the agent */
export interface AgentOutput {
	results: CommentResult[];
	summary: string;
}

/** GitHub auth mode: PAT or GitHub App */
export type AuthMode =
	| { type: "pat"; token: string }
	| {
			type: "app";
			appId: string;
			privateKey: string;
			installationId: string;
	  };

/** Resolved token ready for API calls */
export interface ResolvedToken {
	token: string;
	/** Authorization header value, formatted as "token {value}" */
	authHeader: string;
}

/** Dependencies for the webhook handler */
export interface WebhookHandlerDeps {
	webhookSecret: string;
	botAllowlist: string[];
	ownBotLogin: string;
}

/** Dependencies for the GitHub client */
export interface GitHubClientDeps {
	getToken: () => Promise<ResolvedToken>;
}

/** Reply to post on a comment */
export interface CommentReply {
	commentId: number;
	body: string;
}

/** Dedup entry lifecycle */
export type DeliveryState = "processing" | "completed" | "failed";
