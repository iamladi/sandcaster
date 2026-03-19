# Code Reviewer

Agent reviews code for bugs, security issues, and maintainability — outputs structured JSON findings.

## Prerequisites

- sandcaster CLI installed (from monorepo: `cd apps/cli && bun link`)

## Setup

```bash
export E2B_API_KEY="your-key"       # https://e2b.dev/dashboard
export OPENAI_API_KEY="your-key"    # https://platform.openai.com/api-keys
```

## Run

```bash
sandcaster -f sample-code/auth.ts "Review the uploaded code for bugs and security issues"
```

## What Happens

The agent reads files in `sample-code/`, identifies bugs and security vulnerabilities, and returns a structured JSON report with severity, category, file, line, and remediation for each finding.

## Configuration

See `sandcaster.json` for the full configuration. Key settings:
- `model`: gpt5 (OpenAI gpt-5.4 — cost-efficient default)
- `allowedTools`: Read, Glob, Grep (file access only — no shell)
- `outputFormat`: JSON schema for structured findings report

## Troubleshooting

- **"No LLM provider API key found"**: Set `OPENAI_API_KEY` in your environment
- **"E2B_API_KEY not set"**: Get a key at https://e2b.dev/dashboard
- **Model not available**: Replace `gpt5` with `sonnet` or `haiku` in sandcaster.json
