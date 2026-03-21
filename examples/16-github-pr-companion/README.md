# 16 — GitHub PR Review Companion

A webhook-driven bot that automatically reacts to review bot comments (CodeRabbit, Copilot, SonarCloud), applies code fixes in an E2B sandbox, and replies to each comment.

## How it works

```
GitHub webhook (pull_request_review)
        │
        ▼
┌──────────────────────────────┐
│  Gateway (Hono server)       │
│  1. Verify HMAC signature    │
│  2. Filter by bot allowlist  │
│  3. Fetch review comments    │
│  4. Pre-clone repo           │
└───────────┬──────────────────┘
            │
            ▼
┌──────────────────────────────┐
│  E2B Sandbox (agent)         │
│  1. Read affected files      │
│  2. Apply fixes              │
│  3. Output structured JSON   │
│  (No GitHub token inside!)   │
└───────────┬──────────────────┘
            │
            ▼
┌──────────────────────────────┐
│  Gateway (trusted code)      │
│  1. Apply patches to clone   │
│  2. Commit & push            │
│  3. Reply to each comment    │
└──────────────────────────────┘
```

Write token never enters the sandbox (prompt injection mitigation).

## Quick Start (PAT)

For local development with a Personal Access Token.

### 1. Prerequisites

- [Bun](https://bun.sh) installed
- A GitHub repo with a review bot (CodeRabbit, Copilot, etc.)
- [smee.io](https://smee.io) channel for webhook forwarding

### 2. Environment

```bash
cp .env.sample .env
```

Fill in:

```
GITHUB_TOKEN=ghp_...           # PAT with repo scope
GITHUB_WEBHOOK_SECRET=...      # Random string (also set in GitHub webhook config)
E2B_API_KEY=...                # From https://e2b.dev/dashboard
OPENAI_API_KEY=...             # For the agent inside the sandbox
```

### 3. Start webhook forwarding

```bash
npx smee-client --url https://smee.io/YOUR_CHANNEL --target http://localhost:8080/webhooks/github
```

### 4. Start the gateway

```bash
cd gateway
bun run dev
```

### 5. Configure GitHub webhook

In your repo's Settings > Webhooks:
- **Payload URL**: Your smee.io channel URL
- **Content type**: `application/json`
- **Secret**: Same value as `GITHUB_WEBHOOK_SECRET`
- **Events**: Select "Pull request reviews"

### 6. Test it

Open a PR and wait for a review bot to comment. The gateway will process the review and reply to each comment.

## Production Setup (GitHub App)

For production deployments with proper permissions and verified commits.

### 1. Create a GitHub App

In GitHub Settings > Developer settings > GitHub Apps > New:

**Permissions:**
- Pull requests: Read & Write
- Contents: Read & Write (for pushing commits)
- Metadata: Read-only

**Events:**
- Pull request review

### 2. Install the App

Install it on the target repository/organization.

### 3. Environment

```bash
cp .env.sample .env
```

Fill in:

```
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_APP_INSTALLATION_ID=12345678
GITHUB_WEBHOOK_SECRET=...
E2B_API_KEY=...
OPENAI_API_KEY=...
```

The gateway auto-generates JWTs and refreshes installation tokens (cached for 50 min).

### 4. Deploy and configure webhook

Point the GitHub App's webhook URL to your deployed gateway's `/webhooks/github` endpoint.

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_WEBHOOK_SECRET` | Yes | HMAC-SHA256 webhook secret |
| `E2B_API_KEY` | Yes | E2B sandbox API key |
| `OPENAI_API_KEY` | Yes | LLM provider key (for agent) |
| `GITHUB_TOKEN` | PAT mode | Personal Access Token |
| `GITHUB_APP_ID` | App mode | GitHub App ID |
| `GITHUB_APP_PRIVATE_KEY` | App mode | GitHub App private key (PEM) |
| `GITHUB_APP_INSTALLATION_ID` | App mode | GitHub App installation ID |
| `PORT` | No | Server port (default: 8080) |
| `BOT_ALLOWLIST` | No | Comma-separated bot logins (default: coderabbitai[bot], github-copilot[bot], github-advanced-security[bot]) |
| `OWN_BOT_LOGIN` | No | Companion's own bot login for self-loop prevention |

### sandcaster.json

The `sandcaster.json` configures the agent that runs inside the sandbox. It includes a system prompt tuned for batch code fixing and a JSON output schema.

## Security

- **Webhook signatures**: HMAC-SHA256 verified on every request (required in all modes)
- **Token isolation**: The GitHub write token never enters the sandbox. The agent produces patches as structured JSON; the gateway applies them.
- **Bot loop prevention**: Login-based allowlist + explicit self-loop check
- **Reply pacing**: 1-second delay between replies to avoid GitHub secondary rate limits

## Limitations

- Best-effort processing: no durable job queue (process crash loses in-flight jobs)
- No persistent storage (in-memory dedup with TTL)
- No GraphQL thread resolution (future enhancement)
- One installation per gateway instance

## Troubleshooting

- **"Invalid signature" 401**: Check that `GITHUB_WEBHOOK_SECRET` matches your GitHub webhook configuration
- **Bot not responding**: Verify the bot's login is in `BOT_ALLOWLIST` (check exact format including `[bot]` suffix)
- **Fork PRs**: The gateway attempts to push but may fail if "Allow edits from maintainers" is disabled
- **Rate limits**: The gateway uses 1s delay between replies. Reviews with >10 comments are chunked into sequential sandbox runs of 10 comments each
