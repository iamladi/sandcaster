# Multi-Agent Security Audit

Coordinated sub-agents (dependency scanner, code scanner, config scanner) perform a comprehensive security review.

## Prerequisites

- sandcaster CLI installed (from monorepo: `cd apps/cli && bun link`)

## Setup

```bash
export E2B_API_KEY="your-key"       # https://e2b.dev/dashboard
export OPENAI_API_KEY="your-key"    # https://platform.openai.com/api-keys
```

## Run

```bash
sandcaster -f sample-app/server.ts -f sample-app/package.json -f sample-app/Dockerfile "Perform a security audit of the uploaded code"
```

## What Happens

The lead agent delegates to three sub-agents: dependency-scanner (checks package.json for CVEs), code-scanner (OWASP Top 10 static analysis), and config-scanner (Dockerfile misconfigurations). Results are synthesized into a unified vulnerability report.

## Configuration

See `sandcaster.json` for the full configuration. Key settings:
- `model`: gpt5 (OpenAI gpt-5.4 — cost-efficient default)
- `agents`: 3 sub-agents with specialized prompts and tool sets
- `outputFormat`: JSON schema for vulnerability report with severity and CWE IDs

## Troubleshooting

- **"No LLM provider API key found"**: Set `OPENAI_API_KEY` in your environment
- **"E2B_API_KEY not set"**: Get a key at https://e2b.dev/dashboard
- **Model not available**: Replace `gpt5` with `sonnet` or `haiku` in sandcaster.json
