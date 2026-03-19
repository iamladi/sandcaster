import { getSandbox, proxyToSandbox, type Sandbox } from "@cloudflare/sandbox";
import { Hono } from "hono";

// Re-export Sandbox DO class for wrangler
export { Sandbox } from "@cloudflare/sandbox";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Bindings = {
	API_KEY: string;
	Sandbox: DurableObjectNamespace<Sandbox>;
};

const app = new Hono<{ Bindings: Bindings }>();

// ---------------------------------------------------------------------------
// Auth helper — all requests use the API_KEY as Bearer token
// ---------------------------------------------------------------------------

function checkAuth(c: {
	req: { header: (n: string) => string | undefined };
	env: Bindings;
}): boolean {
	const authHeader = c.req.header("Authorization");
	const token =
		c.req.header("X-API-Key") ??
		(authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined);
	return !!(c.env.API_KEY && token && token === c.env.API_KEY);
}

// ---------------------------------------------------------------------------
// POST /sandbox/create
// ---------------------------------------------------------------------------

app.post("/sandbox/create", async (c) => {
	if (!checkAuth(c)) {
		return c.json({ error: "Unauthorized: missing or invalid API key" }, 401);
	}

	const sessionId = crypto.randomUUID();

	// Touch the sandbox to ensure the container starts
	const sandbox = getSandbox(c.env.Sandbox, sessionId, {
		sleepAfter: "5m",
	});
	try {
		await sandbox.exec("true");
	} catch {
		// Container may need a moment — ignore startup errors
	}

	// Return API_KEY as the session token — Workers are stateless so we can't
	// store ephemeral tokens in memory. The provider uses this token for all
	// subsequent requests.
	return c.json({ sessionId, token: c.env.API_KEY });
});

// ---------------------------------------------------------------------------
// POST /sandbox/:id/files/write
// ---------------------------------------------------------------------------

app.post("/sandbox/:id/files/write", async (c) => {
	if (!checkAuth(c)) {
		return c.json({ error: "Unauthorized" }, 401);
	}

	const sessionId = c.req.param("id") ?? "";
	const { path, content, encoding } = await c.req.json<{
		path: string;
		content: string;
		encoding?: string;
	}>();

	if (!path || content === undefined) {
		return c.json({ error: "Missing required fields: path, content" }, 400);
	}

	const sandbox = getSandbox(c.env.Sandbox, sessionId);
	const writeOpts =
		encoding === "base64" ? { encoding: "base64" as const } : undefined;
	await sandbox.writeFile(path, content, writeOpts);

	return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GET /sandbox/:id/files/read?path=<path>
// ---------------------------------------------------------------------------

app.get("/sandbox/:id/files/read", async (c) => {
	if (!checkAuth(c)) {
		return c.json({ error: "Unauthorized" }, 401);
	}

	const sessionId = c.req.param("id") ?? "";
	const path = c.req.query("path") ?? "";
	if (!path) {
		return c.json({ error: "Missing required query parameter: path" }, 400);
	}
	const sandbox = getSandbox(c.env.Sandbox, sessionId);
	const file = await sandbox.readFile(path);

	return c.json({ content: file.content });
});

// ---------------------------------------------------------------------------
// POST /sandbox/:id/exec
// ---------------------------------------------------------------------------

app.post("/sandbox/:id/exec", async (c) => {
	if (!checkAuth(c)) {
		return c.json({ error: "Unauthorized" }, 401);
	}

	const sessionId = c.req.param("id") ?? "";
	const { cmd, timeoutMs } = await c.req.json<{
		cmd: string;
		timeoutMs?: number;
	}>();

	if (!cmd) {
		return c.json({ error: "Missing required field: cmd" }, 400);
	}

	const sandbox = getSandbox(c.env.Sandbox, sessionId);
	const result = await sandbox.exec(cmd, {
		timeout: timeoutMs,
	});

	return c.json({
		stdout: result.stdout,
		stderr: result.stderr,
		exitCode: result.exitCode,
	});
});

// ---------------------------------------------------------------------------
// POST /sandbox/:id/kill
// ---------------------------------------------------------------------------

app.post("/sandbox/:id/kill", async (c) => {
	if (!checkAuth(c)) {
		return c.json({ error: "Unauthorized" }, 401);
	}

	const sessionId = c.req.param("id") ?? "";
	const sandbox = getSandbox(c.env.Sandbox, sessionId);
	await sandbox.destroy();

	return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Worker default export
// ---------------------------------------------------------------------------

export default {
	async fetch(
		request: Request,
		env: Bindings,
		ctx: ExecutionContext,
	): Promise<Response> {
		// Handle internal sandbox SDK routing first
		const proxyResponse = await proxyToSandbox(request, env);
		if (proxyResponse) return proxyResponse;

		return app.fetch(request, env, ctx);
	},
};
