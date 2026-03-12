import type {
	RunOptions,
	SandcasterConfig,
	SandcasterEvent,
} from "@sandcaster/core";
import { describe, expect, it, vi } from "vitest";
import type { QueryArgs, QueryDeps } from "../../commands/query.js";
import { executeQuery } from "../../commands/query.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResultEvent(): SandcasterEvent {
	return { type: "result", content: "done" };
}

function makeErrorEvent(): SandcasterEvent {
	return { type: "error", content: "something went wrong" };
}

async function* makeGenerator(
	events: SandcasterEvent[],
): AsyncGenerator<SandcasterEvent> {
	for (const event of events) {
		yield event;
	}
}

function makeFakeInkInstance(resolveWith: () => void): {
	waitUntilExit: () => Promise<void>;
	unmount: () => void;
	rerender: () => void;
	cleanup: () => void;
	clear: () => void;
} {
	return {
		waitUntilExit: () =>
			new Promise<void>((resolve) => setTimeout(resolve, 10)),
		unmount: resolveWith,
		rerender: () => {},
		cleanup: () => {},
		clear: () => {},
	};
}

function makeDefaultDeps(
	overrides: Partial<QueryDeps> = {},
): QueryDeps & { capturedOptions: RunOptions | null } {
	const deps: QueryDeps & { capturedOptions: RunOptions | null } = {
		capturedOptions: null,
		runAgent: (options: RunOptions) => {
			deps.capturedOptions = options;
			return makeGenerator([makeResultEvent()]);
		},
		loadConfig: (_dir?: string): SandcasterConfig | null => null,
		stdout: { write: vi.fn<(data: string) => boolean>().mockReturnValue(true) },
		readFile: (path: string) => `content of ${path}`,
		exit: vi.fn<(code: number) => void>(),
		render: vi.fn().mockImplementation(() => makeFakeInkInstance(() => {})),
		...overrides,
	};

	return deps;
}

