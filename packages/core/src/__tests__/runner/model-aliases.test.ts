import type { Model } from "@mariozechner/pi-ai";
import {
	beforeEach,
	describe,
	expect,
	it,
	type MockInstance,
	vi,
} from "vitest";

// Mock @mariozechner/pi-ai at the module boundary — it is an external package
vi.mock("@mariozechner/pi-ai", () => ({
	getModel: vi.fn(),
}));

import { getModel } from "@mariozechner/pi-ai";
import {
	autoDetectModel,
	resolveModel,
	resolveModelFromConfig,
} from "../../runner/model-aliases.js";

const mockGetModel = getModel as unknown as MockInstance;

function fakeModel(provider: string, modelId: string): Model<string> {
	return {
		id: modelId,
		name: `${provider}/${modelId}`,
		api: "anthropic-messages",
		provider,
		baseUrl: "https://example.com",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 8192,
	} as unknown as Model<string>;
}

beforeEach(() => {
	mockGetModel.mockReset();
});

// ---------------------------------------------------------------------------
// resolveModel — known aliases
// ---------------------------------------------------------------------------

describe("resolveModel — known aliases", () => {
	it('resolves "sonnet" to anthropic claude-sonnet-4-6', () => {
		const expected = fakeModel("anthropic", "claude-sonnet-4-6");
		mockGetModel.mockReturnValue(expected);

		const result = resolveModel("sonnet");

		expect(mockGetModel).toHaveBeenCalledWith("anthropic", "claude-sonnet-4-6");
		expect(result).toBe(expected);
	});

	it('resolves "opus" to anthropic claude-opus-4-6', () => {
		const expected = fakeModel("anthropic", "claude-opus-4-6");
		mockGetModel.mockReturnValue(expected);

		const result = resolveModel("opus");

		expect(mockGetModel).toHaveBeenCalledWith("anthropic", "claude-opus-4-6");
		expect(result).toBe(expected);
	});

	it('resolves "haiku" to anthropic claude-haiku-4-5', () => {
		const expected = fakeModel("anthropic", "claude-haiku-4-5");
		mockGetModel.mockReturnValue(expected);

		const result = resolveModel("haiku");

		expect(mockGetModel).toHaveBeenCalledWith("anthropic", "claude-haiku-4-5");
		expect(result).toBe(expected);
	});

	it('resolves "gpt4" to openai gpt-4.1', () => {
		const expected = fakeModel("openai", "gpt-4.1");
		mockGetModel.mockReturnValue(expected);

		const result = resolveModel("gpt4");

		expect(mockGetModel).toHaveBeenCalledWith("openai", "gpt-4.1");
		expect(result).toBe(expected);
	});

	it('resolves "gemini" to google gemini-2.5-pro', () => {
		const expected = fakeModel("google", "gemini-2.5-pro");
		mockGetModel.mockReturnValue(expected);

		const result = resolveModel("gemini");

		expect(mockGetModel).toHaveBeenCalledWith("google", "gemini-2.5-pro");
		expect(result).toBe(expected);
	});

	it('resolves "o3" to openai o3', () => {
		const expected = fakeModel("openai", "o3");
		mockGetModel.mockReturnValue(expected);

		const result = resolveModel("o3");

		expect(mockGetModel).toHaveBeenCalledWith("openai", "o3");
		expect(result).toBe(expected);
	});
});

// ---------------------------------------------------------------------------
// resolveModel — unknown alias fallback
// ---------------------------------------------------------------------------

describe("resolveModel — unknown alias", () => {
	it("tries anthropic provider for unknown alias", () => {
		const expected = fakeModel("anthropic", "claude-custom-model");
		mockGetModel.mockReturnValue(expected);

		const result = resolveModel("claude-custom-model");

		expect(mockGetModel).toHaveBeenCalledWith(
			"anthropic",
			"claude-custom-model",
		);
		expect(result).toBe(expected);
	});

	it("throws descriptive error when anthropic rejects the unknown alias", () => {
		mockGetModel.mockImplementation(() => {
			throw new Error("Unknown model");
		});

		expect(() => resolveModel("totally-unknown-alias")).toThrow(
			/totally-unknown-alias/,
		);
	});

	it("error message for unknown alias mentions the alias", () => {
		mockGetModel.mockImplementation(() => {
			throw new Error("Unknown model");
		});

		let caughtMessage = "";
		try {
			resolveModel("my-bad-alias");
		} catch (err) {
			caughtMessage = err instanceof Error ? err.message : String(err);
		}

		expect(caughtMessage).toContain("my-bad-alias");
	});
});

// ---------------------------------------------------------------------------
// autoDetectModel — provider priority
// ---------------------------------------------------------------------------

