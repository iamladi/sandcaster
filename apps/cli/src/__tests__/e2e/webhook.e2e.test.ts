import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "./helpers/cli-runner.js";
import { getFreePort } from "./helpers/port.js";

// Track servers for cleanup
const servers: Server[] = [];

afterEach(() => {
	for (const s of servers) {
		s.close();
	}
	servers.length = 0;
});

interface CapturedRequest {
	method: string;
	headers: Record<string, string>;
	body: string;
}

/**
 * Start a minimal HTTP server that collects received requests.
 * Returns a promise that resolves once the server is listening.
 */
function startTestServer(port: number): Promise<{
	server: Server;
	requests: CapturedRequest[];
}> {
	const requests: CapturedRequest[] = [];

	return new Promise((resolve) => {
		const server = createServer((req, res) => {
			const chunks: Buffer[] = [];
			req.on("data", (chunk: Buffer) => chunks.push(chunk));
			req.on("end", () => {
				requests.push({
					method: req.method ?? "GET",
					headers: req.headers as Record<string, string>,
					body: Buffer.concat(chunks).toString("utf-8"),
				});
				res.writeHead(200, { "Content-Type": "text/plain" });
				res.end("ok");
			});
		});

		server.listen(port, "127.0.0.1", () => {
			servers.push(server);
			resolve({ server, requests });
		});
	});
}

describe("webhook command", () => {
	it("webhook test <local-server-url> succeeds, server receives POST with lifecycle event", async () => {
		const port = await getFreePort();
		const { requests } = await startTestServer(port);

		const result = await runCli([
			"webhook",
			"test",
			`http://127.0.0.1:${port}`,
		]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("successfully");
		expect(requests.length).toBeGreaterThanOrEqual(1);

		const req = requests[0];
		const body = JSON.parse(req.body);
		expect(body).toHaveProperty("type", "sandbox.lifecycle.created");
	});

	it("webhook test <url> --secret mysecret includes e2b-signature header", async () => {
		const port = await getFreePort();
		const { requests } = await startTestServer(port);
		const secret = "mysecret";

		const result = await runCli([
			"webhook",
			"test",
			`http://127.0.0.1:${port}`,
			"--secret",
			secret,
		]);

		expect(result.exitCode).toBe(0);
		expect(requests.length).toBeGreaterThanOrEqual(1);

		const req = requests[0];
		expect(req.headers["e2b-signature"]).toBeDefined();

		// Verify HMAC
		const expectedSig = `sha256=${createHmac("sha256", secret).update(req.body).digest("hex")}`;
		expect(req.headers["e2b-signature"]).toBe(expectedSig);
	});

	it("webhook test <unreachable-url> exits 1", async () => {
		const result = await runCli(["webhook", "test", "http://127.0.0.1:1"]);
		expect(result.exitCode).toBe(1);
		const output = result.stdout + result.stderr;
		expect(output.toLowerCase()).toContain("error");
	});

	it("webhook register <url> without E2B_API_KEY exits 1", async () => {
		const result = await runCli(["webhook", "register", "http://example.com"]);
		expect(result.exitCode).toBe(1);
		const output = result.stdout + result.stderr;
		expect(output).toContain("E2B_API_KEY");
	});

	it("webhook list without E2B_API_KEY exits 1", async () => {
		const result = await runCli(["webhook", "list"]);
		expect(result.exitCode).toBe(1);
		const output = result.stdout + result.stderr;
		expect(output).toContain("E2B_API_KEY");
	});

	it("webhook delete <id> without E2B_API_KEY exits 1", async () => {
		const result = await runCli(["webhook", "delete", "some-id"]);
		expect(result.exitCode).toBe(1);
		const output = result.stdout + result.stderr;
		expect(output).toContain("E2B_API_KEY");
	});

	it("webhook --help lists subcommands", async () => {
		const result = await runCli(["webhook", "--help"]);
		expect(result.exitCode).toBe(0);
		const output = result.stdout + result.stderr;
		for (const sub of ["register", "list", "delete", "test"]) {
			expect(output).toContain(sub);
		}
	});
});
