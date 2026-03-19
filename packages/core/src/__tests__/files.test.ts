import { describe, expect, it } from "vitest";
import {
	createExtractionMarker,
	extractGeneratedFiles,
	uploadFiles,
	uploadSkills,
} from "../files.js";
import type { SandboxInstance } from "../sandbox-provider.js";

// ---------------------------------------------------------------------------
// Inline SandboxInstance mock helpers
// ---------------------------------------------------------------------------

type CommandCall = { cmd: string; opts?: { timeout?: number } };
type WriteCall = { path: string; content: string | Uint8Array };
type ReadResult = string | Uint8Array;

interface MockSandbox
	extends Pick<SandboxInstance, "workDir" | "capabilities" | "kill"> {
	commands: {
		run(
			cmd: string,
			opts?: { timeout?: number },
		): Promise<{ stdout: string; stderr: string; exitCode: number }>;
		calls: CommandCall[];
	};
	files: {
		write(path: string, content: string | Uint8Array): Promise<void>;
		read(
			path: string,
			opts?: { format?: "text" | "bytes" },
		): Promise<string | Uint8Array>;
		writeCalls: WriteCall[];
		readResults: Map<string, ReadResult>;
	};
}

function makeSandbox(opts?: {
	workDir?: string;
	commandResults?: Map<
		string,
		{ stdout: string; stderr: string; exitCode: number }
	>;
	readResults?: Map<string, ReadResult>;
}): MockSandbox {
	const commandCalls: CommandCall[] = [];
	const writeCalls: WriteCall[] = [];
	const commandResults = opts?.commandResults ?? new Map();
	const readResults = opts?.readResults ?? new Map();
	const workDir = opts?.workDir ?? "/home/user";

	return {
		workDir,
		capabilities: {
			fileSystem: true,
			shellExec: true,
			envInjection: true,
			streaming: true,
			networkPolicy: false,
			snapshots: false,
			reconnect: true,
			customImage: true,
		},
		kill: async () => {},
		commands: {
			calls: commandCalls,
			async run(cmd, cmdOpts) {
				commandCalls.push({ cmd, opts: cmdOpts });
				if (commandResults.has(cmd)) {
					return commandResults.get(cmd)!;
				}
				return { stdout: "", stderr: "", exitCode: 0 };
			},
		},
		files: {
			writeCalls,
			readResults,
			async write(path, content) {
				writeCalls.push({ path, content });
			},
			async read(path, _readOpts) {
				if (readResults.has(path)) {
					return readResults.get(path)!;
				}
				return "";
			},
		},
	};
}

// ---------------------------------------------------------------------------
// uploadFiles
// ---------------------------------------------------------------------------

describe("uploadFiles", () => {
	it("creates parent directories via mkdir -p for nested paths", async () => {
		const sbx = makeSandbox();
		await uploadFiles(sbx as SandboxInstance, {
			"src/utils/helper.ts": "export const x = 1;",
		});

		const mkdirCall = sbx.commands.calls.find((c) => c.cmd.includes("mkdir"));
		expect(mkdirCall).toBeDefined();
		expect(mkdirCall?.cmd).toContain("mkdir -p");
		expect(mkdirCall?.cmd).toContain(`${sbx.workDir}/src/utils`);
	});

	it("writes files with workDir prefix", async () => {
		const sbx = makeSandbox();
		await uploadFiles(sbx as SandboxInstance, {
			"notes.txt": "hello",
		});

		const writeCall = sbx.files.writeCalls.find((c) =>
			c.path.includes("notes.txt"),
		);
		expect(writeCall).toBeDefined();
		expect(writeCall?.path).toBe(`${sbx.workDir}/notes.txt`);
		expect(writeCall?.content).toBe("hello");
	});

	it("writes multiple files all with workDir prefix", async () => {
		const sbx = makeSandbox();
		await uploadFiles(sbx as SandboxInstance, {
			"a.txt": "aaa",
			"b/c.txt": "ccc",
		});

		const paths = sbx.files.writeCalls.map((c) => c.path);
		expect(paths).toContain(`${sbx.workDir}/a.txt`);
		expect(paths).toContain(`${sbx.workDir}/b/c.txt`);
	});

	it("handles flat files with no parent directories to create", async () => {
		const sbx = makeSandbox();
		await uploadFiles(sbx as SandboxInstance, {
			"flat.txt": "content",
		});

		// No mkdir should be run because 'flat.txt' has no parent dir
		const mkdirCall = sbx.commands.calls.find((c) => c.cmd.includes("mkdir"));
		expect(mkdirCall).toBeUndefined();

		expect(sbx.files.writeCalls).toHaveLength(1);
		expect(sbx.files.writeCalls[0].path).toBe(`${sbx.workDir}/flat.txt`);
	});

	it("deduplicates parent directories when multiple files share a parent", async () => {
		const sbx = makeSandbox();
		await uploadFiles(sbx as SandboxInstance, {
			"shared/a.txt": "a",
			"shared/b.txt": "b",
		});

		// Only one mkdir call for the shared parent
		const mkdirCalls = sbx.commands.calls.filter((c) =>
			c.cmd.includes("mkdir"),
		);
		expect(mkdirCalls).toHaveLength(1);
	});

	it("rejects paths with .. traversal", async () => {
		const sbx = makeSandbox();
		await expect(
			uploadFiles(sbx as SandboxInstance, { "../escape.txt": "bad" }),
		).rejects.toThrow();
	});

	it("rejects absolute paths", async () => {
		const sbx = makeSandbox();
		await expect(
			uploadFiles(sbx as SandboxInstance, { "/etc/passwd": "bad" }),
		).rejects.toThrow();
	});

	it("uses the sandbox workDir — workDir '/custom/home' resolves correctly", async () => {
		const sbx = makeSandbox({ workDir: "/custom/home" });
		await uploadFiles(sbx as SandboxInstance, {
			"notes.txt": "hello",
		});

		const writeCall = sbx.files.writeCalls.find((c) =>
			c.path.includes("notes.txt"),
		);
		expect(writeCall?.path).toBe("/custom/home/notes.txt");
	});
});

