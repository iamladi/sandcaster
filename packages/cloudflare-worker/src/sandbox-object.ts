// ---------------------------------------------------------------------------
// SandboxObject — Durable Object stub for sandbox lifecycle management
//
// In production this would use @cloudflare/sandbox SDK methods with proper
// Durable Object state storage. For now this is a stub that returns mock
// responses with the correct structure so it can be replaced later.
// ---------------------------------------------------------------------------

export interface SandboxState {
	token: string;
	files: Map<string, string>;
}

// In-memory store keyed by sessionId (stub replacement for DO storage)
const sessions = new Map<string, SandboxState>();

export function createSession(sessionId: string, token: string): void {
	sessions.set(sessionId, { token, files: new Map() });
}

export function getSession(sessionId: string): SandboxState | undefined {
	return sessions.get(sessionId);
}

export function deleteSession(sessionId: string): void {
	sessions.delete(sessionId);
}

export function validateToken(sessionId: string, token: string): boolean {
	const session = sessions.get(sessionId);
	return session?.token === token;
}

export function writeFile(
	sessionId: string,
	path: string,
	content: string,
): void {
	const session = sessions.get(sessionId);
	if (session) {
		session.files.set(path, content);
	}
}

export function readFile(sessionId: string, path: string): string | undefined {
	const session = sessions.get(sessionId);
	return session?.files.get(path);
}

// ---------------------------------------------------------------------------
// execCommand — stub implementation
// In production: call @cloudflare/sandbox SDK exec method via Durable Object
// ---------------------------------------------------------------------------

export interface ExecResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

export async function execCommand(
	_sessionId: string,
	cmd: string,
	_timeoutMs?: number,
): Promise<ExecResult> {
	// Stub: echo the command back as stdout
	// Real implementation would use @cloudflare/sandbox SDK:
	//   const sandbox = await env.SANDBOX.get(env.SANDBOX.idFromName(sessionId));
	//   return sandbox.exec(cmd, { timeoutMs });
	return {
		stdout: `[stub] executed: ${cmd}\n`,
		stderr: "",
		exitCode: 0,
	};
}
