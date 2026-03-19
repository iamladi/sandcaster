# Generate Tests

Agent generates a test suite for untested code, using branching to try multiple testing strategies and pick the best.

## Prerequisites

- sandcaster CLI installed (from monorepo: `cd apps/cli && bun link`)

## Setup

```bash
export E2B_API_KEY="your-key"       # https://e2b.dev/dashboard
export OPENAI_API_KEY="your-key"    # https://platform.openai.com/api-keys
```

## Run

```bash
sandcaster -f sample-code/utils.ts "Write tests for the uploaded utils.ts"
```

## What Happens

Sandcaster spawns 3 parallel branches, each independently writing tests for the utility module. An LLM judge evaluates coverage, edge-case handling, and readability, then selects the best test suite.

## Configuration

See `sandcaster.json` for the full configuration. Key settings:
- `model`: gpt5 (OpenAI gpt-5.4 — cost-efficient default)
- `branching`: 3 parallel branches with LLM judge evaluation
- `allowedTools`: Read, Glob, Grep, Bash (can run tests in sandbox)

## Troubleshooting

- **"No LLM provider API key found"**: Set `OPENAI_API_KEY` in your environment
- **"E2B_API_KEY not set"**: Get a key at https://e2b.dev/dashboard
- **Model not available**: Replace `gpt5` with `sonnet` or `haiku` in sandcaster.json
