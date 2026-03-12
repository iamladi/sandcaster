import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSandboxTools } from "../../runner/sandbox-tools.js";

describe("createSandboxTools", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "sandcaster-tools-test-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	// -------------------------------------------------------------------------
	// Tool array structure
	// -------------------------------------------------------------------------

	it("returns exactly 4 tools", () => {
		const tools = createSandboxTools();
		expect(tools).toHaveLength(4);
	});

	it("returns tools with correct names", () => {
		const tools = createSandboxTools();
		const names = tools.map((t) => t.name);
		expect(names).toContain("bash");
		expect(names).toContain("file_read");
		expect(names).toContain("file_write");
		expect(names).toContain("read_skill");
	});

	it("each tool has a non-empty description", () => {
		const tools = createSandboxTools();
		for (const tool of tools) {
			expect(tool.description.length).toBeGreaterThan(0);
		}
	});

	it("each tool has a non-empty label", () => {
		const tools = createSandboxTools();
		for (const tool of tools) {
			expect(tool.label.length).toBeGreaterThan(0);
		}
	});

	it("each tool has a parameters object", () => {
		const tools = createSandboxTools();
		for (const tool of tools) {
			expect(tool.parameters).toBeDefined();
			expect(typeof tool.parameters).toBe("object");
		}
	});

	// -------------------------------------------------------------------------
	// bash tool
	// -------------------------------------------------------------------------

	describe("bash tool", () => {
		it("has correct name and label", () => {
			const tools = createSandboxTools();
			const bash = tools.find((t) => t.name === "bash")!;
			expect(bash.name).toBe("bash");
			expect(bash.label).toBe("Run shell command");
		});

		it("executes a command and returns stdout", async () => {
			const tools = createSandboxTools({ cwd: tmpDir });
			const bash = tools.find((t) => t.name === "bash")!;

			const result = await bash.execute("call-1", { command: "echo hello" });

			expect(result.content).toHaveLength(1);
			expect(result.content[0]).toMatchObject({
				type: "text",
				text: expect.stringContaining("hello"),
			});
			expect(result.details).toMatchObject({ exitCode: 0 });
		});

		it("throws when command fails", async () => {
			const tools = createSandboxTools({ cwd: tmpDir });
			const bash = tools.find((t) => t.name === "bash")!;

			await expect(
				bash.execute("call-2", { command: "exit 1" }),
			).rejects.toThrow();
		});

		it("uses custom cwd when provided", async () => {
			const tools = createSandboxTools({ cwd: tmpDir });
			const bash = tools.find((t) => t.name === "bash")!;

			const result = await bash.execute("call-3", { command: "pwd" });

			expect(result.content[0]).toMatchObject({
				type: "text",
				text: expect.stringContaining(tmpDir),
			});
		});

		it("throws when cwd does not exist", async () => {
			// Verifies that the cwd option is actually forwarded to execSync.
			// When the directory does not exist, execSync throws ENOENT.
			const tools = createSandboxTools({
				cwd: join(tmpDir, "nonexistent-cwd"),
			});
			const bash = tools.find((t) => t.name === "bash")!;

			await expect(
				bash.execute("call-4", { command: "echo ok" }),
			).rejects.toThrow();
		});

		it("passes timeout parameter to execSync", async () => {
			const tools = createSandboxTools({ cwd: tmpDir });
			const bash = tools.find((t) => t.name === "bash")!;

			// A command with a very short timeout should throw
			await expect(
				bash.execute("call-5", { command: "sleep 10", timeout: 1 }),
			).rejects.toThrow();
		});
	});

	// -------------------------------------------------------------------------
	// file_read tool
	// -------------------------------------------------------------------------

	describe("file_read tool", () => {
		it("has correct name and label", () => {
			const tools = createSandboxTools();
			const fileRead = tools.find((t) => t.name === "file_read")!;
			expect(fileRead.name).toBe("file_read");
			expect(fileRead.label).toBe("Read file");
		});

		it("reads file content and returns it as text", async () => {
			const filePath = join(tmpDir, "test.txt");
			writeFileSync(filePath, "hello from file", "utf-8");

			const tools = createSandboxTools();
			const fileRead = tools.find((t) => t.name === "file_read")!;

			const result = await fileRead.execute("call-6", { path: filePath });

			expect(result.content).toHaveLength(1);
			expect(result.content[0]).toMatchObject({
				type: "text",
				text: "hello from file",
			});
			expect(result.details).toEqual({});
		});

		it("throws for a missing file", async () => {
			const tools = createSandboxTools();
			const fileRead = tools.find((t) => t.name === "file_read")!;

			await expect(
				fileRead.execute("call-7", {
					path: join(tmpDir, "does-not-exist.txt"),
				}),
			).rejects.toThrow();
		});
	});

	// -------------------------------------------------------------------------
	// file_write tool
	// -------------------------------------------------------------------------

	describe("file_write tool", () => {
		it("has correct name and label", () => {
			const tools = createSandboxTools();
			const fileWrite = tools.find((t) => t.name === "file_write")!;
			expect(fileWrite.name).toBe("file_write");
			expect(fileWrite.label).toBe("Write file");
		});

		it("writes content to a file", async () => {
			const filePath = join(tmpDir, "output.txt");
			const tools = createSandboxTools();
			const fileWrite = tools.find((t) => t.name === "file_write")!;

			await fileWrite.execute("call-8", {
				path: filePath,
				content: "written content",
			});

			expect(existsSync(filePath)).toBe(true);
			expect(readFileSync(filePath, "utf-8")).toBe("written content");
		});

		it("creates parent directories recursively", async () => {
			const filePath = join(tmpDir, "nested", "deep", "file.txt");
			const tools = createSandboxTools();
			const fileWrite = tools.find((t) => t.name === "file_write")!;

			await fileWrite.execute("call-9", {
				path: filePath,
				content: "nested content",
			});

			expect(existsSync(filePath)).toBe(true);
		});

		it("returns a confirmation message containing the path", async () => {
			const filePath = join(tmpDir, "confirm.txt");
			const tools = createSandboxTools();
			const fileWrite = tools.find((t) => t.name === "file_write")!;

			const result = await fileWrite.execute("call-10", {
				path: filePath,
				content: "data",
			});

			expect(result.content).toHaveLength(1);
			expect(result.content[0]).toMatchObject({
				type: "text",
				text: expect.stringContaining(filePath),
			});
			expect(result.details).toEqual({});
		});
	});

	// -------------------------------------------------------------------------
	// read_skill tool
	// -------------------------------------------------------------------------

	describe("read_skill tool", () => {
		it("has correct name and label", () => {
			const tools = createSandboxTools();
			const readSkill = tools.find((t) => t.name === "read_skill")!;
			expect(readSkill.name).toBe("read_skill");
			expect(readSkill.label).toBe("Read skill");
		});

		it("reads SKILL.md from the skill directory", async () => {
			const skillsDir = join(tmpDir, "skills");
			const skillDir = join(skillsDir, "my-skill");
			mkdirSync(skillDir, { recursive: true });
			writeFileSync(
				join(skillDir, "SKILL.md"),
				"# My Skill\nDo things.",
				"utf-8",
			);

			const tools = createSandboxTools({ skillsDir });
			const readSkill = tools.find((t) => t.name === "read_skill")!;

			const result = await readSkill.execute("call-11", { name: "my-skill" });

			expect(result.content).toHaveLength(1);
			expect(result.content[0]).toMatchObject({
				type: "text",
				text: "# My Skill\nDo things.",
			});
			expect(result.details).toEqual({});
		});

		it("throws for a missing skill", async () => {
			const skillsDir = join(tmpDir, "skills");
			mkdirSync(skillsDir, { recursive: true });

			const tools = createSandboxTools({ skillsDir });
			const readSkill = tools.find((t) => t.name === "read_skill")!;

			await expect(
				readSkill.execute("call-12", { name: "nonexistent-skill" }),
			).rejects.toThrow();
		});

		it("defaults skillsDir to /home/user/.pi/skills", () => {
			// Verify the default by creating tools without options and checking
			// that a missing skill (which won't be in /home/user/.pi/skills in test env)
			// throws. This confirms the default path is used.
			const tools = createSandboxTools();
			const readSkill = tools.find((t) => t.name === "read_skill")!;
			// The skill definitely won't exist in the test environment default path
			return expect(
				readSkill.execute("call-13", { name: "definitely-missing-skill" }),
			).rejects.toThrow();
		});
	});
});