// ---------------------------------------------------------------------------
// uploadSkills
// ---------------------------------------------------------------------------

describe("uploadSkills", () => {
	it("creates skill directories and writes SKILL.md files", async () => {
		const sbx = makeSandbox();
		await uploadSkills(sbx as SandboxInstance, [
			{ name: "my-skill", content: "# My Skill\nDo things." },
		]);

		const mkdirCall = sbx.commands.calls.find((c) => c.cmd.includes("mkdir"));
		expect(mkdirCall).toBeDefined();
		expect(mkdirCall?.cmd).toContain(`${sbx.workDir}/.pi/skills/my-skill`);

		const writeCall = sbx.files.writeCalls.find((c) =>
			c.path.includes("SKILL.md"),
		);
		expect(writeCall).toBeDefined();
		expect(writeCall?.path).toBe(`${sbx.workDir}/.pi/skills/my-skill/SKILL.md`);
		expect(writeCall?.content).toBe("# My Skill\nDo things.");
	});

	it("handles multiple skills", async () => {
		const sbx = makeSandbox();
		await uploadSkills(sbx as SandboxInstance, [
			{ name: "skill-a", content: "A content" },
			{ name: "skill-b", content: "B content" },
		]);

		const writtenPaths = sbx.files.writeCalls.map((c) => c.path);
		expect(writtenPaths).toContain(
			`${sbx.workDir}/.pi/skills/skill-a/SKILL.md`,
		);
		expect(writtenPaths).toContain(
			`${sbx.workDir}/.pi/skills/skill-b/SKILL.md`,
		);
	});

	it("handles empty skills array without error", async () => {
		const sbx = makeSandbox();
		await expect(
			uploadSkills(sbx as SandboxInstance, []),
		).resolves.toBeUndefined();

		expect(sbx.commands.calls).toHaveLength(0);
		expect(sbx.files.writeCalls).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// createExtractionMarker
// ---------------------------------------------------------------------------

describe("createExtractionMarker", () => {
	it("writes marker file via files.write", async () => {
		const sbx = makeSandbox();
		await createExtractionMarker(sbx as SandboxInstance, "req-123");

		expect(sbx.files.writeCalls).toHaveLength(1);
		expect(sbx.files.writeCalls[0].path).toContain("req-123");
		expect(sbx.files.writeCalls[0].content).toBe("");
	});

	it("returns the marker file path", async () => {
		const sbx = makeSandbox();
		const path = await createExtractionMarker(
			sbx as SandboxInstance,
			"req-abc",
		);

		expect(path).toBe("/tmp/sandcaster-extract-req-abc.marker");
	});
});

// ---------------------------------------------------------------------------
// extractGeneratedFiles
// ---------------------------------------------------------------------------

describe("extractGeneratedFiles", () => {
	it("finds and returns new files as file events", async () => {
		const markerPath = "/tmp/sandcaster-extract-test-1.marker";
		const findCmd = `find /home/user -path '*/.*' -prune -o -type f -cnewer '${markerPath}' -printf '%P\\t%s\\n'`;

		const commandResults = new Map([
			[findCmd, { stdout: "output.txt\t12\n", stderr: "", exitCode: 0 }],
		]);
		const readResults = new Map<string, ReadResult>([
			["/home/user/output.txt", "result content"],
		]);
		const sbx = makeSandbox({ commandResults, readResults });

		const files = await extractGeneratedFiles(
			sbx as SandboxInstance,
			new Set<string>(),
			"test-1",
			markerPath,
		);

		expect(files).toHaveLength(1);
		expect(files[0]).toMatchObject({
			type: "file",
			path: "output.txt",
		});
	});

	it("filters out input files from results", async () => {
		const markerPath = "/tmp/sandcaster-extract-test-2.marker";
		const findCmd = `find /home/user -path '*/.*' -prune -o -type f -cnewer '${markerPath}' -printf '%P\\t%s\\n'`;

		const commandResults = new Map([
			[
				findCmd,
				{
					stdout: "input.ts\t100\noutput.txt\t20\n",
					stderr: "",
					exitCode: 0,
				},
			],
		]);
		const readResults = new Map<string, ReadResult>([
			["/home/user/input.ts", "source"],
			["/home/user/output.txt", "result"],
		]);
		const sbx = makeSandbox({ commandResults, readResults });

		const files = await extractGeneratedFiles(
			sbx as SandboxInstance,
			new Set(["input.ts"]),
			"test-2",
			markerPath,
		);

		expect(files.map((f) => f.path)).not.toContain("input.ts");
		expect(files.map((f) => f.path)).toContain("output.txt");
	});

	it("caps results at 10 files maximum", async () => {
		const markerPath = "/tmp/sandcaster-extract-test-3.marker";
		const findCmd = `find /home/user -path '*/.*' -prune -o -type f -cnewer '${markerPath}' -printf '%P\\t%s\\n'`;

		// Generate 15 files in the find output
		const lines = Array.from(
			{ length: 15 },
			(_, i) => `file-${i}.txt\t10`,
		).join("\n");

		const commandResults = new Map([
			[findCmd, { stdout: `${lines}\n`, stderr: "", exitCode: 0 }],
		]);
		const readResults = new Map<string, ReadResult>(
			Array.from({ length: 15 }, (_, i) => [
				`/home/user/file-${i}.txt`,
				`content-${i}`,
			]),
		);
		const sbx = makeSandbox({ commandResults, readResults });

		const files = await extractGeneratedFiles(
			sbx as SandboxInstance,
			new Set<string>(),
			"test-3",
			markerPath,
		);

		expect(files.length).toBeLessThanOrEqual(10);
	});

	it("filters out files over 25MB", async () => {
		const markerPath = "/tmp/sandcaster-extract-test-4.marker";
		const findCmd = `find /home/user -path '*/.*' -prune -o -type f -cnewer '${markerPath}' -printf '%P\\t%s\\n'`;

		const oversizeBytes = 26 * 1024 * 1024; // 26MB > 25MB limit
		const commandResults = new Map([
			[
				findCmd,
				{
					stdout: `big-file.bin\t${oversizeBytes}\nsmall.txt\t100\n`,
					stderr: "",
					exitCode: 0,
				},
			],
		]);
		const readResults = new Map<string, ReadResult>([
			["/home/user/small.txt", "small content"],
		]);
		const sbx = makeSandbox({ commandResults, readResults });

		const files = await extractGeneratedFiles(
			sbx as SandboxInstance,
			new Set<string>(),
			"test-4",
			markerPath,
		);

		const paths = files.map((f) => f.path);
		expect(paths).not.toContain("big-file.bin");
		expect(paths).toContain("small.txt");
	});

	it("cleans up marker file in finally block", async () => {
		const markerPath = "/tmp/sandcaster-extract-test-5.marker";
		const findCmd = `find /home/user -path '*/.*' -prune -o -type f -cnewer '${markerPath}' -printf '%P\\t%s\\n'`;

		const commandResults = new Map([
			[findCmd, { stdout: "", stderr: "", exitCode: 0 }],
		]);
		const sbx = makeSandbox({ commandResults });

		await extractGeneratedFiles(
			sbx as SandboxInstance,
			new Set<string>(),
			"test-5",
			markerPath,
		);

		const cleanupCall = sbx.commands.calls.find((c) =>
			c.cmd.includes(`rm -f '${markerPath}'`),
		);
		expect(cleanupCall).toBeDefined();
	});

	it("cleans up marker file even when an error occurs", async () => {
		const markerPath = "/tmp/sandcaster-extract-test-6.marker";
		const findCmd = `find /home/user -path '*/.*' -prune -o -type f -cnewer '${markerPath}' -printf '%P\\t%s\\n'`;
		const commandResults = new Map([
			[findCmd, { stdout: "some-file.txt\t10\n", stderr: "", exitCode: 0 }],
		]);

		const sbx = makeSandbox({ commandResults });
		// Override read to throw
		const originalRead = sbx.files.read.bind(sbx.files);
		sbx.files.read = async (path, opts) => {
			if (path.endsWith("some-file.txt")) {
				throw new Error("read failed");
			}
			return originalRead(path, opts);
		};

		await expect(
			extractGeneratedFiles(
				sbx as SandboxInstance,
				new Set<string>(),
				"test-6",
				markerPath,
			),
		).rejects.toThrow("read failed");

		const cleanupCall = sbx.commands.calls.find((c) =>
			c.cmd.includes(`rm -f '${markerPath}'`),
		);
		expect(cleanupCall).toBeDefined();
	});

	it("returns empty array when no new files are found", async () => {
		const markerPath = "/tmp/sandcaster-extract-test-7.marker";
		const findCmd = `find /home/user -path '*/.*' -prune -o -type f -cnewer '${markerPath}' -printf '%P\\t%s\\n'`;

		const commandResults = new Map([
			[findCmd, { stdout: "", stderr: "", exitCode: 0 }],
		]);
		const sbx = makeSandbox({ commandResults });

		const files = await extractGeneratedFiles(
			sbx as SandboxInstance,
			new Set<string>(),
			"test-7",
			markerPath,
		);

		expect(files).toEqual([]);
	});
});
