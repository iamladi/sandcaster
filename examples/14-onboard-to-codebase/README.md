# Onboard to Codebase

Agent reads a codebase and produces a structured architecture overview.

## Prerequisites

- sandcaster CLI installed (from monorepo: `cd apps/cli && bun link`)

## Setup

```bash
export E2B_API_KEY="your-key"       # https://e2b.dev/dashboard
export OPENAI_API_KEY="your-key"    # https://platform.openai.com/api-keys
```

## Run

```bash
sandcaster "Explain the architecture of this codebase"
```

## What Happens

The agent reads the project structure, entry points, key files, and dependencies, then produces a structured JSON report covering the tech stack, module map, entry points, data flow, and design patterns.

## Configuration

See `sandcaster.json` for the full configuration. Key settings:
- `model`: gpt5 (OpenAI gpt-5.4 — cost-efficient default)
- `maxTurns`: 20 (enough for thorough codebase exploration)
- `allowedTools`: Read, Glob, Grep (read-only analysis)
- `outputFormat`: JSON schema for architecture report

## Troubleshooting

- **"No LLM provider API key found"**: Set `OPENAI_API_KEY` in your environment
- **"E2B_API_KEY not set"**: Get a key at https://e2b.dev/dashboard
- **Model not available**: Replace `gpt5` with `sonnet` or `haiku` in sandcaster.json
