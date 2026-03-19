# Structured Output

Agent extracts TODO comments from code and returns categorized, prioritized results as structured JSON.

## Prerequisites

- sandcaster CLI installed (from monorepo: `cd apps/cli && bun link`)

## Setup

```bash
export E2B_API_KEY="your-key"       # https://e2b.dev/dashboard
export OPENAI_API_KEY="your-key"    # https://platform.openai.com/api-keys
```

## Run

```bash
sandcaster -f sample-code/app.ts -f sample-code/utils.ts "Extract all TODO items from the uploaded files"
```

## What Happens

The agent scans files in `sample-code/`, finds TODO comments, categorizes each by priority and type (security, performance, feature, refactor, testing), and returns a structured JSON report with a summary.

## Configuration

See `sandcaster.json` for the full configuration. Key settings:
- `model`: gpt5 (OpenAI gpt-5.4 — cost-efficient default)
- `allowedTools`: Read, Glob, Grep (file access only)
- `outputFormat`: JSON schema defining the exact shape of TODO extraction output

## Troubleshooting

- **"No LLM provider API key found"**: Set `OPENAI_API_KEY` in your environment
- **"E2B_API_KEY not set"**: Get a key at https://e2b.dev/dashboard
- **Model not available**: Replace `gpt5` with `sonnet` or `haiku` in sandcaster.json
