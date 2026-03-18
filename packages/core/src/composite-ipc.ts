// ---------------------------------------------------------------------------
// IPC message types for composite sandbox communication
// ---------------------------------------------------------------------------

export interface CompositeRequest {
	type: "composite_request";
	id: string;
	nonce: string;
	action: "spawn" | "exec" | "transfer" | "kill" | "list";
	// Action-specific payloads
	name?: string;
	provider?: string;
	template?: string;
	command?: string;
	timeout?: number;
	from?: string;
	to?: string;
	paths?: string[];
}

export interface CompositeResponse {
	type: "composite_response";
	id: string;
	ok: boolean;
	// Success payloads
	workDir?: string;
	result?: unknown;
	// Error payload
	error?: string;
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Parse a JSON line and return a CompositeRequest if it is one, else null.
 */
export function parseCompositeRequest(line: string): CompositeRequest | null {
	if (!line) return null;

	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return null;
	}

	if (
		typeof parsed !== "object" ||
		parsed === null ||
		(parsed as Record<string, unknown>).type !== "composite_request"
	) {
		return null;
	}

	return parsed as CompositeRequest;
}

/**
 * Serialize a CompositeResponse to a JSON string.
 */
export function serializeCompositeResponse(
	response: CompositeResponse,
): string {
	return JSON.stringify(response);
}

/**
 * Check whether the request nonce matches the expected session nonce.
 */
export function validateNonce(
	request: CompositeRequest,
	expectedNonce: string,
): boolean {
	return (
		typeof request.nonce === "string" &&
		request.nonce.length > 0 &&
		request.nonce === expectedNonce
	);
}

/**
 * Generate a random nonce using crypto.randomUUID.
 */
export function generateNonce(): string {
	return crypto.randomUUID();
}

/**
 * Returns the canonical IPC response file path for a given requestId.
 */
export function ipcResponsePath(requestId: string): string {
	return `/tmp/sandcaster-ipc-${requestId}.json`;
}

/**
 * Returns the temp path used during atomic write-rename for a given requestId.
 */
export function ipcTempPath(requestId: string): string {
	return `/tmp/sandcaster-ipc-${requestId}.json.tmp`;
}

/**
 * Regex pattern that matches stale IPC files in /tmp for cleanup.
 */
export const STALE_IPC_PATTERN = /\/tmp\/sandcaster-ipc-[^/]*\.json(?:\.tmp)?$/;
