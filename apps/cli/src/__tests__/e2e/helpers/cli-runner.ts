import { type ChildProcess, spawn } from "node:child_process";
import { resolve } from "node:path";

const CLI_ENTRY = resolve(import.meta.dirname, "../../../../dist/index.js");

// ANSI escape codes
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI escape stripping
const ANSI_RE = /\x1b\[[0-9;]*m/g;

export interface RunResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

export interface RunOptions {
	/** Extra env vars to merge (on top of sanitized base) */
	env?: Record<string, string>;
	/** Working directory */
	cwd?: string;
	/** Timeout in ms (default 10_000) */
	timeout?: number;
}

/**
 * Sanitized env — clears secrets so CLI tests don't accidentally hit real APIs.
 */
function sanitizedEnv(
	extra: Record<string, string> = {},
): Record<string, string> {
	const base = { ...process.env } as Record<string, string>;

	// Remove sensitive keys
	for (const key of [
		"E2B_API_KEY",
		"SANDCASTER_API_KEY",
		"ANTHROPIC_API_KEY",
		"OPENAI_API_KEY",
		"GOOGLE_API_KEY",
		"OPENROUTER_API_KEY",
	]) {
		delete base[key];
	}

	return { ...base, ...extra };
}

/**
 * Spawn the built CLI and capture output.
 */
export function runCli(
	args: string[],
	options: RunOptions = {},
): Promise<RunResult> {
	const timeout = options.timeout ?? 10_000;

	return new Promise((resolve, reject) => {
		const child: ChildProcess = spawn("bun", [CLI_ENTRY, ...args], {
			env: sanitizedEnv(options.env),
			cwd: options.cwd,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";
		let settled = false;

		child.stdout?.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});

		child.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		const timer = setTimeout(() => {
			if (!settled) {
				settled = true;
				child.kill("SIGKILL");
				reject(
					new Error(
						`CLI timed out after ${timeout}ms\nstdout: ${stdout}\nstderr: ${stderr}`,
					),
				);
			}
		}, timeout);

		child.on("close", (code) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve({
				stdout: stdout.replace(ANSI_RE, ""),
				stderr: stderr.replace(ANSI_RE, ""),
				exitCode: code ?? 1,
			});
		});

		child.on("error", (err) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reject(err);
		});
	});
}

/**
 * Spawn the CLI as a long-running process (e.g. serve).
 * Returns the child process + helpers for reading output and killing.
 */
export function spawnCli(
	args: string[],
	options: RunOptions = {},
): {
	child: ChildProcess;
	stdout: () => string;
	stderr: () => string;
	kill: () => void;
	waitForOutput: (pattern: RegExp, timeoutMs?: number) => Promise<string>;
} {
	let stdoutBuf = "";
	let stderrBuf = "";

	const child = spawn("bun", [CLI_ENTRY, ...args], {
		env: sanitizedEnv(options.env),
		cwd: options.cwd,
		stdio: ["ignore", "pipe", "pipe"],
	});

	child.stdout?.on("data", (chunk: Buffer) => {
		stdoutBuf += chunk.toString();
	});

	child.stderr?.on("data", (chunk: Buffer) => {
		stderrBuf += chunk.toString();
	});

	return {
		child,
		stdout: () => stdoutBuf.replace(ANSI_RE, ""),
		stderr: () => stderrBuf.replace(ANSI_RE, ""),
		kill: () => {
			child.kill("SIGTERM");
		},
		waitForOutput(pattern: RegExp, timeoutMs = 5_000): Promise<string> {
			return new Promise((resolve, reject) => {
				const check = () => {
					const combined = stdoutBuf + stderrBuf;
					const match = pattern.exec(combined);
					if (match) {
						clearInterval(interval);
						clearTimeout(timer);
						resolve(match[0]);
					}
				};

				const interval = setInterval(check, 50);
				const timer = setTimeout(() => {
					clearInterval(interval);
					reject(
						new Error(
							`Timed out waiting for ${pattern}\nstdout: ${stdoutBuf}\nstderr: ${stderrBuf}`,
						),
					);
				}, timeoutMs);

				// Check immediately
				check();
			});
		},
	};
}
