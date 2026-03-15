import { getModel, type Model } from "@mariozechner/pi-ai";

// ---------------------------------------------------------------------------
// Known alias map
// ---------------------------------------------------------------------------

const ALIAS_MAP: Record<string, { provider: string; modelId: string }> = {
	sonnet: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
	opus: { provider: "anthropic", modelId: "claude-opus-4-6" },
	haiku: { provider: "anthropic", modelId: "claude-haiku-4-5" },
	gpt5: { provider: "openai", modelId: "gpt-5.4" },
	gemini: { provider: "google", modelId: "gemini-3.1-pro-preview" },
};

// ---------------------------------------------------------------------------
// resolveModel
// ---------------------------------------------------------------------------

/**
 * Maps a short alias to a Pi-mono Model object.
 *
 * Known aliases are resolved directly. Unknown aliases are tried against the
 * anthropic provider. If that also fails, a descriptive error is thrown.
 */
export function resolveModel(alias: string): Model<any> {
	const known = ALIAS_MAP[alias];
	if (known) {
		return getModel(known.provider as any, known.modelId as any);
	}

	// Unknown alias: try anthropic as a fallback
	try {
		return getModel("anthropic" as any, alias as any);
	} catch {
		throw new Error(
			`Unknown model alias "${alias}". ` +
				`Known aliases: ${Object.keys(ALIAS_MAP).join(", ")}. ` +
				`For custom models, specify the full provider/model ID.`,
		);
	}
}

// ---------------------------------------------------------------------------
// autoDetectModel
// ---------------------------------------------------------------------------

/**
 * Picks the first available provider based on env vars. Priority order:
 * ANTHROPIC_API_KEY > OPENAI_API_KEY > GOOGLE_API_KEY | GOOGLE_GENERATIVE_AI_API_KEY > OPENROUTER_API_KEY
 */
export function autoDetectModel(
	env: Record<string, string | undefined>,
): Model<any> {
	if (env.ANTHROPIC_API_KEY) {
		return getModel("anthropic" as any, "claude-sonnet-4-6" as any);
	}

	if (env.OPENAI_API_KEY) {
		return getModel("openai" as any, "gpt-5.4" as any);
	}

	if (env.GOOGLE_API_KEY ?? env.GOOGLE_GENERATIVE_AI_API_KEY) {
		return getModel("google" as any, "gemini-3.1-pro-preview" as any);
	}

	if (env.OPENROUTER_API_KEY) {
		return getModel("openrouter" as any, "anthropic/claude-sonnet-4-6" as any);
	}

	throw new Error(
		"No LLM provider API key found. Set one of: " +
			"ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY, " +
			"GOOGLE_GENERATIVE_AI_API_KEY, OPENROUTER_API_KEY.",
	);
}

// ---------------------------------------------------------------------------
// resolveModelFromConfig
// ---------------------------------------------------------------------------

/**
 * Convenience: resolves model from config if present, otherwise auto-detects.
 */
export function resolveModelFromConfig(
	config: { model?: string },
	env: Record<string, string | undefined>,
): Model<any> {
	if (config.model) {
		return resolveModel(config.model);
	}
	return autoDetectModel(env);
}
