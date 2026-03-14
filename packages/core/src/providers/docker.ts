import type {
	CommandOptions,
	CommandResult,
	CreateResult,
	SandboxInstance,
	SandboxProvider,
	SandboxProviderConfig,
	SandboxProviderName,
} from "../sandbox-provider.js";

// ---------------------------------------------------------------------------
// Template validation
// Docker image names: <name>[:<tag>] or <registry>/<name>[:<tag>]
// No spaces, non-empty
// ---------------------------------------------------------------------------

function isValidTemplate(template: string): boolean {
	if (template.length === 0) return false;
	if (/\s/.test(template)) return false;
	return true;
}

// ---------------------------------------------------------------------------
// Orphan reaping — remove any containers labeled sandcaster=true
// ---------------------------------------------------------------------------

async function reapOrphanedContainers(
	execa: (
		cmd: string,
		args: string[],
		opts?: Record<string, unknown>,
	) => Promise<{ stdout: string }>,
): Promise<void> {
	const { stdout } = await execa("docker", [
		"ps",
		"-q",
		"--filter",
		"label=sandcaster=true",
	]);
	const ids = stdout
		.split("\n")
		.map((s) => s.trim())
		.filter(Boolean);
	for (const id of ids) {
		await execa("docker", ["rm", "-f", id]);
	}
}

// ---------------------------------------------------------------------------
// createDockerProvider
// ---------------------------------------------------------------------------

export function createDockerProvider(): SandboxProvider {
	return {
		name: "docker" as SandboxProviderName,

		async create(config: SandboxProviderConfig): Promise<CreateResult> {
			const template = config.template ?? "sandcaster-sandbox";

			// Validate template
			if (!isValidTemplate(template)) {
				return {
					ok: false,
					code: "INVALID_TEMPLATE_FOR_PROVIDER",
					message: `Invalid Docker image name: "${template}". Must be non-empty and contain no spaces.`,
					hint: "Use a valid Docker image tag, e.g. 'node:20' or 'my-registry/image:v1'",
				};
			}

			const { execa } = await import("execa");

			// Reap orphaned containers before starting a new one
			try {
				await reapOrphanedContainers(
					execa as unknown as (
						cmd: string,
						args: string[],
						opts?: Record<string, unknown>,
					) => Promise<{ stdout: string }>,
				);
			} catch {
				// Non-fatal — continue even if reaping fails
			}

			// Pull / verify image exists
			try {
				await execa("docker", ["pull", template]);
			} catch (err) {
				return {
					ok: false,
					code: "TEMPLATE_NOT_FOUND",
					message: `Docker image '${template}' could not be pulled: ${err instanceof Error ? err.message : String(err)}`,
					hint: "Ensure the image exists locally or is available on Docker Hub. Run: docker pull <image>",
				};
			}

			// Build docker run args
			const runArgs: string[] = [
				"run",
				"-d",
				"--rm",
				"--label",
				"sandcaster=true",
			];

			// Inject environment variables
			if (config.envs) {
				for (const [key, value] of Object.entries(config.envs)) {
					runArgs.push("--env", `${key}=${value}`);
				}
			}

			runArgs.push(template, "sleep", "infinity");

			// Start the container
			let containerId: string;
			try {
				const { stdout } = await execa("docker", runArgs);
				containerId = stdout.trim();
			} catch (err) {
				return {
					ok: false,
					code: "SANDBOX_ERROR",
					message: `Failed to start Docker container: ${err instanceof Error ? err.message : String(err)}`,
				};
			}

			// Build and return the SandboxInstance
			const instance: SandboxInstance = {
				workDir: "/workspace",
				capabilities: {
					fileSystem: true,
					shellExec: true,
					envInjection: true,
					streaming: false,
					networkPolicy: false,
					snapshots: false,
					reconnect: false,
					customImage: true,
				},
				files: {
					async write(
						path: string,
						content: string | Uint8Array,
					): Promise<void> {
						const { execa: execaInner } = await import("execa");
						const contentStr =
							typeof content === "string"
								? content
								: new TextDecoder().decode(content);
						await execaInner(
							"docker",
							["exec", "-i", containerId, "sh", "-c", `cat > '${path}'`],
							{ input: contentStr },
						);
					},

					async read(
						path: string,
						_opts?: { format?: "text" | "bytes" },
					): Promise<string | Uint8Array> {
						const { execa: execaInner } = await import("execa");
						const { stdout } = await execaInner("docker", [
							"exec",
							containerId,
							"cat",
							path,
						]);
						return stdout;
					},
				},
				commands: {
					async run(
						cmd: string,
						opts?: CommandOptions,
					): Promise<CommandResult> {
						const { execa: execaInner } = await import("execa");
						const execaOpts: Record<string, unknown> = { reject: false };
						if (opts?.timeoutMs !== undefined) {
							execaOpts.timeout = opts.timeoutMs;
						}

						const result = await execaInner(
							"docker",
							["exec", containerId, "sh", "-c", cmd],
							execaOpts,
						);

						// execa with reject:false puts timedOut on the result
						const timedOut =
							(result as unknown as { timedOut?: boolean }).timedOut ?? false;
						if (timedOut) {
							return {
								stdout: result.stdout ?? "",
								stderr: "Command timeout: exceeded time limit",
								exitCode: -1,
							};
						}

						return {
							stdout: result.stdout ?? "",
							stderr: result.stderr ?? "",
							exitCode: result.exitCode ?? 0,
						};
					},
				},
				async kill(): Promise<void> {
					const { execa: execaInner } = await import("execa");
					try {
						await execaInner("docker", ["rm", "-f", containerId]);
					} catch {
						// Idempotent — ignore errors if container already removed
					}
				},
			};

			return { ok: true, instance };
		},
	};
}
