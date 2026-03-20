# 15 — Chat Bot

Connect Sandcaster to Slack, Discord, or Telegram. Two modes:

- **CLI mode** — `sandcaster chat start` (zero code, uses `sandcaster.json`)
- **Gateway mode** — standalone Hono server with webhook routes (production-ready)

## Quick Start (CLI)

```bash
# Required for sandbox + LLM
export E2B_API_KEY=...
export ANTHROPIC_API_KEY=...   # this example uses model: "sonnet"

# Set at least one platform token
export SLACK_BOT_TOKEN=xoxb-...
export SLACK_APP_TOKEN=xapp-...
export SLACK_SIGNING_SECRET=...

# Start the bot
cd examples/15-chat-bot
sandcaster chat start
```

## Production Gateway

```bash
cd examples/15-chat-bot/gateway
cp .env.sample .env   # fill in your tokens
bun install
bun run dev            # development
# or
bun run build && bun run start  # production
```

Endpoints:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/webhooks/slack` | Slack event webhook |
| `POST` | `/webhooks/discord` | Discord interaction webhook |
| `POST` | `/webhooks/telegram` | Telegram update webhook |

## Architecture

```
mention/message → Chat adapter → SessionManager → Sandbox → Agent → streaming response
                                      ↓
                                 SessionPool (thread ↔ session mapping)
```

1. A user mentions `@sandcaster` (or replies to an existing thread)
2. The chat adapter routes the message to the appropriate handler
3. `SessionManager` creates or reuses a sandbox session
4. The agent runs inside the sandbox and streams responses back
5. If a session expires, the next message rebuilds context from thread history

## Platform Setup

### Slack

1. Create a Slack app at https://api.slack.com/apps
2. Enable **Socket Mode** and generate an app-level token (`xapp-...`)
3. Add **Bot Token Scopes**: `app_mentions:read`, `chat:write`, `channels:history`
4. Subscribe to **Events**: `app_mention`, `message.channels`
5. Install to workspace and copy the bot token (`xoxb-...`) and signing secret

### Discord

1. Create an application at https://discord.com/developers/applications
2. Create a bot and copy the token
3. Copy the **Public Key** from the General Information page
4. Set the **Interactions Endpoint URL** to `https://your-host/webhooks/discord`
5. Invite the bot with `applications.commands` and `bot` scopes

### Telegram

1. Message [@BotFather](https://t.me/BotFather) and create a new bot
2. Copy the bot token
3. Set the webhook URL with a secret token for authentication:
   ```
   https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://your-host/webhooks/telegram&secret_token=<SECRET>
   ```
4. Set `TELEGRAM_WEBHOOK_SECRET` to the same `<SECRET>` value in your environment

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SLACK_BOT_TOKEN` | For Slack | Bot user OAuth token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | For Slack | App-level token for Socket Mode (`xapp-...`) |
| `SLACK_SIGNING_SECRET` | For Slack | Request signing secret |
| `DISCORD_BOT_TOKEN` | For Discord | Bot token |
| `DISCORD_PUBLIC_KEY` | For Discord | Application public key |
| `TELEGRAM_BOT_TOKEN` | For Telegram | Bot token from BotFather |
| `E2B_API_KEY` | Yes | E2B sandbox API key |
| `OPENAI_API_KEY` | Depends | Required if using `gpt5` model |
| `ANTHROPIC_API_KEY` | Depends | Required if using `sonnet`/`haiku` model |
| `PORT` | No | Gateway server port (default: `8080`) |
| `SANDCASTER_CHAT_SESSION_TIMEOUT_MS` | No | Session idle timeout in ms (default: `600000`) |

## Configuration (`sandcaster.json`)

| Field | Type | Description |
|-------|------|-------------|
| `systemPrompt` | `string` | System prompt for the agent |
| `model` | `string` | LLM model alias (`sonnet`, `gpt5`, etc.) |
| `sandboxProvider` | `string` | Sandbox provider (`e2b`, `docker`, etc.) |
| `chat.botName` | `string` | Bot display name (default: `sandcaster`) |
| `chat.sessionTimeoutMs` | `number` | Session idle timeout in ms (default: `600000`) |
| `chat.allowedChannels` | `string[]` | Restrict to specific channel IDs |
| `chat.allowedUsers` | `string[]` | Restrict to specific user IDs |

## Troubleshooting

- **"No chat platforms configured"** — Set at least one platform's env vars (see table above)
- **"No sandcaster.json found"** — Run from the example directory, or the parent of `gateway/`
- **Bot doesn't respond** — Verify the bot is invited to the channel and has the required scopes
- **Webhook 401/403** — Check signing secret (Slack) or public key (Discord) matches
