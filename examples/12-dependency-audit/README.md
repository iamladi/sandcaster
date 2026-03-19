# Dependency Audit

Agent audits npm dependencies for known CVEs and produces a prioritized vulnerability report.

## Prerequisites

- sandcaster CLI installed (from monorepo: `cd apps/cli && bun link`)

## Setup

```bash
export E2B_API_KEY="your-key"       # https://e2b.dev/dashboard
export OPENAI_API_KEY="your-key"    # https://platform.openai.com/api-keys
```

## Run

```bash
sandcaster -f sample-code/package.json "Audit the dependencies in the uploaded package.json"
```

## What Happens

The agent reads `sample-code/package.json`, identifies packages with known CVEs, and returns a structured JSON report with severity, CVE IDs, and recommended fix versions.

## Configuration

See `sandcaster.json` for the full configuration. Key settings:
- `model`: gpt5 (OpenAI gpt-5.4 — cost-efficient default)
- `allowedTools`: Read, Glob, Grep, Bash (can run `npm audit` in sandbox)
- `outputFormat`: JSON schema for vulnerability report

## Troubleshooting

- **"No LLM provider API key found"**: Set `OPENAI_API_KEY` in your environment
- **"E2B_API_KEY not set"**: Get a key at https://e2b.dev/dashboard
- **Model not available**: Replace `gpt5` with `sonnet` or `haiku` in sandcaster.json
