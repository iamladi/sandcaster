import { describe, expect, it, vi } from "vitest";

const mockSetTools = vi.fn();
const mockSetModel = vi.fn();
const mockSetSystemPrompt = vi.fn();
const mockAbort = vi.fn();
let _subscribeFn: ((event: any) => void) | null = null;
const mockSubscribe = vi.fn().mockImplementation((fn: any) => {
	_subscribeFn = fn;
	return () => {};
});
const mockPrompt = vi.fn().mockResolvedValue(undefined);

vi.mock("@mariozechner/pi-agent-core", () => {
	return {
		Agent: class MockAgent {
			setTools = mockSetTools;
			setModel = mockSetModel;
			setSystemPrompt = mockSetSystemPrompt;
			subscribe = mockSubscribe;
			prompt = mockPrompt;
			abort = mockAbort;
		},
	};
});

vi.mock("../../runner/model-aliases.js", () => ({
	resolveModelFromConfig: vi.fn().mockReturnValue("mock-model"),
}));

vi.mock("../../runner/event-translator.js", () => ({
	createEventTranslator: vi.fn().mockReturnValue({
		translate: vi.fn().mockReturnValue([]),
	}),
}));

vi.mock("../../runner/sandbox-tools.js", () => ({
	createSandboxTools: vi
		.fn()
		.mockReturnValue([{ name: "bash" }, { name: "file_read" }]),
}));

import { runAgent } from "../../runner/runner-main.js";

describe("runAgent", () => {
	it("calls agent.setTools with sandbox tools", async () => {
		await runAgent(
			{ prompt: "hello", model: "anthropic:claude-sonnet-4-20250514" },
			process.env,
			vi.fn(),
		);

		expect(mockSetTools).toHaveBeenCalledWith(
			expect.arrayContaining([expect.objectContaining({ name: "bash" })]),
		);
	});

	it("calls agent.setModel", async () => {
		await runAgent(
			{ prompt: "hello", model: "anthropic:claude-sonnet-4-20250514" },
			process.env,
			vi.fn(),
		);

		expect(mockSetModel).toHaveBeenCalledWith("mock-model");
	});

	it("calls agent.setSystemPrompt when config has one", async () => {
		await runAgent(
			{
				prompt: "hello",
				system_prompt: "you are helpful",
			},
			process.env,
			vi.fn(),
		);

		expect(mockSetSystemPrompt).toHaveBeenCalledWith("you are helpful");
	});

	it("does not call setSystemPrompt when config has none", async () => {
		mockSetSystemPrompt.mockClear();

		await runAgent({ prompt: "hello" }, process.env, vi.fn());

		expect(mockSetSystemPrompt).not.toHaveBeenCalled();
	});

	it("aborts agent when max_turns is reached", async () => {
		// Make prompt simulate emitting turn_end events
		mockPrompt.mockImplementationOnce(async () => {
			if (_subscribeFn) {
				_subscribeFn({ type: "turn_end" });
				_subscribeFn({ type: "turn_end" });
				_subscribeFn({ type: "turn_end" });
			}
		});

		await runAgent({ prompt: "hello", max_turns: 2 }, process.env, vi.fn());

		expect(mockAbort).toHaveBeenCalled();
	});

	it("does not abort when turns are under max_turns", async () => {
		mockAbort.mockClear();
		mockPrompt.mockImplementationOnce(async () => {
			if (_subscribeFn) {
				_subscribeFn({ type: "turn_end" });
			}
		});

		await runAgent({ prompt: "hello", max_turns: 5 }, process.env, vi.fn());

		expect(mockAbort).not.toHaveBeenCalled();
	});

	it("aborts agent when timeout is reached", async () => {
		vi.useFakeTimers();
		mockAbort.mockClear();

		// Make prompt hang until we advance time
		mockPrompt.mockImplementationOnce(
			() => new Promise((resolve) => setTimeout(resolve, 10000)),
		);

		const promise = runAgent(
			{ prompt: "hello", timeout: 5 },
			process.env,
			vi.fn(),
		);

		await vi.advanceTimersByTimeAsync(5000);

		expect(mockAbort).toHaveBeenCalled();

		// Resolve the hung prompt
		await vi.advanceTimersByTimeAsync(5000);
		await promise;
		vi.useRealTimers();
	});
});
