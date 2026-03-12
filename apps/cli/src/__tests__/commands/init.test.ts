import { describe, expect, it, vi } from "vitest";
import type { InitArgs, InitDeps } from "../../commands/init.js";
import { executeInit } from "../../commands/init.js";
import type { StarterDefinition } from "../../starters/catalog.js";
import { ENV_EXAMPLE } from "../../starters/catalog.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeStarter(
	overrides: Partial<StarterDefinition> = {},
): StarterDefinition {
	return {
		slug: "test-starter",
		title: "Test Starter",
		description: "A test starter",
		nextStepCommand: 'sandcaster "do something"',
		aliases: ["ts"],
		configJson: {
			systemPrompt: "You are a test agent.",
			model: "sonnet",
			maxTurns: 10,
		},
		readme: '# Test Starter\n\nUsage: sandcaster "do something"\n',
		...overrides,
	};
}

function makeDeps(overrides: Partial<InitDeps> = {}): InitDeps & {
	written: Map<string, string>;
	created: string[];
	output: string;
} {
	const written = new Map<string, string>();
	const created: string[] = [];
	let output = "";

	const deps: InitDeps & {
		written: Map<string, string>;
		created: string[];
		output: string;
	} = {
		written,
		created,
		get output() {
			return output;
		},
		listStarters: () => [makeStarter()],
		resolveStarter: (name: string) => {
			if (name === "test-starter" || name === "ts") return makeStarter();
			throw new Error(`Unknown starter "${name}". Choose one of: test-starter`);
		},
		writeFile: (path: string, content: string) => {
			written.set(path, content);
		},
		mkdirp: (path: string) => {
			created.push(path);
		},
		exists: vi.fn().mockReturnValue(false),
		isDir: vi.fn().mockReturnValue(false),
		isEmpty: vi.fn().mockReturnValue(true),
		stdout: {
			write: (data: string) => {
				output += data;
				return true;
			},
		},
		exit: vi.fn(),
		getEnv: vi.fn().mockReturnValue(""),
		...overrides,
	};

	return deps;
}