describe("autoDetectModel", () => {
	it("picks anthropic when ANTHROPIC_API_KEY is set", () => {
		const expected = fakeModel("anthropic", "claude-sonnet-4-6");
		mockGetModel.mockReturnValue(expected);

		const result = autoDetectModel({ ANTHROPIC_API_KEY: "sk-ant-key" });

		expect(mockGetModel).toHaveBeenCalledWith("anthropic", "claude-sonnet-4-6");
		expect(result).toBe(expected);
	});

	it("picks openai when OPENAI_API_KEY is set (no anthropic key)", () => {
		const expected = fakeModel("openai", "gpt-4.1");
		mockGetModel.mockReturnValue(expected);

		const result = autoDetectModel({ OPENAI_API_KEY: "sk-openai-key" });

		expect(mockGetModel).toHaveBeenCalledWith("openai", "gpt-4.1");
		expect(result).toBe(expected);
	});

	it("picks google when GOOGLE_API_KEY is set (no higher-priority keys)", () => {
		const expected = fakeModel("google", "gemini-2.5-pro");
		mockGetModel.mockReturnValue(expected);

		const result = autoDetectModel({ GOOGLE_API_KEY: "google-key" });

		expect(mockGetModel).toHaveBeenCalledWith("google", "gemini-2.5-pro");
		expect(result).toBe(expected);
	});

	it("picks google when GOOGLE_GENERATIVE_AI_API_KEY is set (no higher-priority keys)", () => {
		const expected = fakeModel("google", "gemini-2.5-pro");
		mockGetModel.mockReturnValue(expected);

		const result = autoDetectModel({
			GOOGLE_GENERATIVE_AI_API_KEY: "google-gen-key",
		});

		expect(mockGetModel).toHaveBeenCalledWith("google", "gemini-2.5-pro");
		expect(result).toBe(expected);
	});

	it("picks openrouter when OPENROUTER_API_KEY is set (no higher-priority keys)", () => {
		const expected = fakeModel("openrouter", "anthropic/claude-sonnet-4-6");
		mockGetModel.mockReturnValue(expected);

		const result = autoDetectModel({ OPENROUTER_API_KEY: "or-key" });

		expect(mockGetModel).toHaveBeenCalledWith(
			"openrouter",
			"anthropic/claude-sonnet-4-6",
		);
		expect(result).toBe(expected);
	});

	it("anthropic takes priority over openai when both keys are set", () => {
		const expected = fakeModel("anthropic", "claude-sonnet-4-6");
		mockGetModel.mockReturnValue(expected);

		const result = autoDetectModel({
			ANTHROPIC_API_KEY: "sk-ant-key",
			OPENAI_API_KEY: "sk-openai-key",
		});

		expect(mockGetModel).toHaveBeenCalledWith("anthropic", "claude-sonnet-4-6");
		expect(result).toBe(expected);
	});

	it("openai takes priority over google when both keys are set", () => {
		const expected = fakeModel("openai", "gpt-4.1");
		mockGetModel.mockReturnValue(expected);

		const result = autoDetectModel({
			OPENAI_API_KEY: "sk-openai-key",
			GOOGLE_API_KEY: "google-key",
		});

		expect(mockGetModel).toHaveBeenCalledWith("openai", "gpt-4.1");
		expect(result).toBe(expected);
	});

	it("google takes priority over openrouter when both keys are set", () => {
		const expected = fakeModel("google", "gemini-2.5-pro");
		mockGetModel.mockReturnValue(expected);

		const result = autoDetectModel({
			GOOGLE_API_KEY: "google-key",
			OPENROUTER_API_KEY: "or-key",
		});

		expect(mockGetModel).toHaveBeenCalledWith("google", "gemini-2.5-pro");
		expect(result).toBe(expected);
	});

	it("throws when no env vars are set", () => {
		expect(() => autoDetectModel({})).toThrow();
	});

	it("error message when no env vars lists required env var names", () => {
		let caughtMessage = "";
		try {
			autoDetectModel({});
		} catch (err) {
			caughtMessage = err instanceof Error ? err.message : String(err);
		}

		expect(caughtMessage).toContain("ANTHROPIC_API_KEY");
		expect(caughtMessage).toContain("OPENAI_API_KEY");
	});
});

// ---------------------------------------------------------------------------
// resolveModelFromConfig
// ---------------------------------------------------------------------------

describe("resolveModelFromConfig", () => {
	it("calls resolveModel when config.model is set", () => {
		const expected = fakeModel("anthropic", "claude-sonnet-4-6");
		mockGetModel.mockReturnValue(expected);

		const result = resolveModelFromConfig({ model: "sonnet" }, {});

		expect(mockGetModel).toHaveBeenCalledWith("anthropic", "claude-sonnet-4-6");
		expect(result).toBe(expected);
	});

	it("calls autoDetectModel when config.model is not set", () => {
		const expected = fakeModel("anthropic", "claude-sonnet-4-6");
		mockGetModel.mockReturnValue(expected);

		const result = resolveModelFromConfig(
			{},
			{ ANTHROPIC_API_KEY: "sk-ant-key" },
		);

		expect(mockGetModel).toHaveBeenCalledWith("anthropic", "claude-sonnet-4-6");
		expect(result).toBe(expected);
	});

	it("calls autoDetectModel when config.model is undefined", () => {
		const expected = fakeModel("openai", "gpt-4.1");
		mockGetModel.mockReturnValue(expected);

		const result = resolveModelFromConfig(
			{ model: undefined },
			{ OPENAI_API_KEY: "sk-openai-key" },
		);

		expect(mockGetModel).toHaveBeenCalledWith("openai", "gpt-4.1");
		expect(result).toBe(expected);
	});
});