function makeDefaultArgs(overrides: Partial<QueryArgs> = {}): QueryArgs {
	return {
		prompt: "hello world",
		model: undefined,
		provider: undefined,
		file: [],
		timeout: 300,
		maxTurns: undefined,
		noTui: true,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("executeQuery", () => {
	describe("core invocation", () => {
		it("calls runAgent with the prompt from args", async () => {
			const deps = makeDefaultDeps();
			await executeQuery(makeDefaultArgs({ prompt: "test prompt" }), deps);

			expect(deps.capturedOptions?.request.prompt).toBe("test prompt");
		});

		it("calls runAgent with timeout from args", async () => {
			const deps = makeDefaultDeps();
			await executeQuery(makeDefaultArgs({ timeout: 120 }), deps);

			expect(deps.capturedOptions?.request.timeout).toBe(120);
		});

		it("calls runAgent with model when provided", async () => {
			const deps = makeDefaultDeps();
			await executeQuery(makeDefaultArgs({ model: "claude-opus-4-5" }), deps);

			expect(deps.capturedOptions?.request.model).toBe("claude-opus-4-5");
		});

		it("calls runAgent with provider when provided", async () => {
			const deps = makeDefaultDeps();
			await executeQuery(makeDefaultArgs({ provider: "anthropic" }), deps);

			expect(deps.capturedOptions?.request.provider).toBe("anthropic");
		});

		it("calls runAgent with maxTurns when provided", async () => {
			const deps = makeDefaultDeps();
			await executeQuery(makeDefaultArgs({ maxTurns: 10 }), deps);

			expect(deps.capturedOptions?.request.maxTurns).toBe(10);
		});

		it("passes config from loadConfig to runAgent", async () => {
			const config: SandcasterConfig = { model: "claude-sonnet-4-6" };
			const deps = makeDefaultDeps({
				loadConfig: () => config,
			});
			await executeQuery(makeDefaultArgs(), deps);

			expect(deps.capturedOptions?.config).toBe(config);
		});
	});

	describe("file reading", () => {
		it("reads file contents and passes them as files in the request", async () => {
			const deps = makeDefaultDeps({
				readFile: (path: string) => `data:${path}`,
			});
			await executeQuery(
				makeDefaultArgs({ file: ["foo.txt", "bar/baz.ts"] }),
				deps,
			);

			expect(deps.capturedOptions?.request.files).toEqual({
				"foo.txt": "data:foo.txt",
				"bar/baz.ts": "data:bar/baz.ts",
			});
		});

		it("does not include files field when no files are provided", async () => {
			const deps = makeDefaultDeps();
			await executeQuery(makeDefaultArgs({ file: [] }), deps);

			expect(deps.capturedOptions?.request.files).toBeUndefined();
		});

		it("exits with code 1 and writes error when file read fails", async () => {
			const deps = makeDefaultDeps({
				readFile: () => {
					throw new Error("ENOENT: no such file");
				},
			});
			await executeQuery(makeDefaultArgs({ file: ["missing.txt"] }), deps);

			expect(deps.exit).toHaveBeenCalledWith(1);
			const writeMock = deps.stdout.write as ReturnType<typeof vi.fn>;
			expect(writeMock).toHaveBeenCalledWith(
				expect.stringContaining("Error reading file missing.txt"),
			);
		});
	});

	describe("--no-tui stdout output", () => {
		it("writes each event as a JSON line to stdout", async () => {
			const events: SandcasterEvent[] = [
				{ type: "assistant", content: "thinking..." },
				makeResultEvent(),
			];
			const deps = makeDefaultDeps({
				runAgent: () => makeGenerator(events),
			});
			await executeQuery(makeDefaultArgs({ noTui: true }), deps);

			const writeMock = deps.stdout.write as ReturnType<typeof vi.fn>;
			expect(writeMock).toHaveBeenCalledWith(`${JSON.stringify(events[0])}\n`);
			expect(writeMock).toHaveBeenCalledWith(`${JSON.stringify(events[1])}\n`);
		});
	});

	describe("exit codes", () => {
		it("exits with code 0 when the last event is a result event", async () => {
			const deps = makeDefaultDeps({
				runAgent: () => makeGenerator([makeResultEvent()]),
			});
			await executeQuery(makeDefaultArgs({ noTui: true }), deps);

			expect(deps.exit).toHaveBeenCalledWith(0);
		});

		it("exits with code 1 when an error event is received", async () => {
			const deps = makeDefaultDeps({
				runAgent: () => makeGenerator([makeErrorEvent()]),
			});
			await executeQuery(makeDefaultArgs({ noTui: true }), deps);

			expect(deps.exit).toHaveBeenCalledWith(1);
		});

		it("exits with code 1 when no result event is received", async () => {
			const deps = makeDefaultDeps({
				runAgent: () => makeGenerator([{ type: "assistant", content: "hi" }]),
			});
			await executeQuery(makeDefaultArgs({ noTui: true }), deps);

			expect(deps.exit).toHaveBeenCalledWith(1);
		});
	});

	describe("TUI path", () => {
		it("calls deps.render when noTui is false", async () => {
			const deps = makeDefaultDeps({
				runAgent: () => makeGenerator([makeResultEvent()]),
			});
			await executeQuery(makeDefaultArgs({ noTui: false }), deps);

			expect(deps.render).toHaveBeenCalledTimes(1);
		});

		it("calls deps.render with an element and waits for exit", async () => {
			let waitUntilExitCalled = false;
			const deps = makeDefaultDeps({
				runAgent: () => makeGenerator([makeResultEvent()]),
				render: vi.fn().mockImplementation(() => ({
					waitUntilExit: () =>
						new Promise<void>((resolve) => {
							waitUntilExitCalled = true;
							resolve();
						}),
					unmount: () => {},
					rerender: () => {},
					cleanup: () => {},
					clear: () => {},
				})),
			});
			await executeQuery(makeDefaultArgs({ noTui: false }), deps);

			expect(waitUntilExitCalled).toBe(true);
		});
	});
});