function makeArgs(overrides: Partial<InitArgs> = {}): InitArgs {
	return {
		starter: undefined,
		directory: undefined,
		list: false,
		force: false,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("executeInit", () => {
	describe("--list", () => {
		it("prints all starters and returns without writing files", async () => {
			const deps = makeDeps({
				listStarters: () => [
					makeStarter({ slug: "starter-one", title: "Starter One" }),
					makeStarter({ slug: "starter-two", title: "Starter Two" }),
				],
			});
			await executeInit(makeArgs({ list: true }), deps);

			expect(deps.output).toContain("starter-one");
			expect(deps.output).toContain("starter-two");
			expect(deps.written.size).toBe(0);
		});

		it("does not call exit when listing", async () => {
			const deps = makeDeps();
			await executeInit(makeArgs({ list: true }), deps);
			expect(deps.exit).not.toHaveBeenCalled();
		});
	});

	describe("missing starter argument", () => {
		it("writes usage error to stdout and exits with 1", async () => {
			const deps = makeDeps();
			await executeInit(makeArgs({ starter: undefined }), deps);

			expect(deps.exit).toHaveBeenCalledWith(1);
			expect(deps.output).toContain("Usage:");
		});
	});

	describe("file creation", () => {
		it("creates the destination directory", async () => {
			const deps = makeDeps();
			await executeInit(makeArgs({ starter: "test-starter" }), deps);

			expect(deps.created).toContain("test-starter");
		});

		it("writes sandcaster.json with 2-space indent", async () => {
			const deps = makeDeps();
			await executeInit(makeArgs({ starter: "test-starter" }), deps);

			const content = deps.written.get("test-starter/sandcaster.json");
			expect(content).toBeDefined();
			expect(content).toBe(JSON.stringify(makeStarter().configJson, null, 2));
		});

		it("writes README.md from starter.readme", async () => {
			const deps = makeDeps();
			await executeInit(makeArgs({ starter: "test-starter" }), deps);

			const content = deps.written.get("test-starter/README.md");
			expect(content).toBe(makeStarter().readme);
		});

		it("writes .env.example", async () => {
			const deps = makeDeps();
			await executeInit(makeArgs({ starter: "test-starter" }), deps);

			const content = deps.written.get("test-starter/.env.example");
			expect(content).toBe(ENV_EXAMPLE);
		});

		it("writes extra files when starter has extraFiles", async () => {
			const starterWithExtras = makeStarter({
				extraFiles: {
					".claude/skills/my-skill.md": "# My Skill\n",
				},
			});
			const deps = makeDeps({
				resolveStarter: () => starterWithExtras,
			});
			await executeInit(makeArgs({ starter: "test-starter" }), deps);

			const content = deps.written.get(
				"test-starter/.claude/skills/my-skill.md",
			);
			expect(content).toBe("# My Skill\n");
		});

		it("does not write extraFiles when starter has none", async () => {
			const deps = makeDeps();
			await executeInit(makeArgs({ starter: "test-starter" }), deps);

			// Only sandcaster.json, README.md, .env.example should be written
			// (plus possibly .env if env vars detected)
			const extraKeys = [...deps.written.keys()].filter(
				(k) =>
					!k.endsWith("sandcaster.json") &&
					!k.endsWith("README.md") &&
					!k.endsWith(".env.example") &&
					!k.endsWith(".env"),
			);
			expect(extraKeys).toHaveLength(0);
		});
	});

	describe("directory selection", () => {
		it("uses starter slug as default directory when no directory arg", async () => {
			const deps = makeDeps();
			await executeInit(makeArgs({ starter: "test-starter" }), deps);

			expect(deps.written.has("test-starter/sandcaster.json")).toBe(true);
		});

		it("uses provided directory when specified", async () => {
			const deps = makeDeps();
			await executeInit(
				makeArgs({ starter: "test-starter", directory: "my-project" }),
				deps,
			);

			expect(deps.written.has("my-project/sandcaster.json")).toBe(true);
		});

		it("does not write to slug directory when custom directory is given", async () => {
			const deps = makeDeps();
			await executeInit(
				makeArgs({ starter: "test-starter", directory: "custom" }),
				deps,
			);

			expect(deps.written.has("test-starter/sandcaster.json")).toBe(false);
		});
	});

	describe("--force flag", () => {
		it("writes files even when directory is non-empty with --force", async () => {
			const deps = makeDeps({
				exists: vi.fn().mockReturnValue(true),
				isDir: vi.fn().mockReturnValue(true),
				isEmpty: vi.fn().mockReturnValue(false),
			});
			await executeInit(
				makeArgs({ starter: "test-starter", force: true }),
				deps,
			);

			expect(deps.written.has("test-starter/sandcaster.json")).toBe(true);
			expect(deps.exit).not.toHaveBeenCalledWith(1);
		});
	});

	describe("directory validation", () => {
		it("exits with 1 when directory exists, is non-empty, and no --force", async () => {
			const deps = makeDeps({
				exists: vi.fn().mockReturnValue(true),
				isDir: vi.fn().mockReturnValue(true),
				isEmpty: vi.fn().mockReturnValue(false),
			});
			await executeInit(
				makeArgs({ starter: "test-starter", force: false }),
				deps,
			);

			expect(deps.exit).toHaveBeenCalledWith(1);
			expect(deps.written.size).toBe(0);
		});

		it("writes files when directory exists but is empty (no --force needed)", async () => {
			const deps = makeDeps({
				exists: vi.fn().mockReturnValue(true),
				isDir: vi.fn().mockReturnValue(true),
				isEmpty: vi.fn().mockReturnValue(true),
			});
			await executeInit(makeArgs({ starter: "test-starter" }), deps);

			expect(deps.written.has("test-starter/sandcaster.json")).toBe(true);
		});
	});

	describe("success message", () => {
		it("prints a success message with next steps", async () => {
			const deps = makeDeps();
			await executeInit(makeArgs({ starter: "test-starter" }), deps);

			expect(deps.output).toContain("test-starter");
		});
	});

	describe("provider env detection", () => {
		it("writes .env when ANTHROPIC_API_KEY is set", async () => {
			const deps = makeDeps({
				getEnv: (name: string) =>
					name === "ANTHROPIC_API_KEY" ? "sk-ant-test" : "",
			});
			await executeInit(makeArgs({ starter: "test-starter" }), deps);

			const envContent = deps.written.get("test-starter/.env");
			expect(envContent).toBeDefined();
			expect(envContent).toContain("ANTHROPIC_API_KEY=sk-ant-test");
		});

		it("writes .env when OPENROUTER_API_KEY is set", async () => {
			const deps = makeDeps({
				getEnv: (name: string) =>
					name === "OPENROUTER_API_KEY" ? "sk-or-test" : "",
			});
			await executeInit(makeArgs({ starter: "test-starter" }), deps);

			const envContent = deps.written.get("test-starter/.env");
			expect(envContent).toBeDefined();
			expect(envContent).toContain("OPENROUTER_API_KEY=sk-or-test");
		});

		it("includes ANTHROPIC_BASE_URL for OpenRouter provider", async () => {
			const deps = makeDeps({
				getEnv: (name: string) =>
					name === "OPENROUTER_API_KEY" ? "sk-or-test" : "",
			});
			await executeInit(makeArgs({ starter: "test-starter" }), deps);

			const envContent = deps.written.get("test-starter/.env");
			expect(envContent).toContain(
				"ANTHROPIC_BASE_URL=https://openrouter.ai/api",
			);
		});

		it("writes .env when CLAUDE_CODE_USE_VERTEX is set", async () => {
			const deps = makeDeps({
				getEnv: (name: string) =>
					name === "CLAUDE_CODE_USE_VERTEX" ? "1" : "",
			});
			await executeInit(makeArgs({ starter: "test-starter" }), deps);

			const envContent = deps.written.get("test-starter/.env");
			expect(envContent).toBeDefined();
			expect(envContent).toContain("CLAUDE_CODE_USE_VERTEX=1");
		});

		it("writes .env when CLAUDE_CODE_USE_BEDROCK is set", async () => {
			const deps = makeDeps({
				getEnv: (name: string) =>
					name === "CLAUDE_CODE_USE_BEDROCK" ? "1" : "",
			});
			await executeInit(makeArgs({ starter: "test-starter" }), deps);

			const envContent = deps.written.get("test-starter/.env");
			expect(envContent).toBeDefined();
			expect(envContent).toContain("CLAUDE_CODE_USE_BEDROCK=1");
		});

		it("does not write .env when no provider env vars are set", async () => {
			const deps = makeDeps({
				getEnv: vi.fn().mockReturnValue(""),
			});
			await executeInit(makeArgs({ starter: "test-starter" }), deps);

			expect(deps.written.has("test-starter/.env")).toBe(false);
		});

		it("does not overwrite .env when it already exists in destination", async () => {
			const deps = makeDeps({
				getEnv: (name: string) =>
					name === "ANTHROPIC_API_KEY" ? "sk-ant-test" : "",
				exists: (path: string) => path.endsWith(".env"),
				isDir: vi.fn().mockReturnValue(false),
				isEmpty: vi.fn().mockReturnValue(true),
			});
			await executeInit(makeArgs({ starter: "test-starter" }), deps);

			// .env should NOT be written since it already exists
			expect(deps.written.has("test-starter/.env")).toBe(false);
		});
	});

	describe("alias resolution", () => {
		it("resolves starter by alias", async () => {
			const deps = makeDeps();
			await executeInit(makeArgs({ starter: "ts" }), deps);

			// Should succeed and write to the slug directory (test-starter)
			expect(deps.written.has("test-starter/sandcaster.json")).toBe(true);
		});
	});
});
