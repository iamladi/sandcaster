# Provider: Cloudflare

Hello-world agent running on Cloudflare Containers via the `@cloudflare/sandbox` SDK.

**Status**: Container creation, file I/O, and command execution work. The runner starts but output streaming from long-running commands needs work in the Cloudflare provider.

## Prerequisites

- sandcaster CLI installed (from monorepo: `cd apps/cli && bun link`)
- Cloudflare account with Containers access (beta)

## Setup

1. Deploy the sandbox worker (from monorepo):
```bash
cd packages/cloudflare-worker
bunx wrangler deploy
```

2. Set the worker's `API_KEY` secret (must match your `CLOUDFLARE_API_TOKEN`):
```bash
echo "your-cloudflare-api-token" | bunx wrangler secret put API_KEY
```

3. Set environment variables:
```bash
export CLOUDFLARE_API_TOKEN="your-token"                  # https://dash.cloudflare.com/profile/api-tokens
export CLOUDFLARE_SANDBOX_WORKER_URL="https://your.url"   # URL from wrangler deploy output
export OPENAI_API_KEY="your-key"                          # https://platform.openai.com/api-keys
```

## Run

```bash
sandcaster "Hello, what can you do?"
```

## What Happens

Same as 01-hello-sandbox, but the agent runs inside a Cloudflare Container. The worker uses `@cloudflare/sandbox` SDK to manage container lifecycle, execute commands, and handle file I/O.

## Configuration

See `sandcaster.json` for the full configuration. Key settings:
- `model`: gpt5 (OpenAI gpt-5.4)
- `sandboxProvider`: cloudflare

## Troubleshooting

- **"No LLM provider API key found"**: Set `OPENAI_API_KEY` in your environment
- **401 Unauthorized**: Ensure `API_KEY` worker secret matches `CLOUDFLARE_API_TOKEN`
- **Model not available**: Replace `gpt5` with `sonnet` or `haiku` in sandcaster.json
