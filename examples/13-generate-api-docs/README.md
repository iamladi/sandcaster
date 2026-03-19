# Generate API Docs

Agent reads source code and generates structured API documentation.

## Prerequisites

- sandcaster CLI installed (from monorepo: `cd apps/cli && bun link`)

## Setup

```bash
export E2B_API_KEY="your-key"       # https://e2b.dev/dashboard
export OPENAI_API_KEY="your-key"    # https://platform.openai.com/api-keys
```

## Run

```bash
sandcaster -f sample-code/api.ts "Generate API documentation for the uploaded code"
```

## What Happens

The agent reads the Hono API in `sample-code/`, identifies all endpoints, and returns structured JSON documentation with methods, paths, parameters, request bodies, and response formats.

## Configuration

See `sandcaster.json` for the full configuration. Key settings:
- `model`: gpt5 (OpenAI gpt-5.4 — cost-efficient default)
- `allowedTools`: Read, Glob, Grep (read-only analysis)
- `outputFormat`: JSON schema for structured endpoint documentation

## Troubleshooting

- **"No LLM provider API key found"**: Set `OPENAI_API_KEY` in your environment
- **"E2B_API_KEY not set"**: Get a key at https://e2b.dev/dashboard
- **Model not available**: Replace `gpt5` with `sonnet` or `haiku` in sandcaster.json
