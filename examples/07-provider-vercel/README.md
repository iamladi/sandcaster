# Provider: Vercel

Hello-world agent running on Vercel Sandbox instead of E2B.

**Status**: Vercel Sandbox works at the SDK level but has a CLI integration issue being tracked. Use `sandcaster init` + E2B or Docker for production use.

## Prerequisites

- sandcaster CLI installed (from monorepo: `cd apps/cli && bun link`)
- A Vercel project linked locally

## Setup

1. Link your Vercel project (one-time):
```bash
npx vercel link
npx vercel env pull
```

2. Set environment variables:
```bash
export OPENAI_API_KEY="your-key"    # https://platform.openai.com/api-keys
```

## Run

```bash
sandcaster "Hello, what can you do?"
```

## What Happens

Same as 01-hello-sandbox, but the agent runs inside a Vercel Sandbox. The only config difference is `"sandboxProvider": "vercel"`.

## Configuration

See `sandcaster.json` for the full configuration. Key settings:
- `model`: gpt5 (OpenAI gpt-5.4)
- `sandboxProvider`: vercel

## Troubleshooting

- **"Could not get credentials from OIDC context"**: Run `npx vercel link` then `npx vercel env pull`
- **"No LLM provider API key found"**: Set `OPENAI_API_KEY` in your environment
- **Model not available**: Replace `gpt5` with `sonnet` or `haiku` in sandcaster.json
