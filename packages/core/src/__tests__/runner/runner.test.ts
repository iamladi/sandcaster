import { describe, expect, it, vi } from "vitest";

const mockSetTools = vi.fn();
const mockSetModel = vi.fn();
const mockSetSystemPrompt = vi.fn();
const mockSubscribe = vi.fn();
const mockPrompt = vi.fn().mockResolvedValue(undefined);

vi.mock("@mariozechner/pi-agent-core", () => {
	return {
		Agent: class MockAgent {
			setTools = mockSetTools;
			setModel = mockSetModel;
			setSystemPrompt = mockSetSystemPrompt;
			subscribe = mockSubscribe;
			prompt = mockPrompt;
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
});
