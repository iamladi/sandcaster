# Provider: Docker

Hello-world agent running on local Docker — no cloud account needed.

## Prerequisites

- sandcaster CLI installed (from monorepo: `cd apps/cli && bun link`)
- Docker daemon running locally
- `sandcaster-sandbox` Docker image (see Setup below)

## Setup

Build the sandbox image (one-time):
```bash
docker build -t sandcaster-sandbox - <<'DOCKERFILE'
FROM node:24
RUN mkdir -p /opt/sandcaster /workspace && cd /opt/sandcaster && npm init -y \
  && npm install @mariozechner/pi-ai@0.57.1 @mariozechner/pi-agent-core@0.57.1 @sinclair/typebox@0.34.48 \
  && chown -R node:node /opt/sandcaster /workspace
USER node
WORKDIR /workspace
CMD ["sleep", "infinity"]
DOCKERFILE
```

```bash
export OPENAI_API_KEY="your-key"    # https://platform.openai.com/api-keys
# No cloud API key needed — Docker runs locally
```

## Run

```bash
sandcaster "Hello, what can you do?"
```

## What Happens

Same as 01-hello-sandbox, but the agent runs inside a local Docker container. No cloud sandbox account required. The only config difference is `"sandboxProvider": "docker"`.

## Configuration

See `sandcaster.json` for the full configuration. Key settings:
- `model`: gpt5 (OpenAI gpt-5.4 — cost-efficient default)
- `sandboxProvider`: docker

## Troubleshooting

- **"No LLM provider API key found"**: Set `OPENAI_API_KEY` in your environment
- **Docker connection errors**: Ensure Docker daemon is running (`docker info`)
- **Model not available**: Replace `gpt5` with `sonnet` or `haiku` in sandcaster.json
