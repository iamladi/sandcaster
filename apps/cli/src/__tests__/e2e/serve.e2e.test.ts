import { afterEach, describe, expect, it } from "vitest";
import { runCli, spawnCli } from "./helpers/cli-runner.js";
import { getFreePort } from "./helpers/port.js";

// Track spawned processes for cleanup
const processes: Array<{ kill: () => void }> = [];

afterEach(() => {
	for (const p of processes) {
		p.kill();
	}
	processes.length = 0;
});

describe("serve command", () => {
	it("starts on custom port and stdout contains listening message", async () => {
		const port = await getFreePort();
		const proc = spawnCli(["serve", "--port", String(port)]);
		processes.push(proc);

		await proc.waitForOutput(/listening on/i);
		const output = proc.stdout();
		expect(output).toContain(String(port));
	});

	it("health endpoint returns { status: 'ok' }", async () => {
		const port = await getFreePort();
		const proc = spawnCli(["serve", "--port", String(port)]);
		processes.push(proc);

		await proc.waitForOutput(/listening on/i);

		const res = await fetch(`http://127.0.0.1:${port}/health`);
		expect(res.ok).toBe(true);
		const body = await res.json();
		expect(body).toMatchObject({ status: "ok" });
	});

	it("invalid port exits 1", async () => {
		const result = await runCli(["serve", "--port", "notanumber"]);
		expect(result.exitCode).toBe(1);
		const output = result.stdout + result.stderr;
		expect(output.toLowerCase()).toContain("invalid");
	});

	it("with SANDCASTER_API_KEY, POST /query without auth returns 401", async () => {
		const port = await getFreePort();
		const proc = spawnCli(["serve", "--port", String(port)], {
			env: { SANDCASTER_API_KEY: "test-secret" },
		});
		processes.push(proc);

		await proc.waitForOutput(/listening on/i);

		const res = await fetch(`http://127.0.0.1:${port}/query`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ prompt: "hello" }),
		});
		expect(res.status).toBe(401);
	});

	it("SIGTERM causes clean shutdown", async () => {
		const port = await getFreePort();
		const proc = spawnCli(["serve", "--port", String(port)]);
		processes.push(proc);

		await proc.waitForOutput(/listening on/i);

		proc.kill();

		// Wait for process to exit
		await new Promise<void>((resolve) => {
			proc.child.on("close", () => resolve());
			setTimeout(resolve, 3_000);
		});

		expect(proc.child.killed).toBe(true);
	});
});
