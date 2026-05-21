[![CI](https://github.com/iamladi/sandcaster/actions/workflows/ci.yml/badge.svg)](https://github.com/iamladi/sandcaster/actions/workflows/ci.yml)
[![npm: sdk](https://img.shields.io/npm/v/@sandcaster/sdk?label=sdk)](https://www.npmjs.com/package/@sandcaster/sdk)
[![npm: cli](https://img.shields.io/npm/v/@sandcaster/cli?label=cli)](https://www.npmjs.com/package/@sandcaster/cli)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9+-blue.svg)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.2+-f472b6.svg)](https://bun.sh/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

# Sandcaster

Open-source runtime for general-purpose AI agents in isolated sandboxes.

CLI, API, TypeScript SDK, and chat bots (Slack, Discord, Telegram) with streaming, file uploads, and config-driven behavior.

Built on [Pi-mono](https://github.com/badlogic/pi-mono) for multi-provider LLM orchestration and pluggable sandbox backends ([E2B](https://e2b.dev), [Vercel](https://vercel.com/docs/sandbox), Docker, [Cloudflare Containers](https://developers.cloudflare.com/containers/)).

Sandcaster is a TypeScript rewrite of [Sandstorm](https://github.com/tomascupr/sandstorm) for people who want real agent work, not a chat wrapper:

- Research Acme's competitors, crawl their sites and recent news, and write a one-page branded briefing PDF with sources
- Analyze uploaded transcripts or PDFs
- Triage incoming support tickets
- Run a security audit with coordinated sub-agents across multiple sandboxes
- Turn docs into a draft OpenAPI spec
- Deploy a chat bot that runs sandboxed agents from Slack, Discord, or Telegram

## Terminal demo

```bash
$ sandcaster init research-brief
$ cd research-brief
$ sandcaster "Research Acme's competitors, crawl their sites and recent news, and write a one-page branded briefing PDF with sources."

[tool: web_fetch]
[tool: web_fetch]
[tool: file_write]
[file: briefing.pdf]
[tool: file_write]
[file: reports/sources.md]

Analyzed 5 competitor sites and recent coverage. Briefing and sources written.

✓ Completed · sonnet · 12 turns · $0.043 · 38s
```

The point is not that an agent can answer a question. It starts from a runnable starter, gets a
fresh sandbox, can read uploads or crawl the web, writes artifacts like `briefing.pdf`, streams
its work in a rich TUI, and tears itself down when the run is done.

## 60-second path

```bash
# from npm
npx @sandcaster/cli init hello-sandbox
cd hello-sandbox
npx @sandcaster/cli "What can you do in this sandbox?"

# or from source
git clone https://github.com/iamladi/sandcaster.git
cd sandcaster
bun install && bunx turbo build
cd apps/cli && bun link      # registers the `sandcaster` command globally

sandcaster init hello-sandbox
cd hello-sandbox
sandcaster "What can you do in this sandbox?"
```

`sandcaster init <starter>` scaffolds a runnable project with `sandcaster.json`, a README,
`.env.example`, and any starter-specific assets. If provider env vars are detected in your shell,
Sandcaster writes `.env` automatically.

```bash
sandcaster init --list              # list all starters
sandcaster init research-brief      # scaffold into ./research-brief
sandcaster init security-audit my-audit  # scaffold into ./my-audit
```

## Examples

15 copy-paste-ready examples in [`examples/`](examples/):

| # | Example | What it does |
|---|---------|--------------|
| 01 | [hello-sandbox](examples/01-hello-sandbox/) | Minimal agent in a sandbox |
| 02 | [code-reviewer](examples/02-code-reviewer/) | Code review with structured JSON output |
| 03 | [competitive-analysis](examples/03-competitive-analysis/) | Market research with web crawling |
| 04 | [structured-output](examples/04-structured-output/) | Extract TODOs with JSON schema |
| 05 | [multi-agent-security-audit](examples/05-multi-agent-security-audit/) | Coordinated sub-agents for security review |
| 06 | [speculative-branching](examples/06-speculative-branching/) | Multiple approaches evaluated by LLM judge |
| 07 | [provider-vercel](examples/07-provider-vercel/) | Run on Vercel Sandbox |
| 08 | [provider-cloudflare](examples/08-provider-cloudflare/) | Run on Cloudflare Containers |
| 09 | [provider-docker](examples/09-provider-docker/) | Run on local Docker |
| 10 | [fix-ci-failure](examples/10-fix-ci-failure/) | Debug CI logs and propose a fix |
| 11 | [generate-tests](examples/11-generate-tests/) | Generate test suite with branching strategies |
| 12 | [dependency-audit](examples/12-dependency-audit/) | Audit deps for CVEs, produce prioritized report |
| 13 | [generate-api-docs](examples/13-generate-api-docs/) | Generate OpenAPI spec from source code |
| 14 | [onboard-to-codebase](examples/14-onboard-to-codebase/) | Produce architecture overview of a codebase |
| 15 | [chat-bot](examples/15-chat-bot/) | Chat bot with Slack/Discord/Telegram + HTTP gateway |

## Why Sandcaster exists

Most agent projects break down in one of two ways:

- You wire the SDK yourself and end up rebuilding sandbox lifecycle, file uploads, streaming,
  config loading, and starter setup.
- You use an agent framework that is good at orchestration but weak at actually shipping a
  runnable agent product path.

Sandcaster is opinionated about the missing middle:

- starter to runnable project in one command
- fresh sandbox per request with teardown by default
- CLI, API, and chat bots over the same runtime
- config-driven behavior through `sandcaster.json`
- multi-model support across Anthropic, OpenAI, Google, and OpenRouter
- sub-agent orchestration with configurable tools and models per agent
- speculative branching: run multiple approaches in parallel, pick the best with an LLM judge
- composite sandboxes: agent-driven multi-sandbox orchestration across providers
- session management with thread context and reconnect
- skills system for reusable domain knowledge

## Feature comparison

| Capability | Sandcaster | Raw SDK | DIY runner |
|------------|-----------|---------|------------|
| Fresh sandbox per request | Built in | Manual wiring | Manual wiring |
| Multi-provider sandboxes (E2B, Vercel, Docker, Cloudflare) | Built in | No | Custom work |
| Streaming SSE endpoint | Built in | Manual wiring | Custom work |
| File uploads with path safety | Built in | Manual wiring | Custom work |
| `sandcaster.json` config layer | Built in | No | Custom work |
| Multi-model with auto-detection | Built in | No | Custom work |
| Sub-agent orchestration | Built in | No | Custom work |
| Composite multi-sandbox orchestration | Built in | No | Custom work |
| Speculative branching with LLM judge | Built in | No | Custom work |
| Session management + reconnect | Built in | No | Custom work |
| Skills system (SKILL.md) | Built in | No | Custom work |
| Structured JSON output schemas | Built in | Manual wiring | Custom work |
| Chat bots (Slack, Discord, Telegram) | Built in | No | Custom work |
| Starter scaffolding with `init` | Built in | No | Custom work |
| Rich terminal TUI (Ink) | Built in | No | Custom work |
| Run history + JSONL store | Built in | No | Custom work |
| OpenTelemetry integration | Built in | No | Custom work |

## What changed from Sandstorm

Sandcaster is a ground-up TypeScript rewrite, not a port. Key differences:

| | Sandstorm | Sandcaster |
|-|-----------|------------|
| Language | Python | TypeScript (ESM-only) |
| Runtime | pip / venv | Bun |
| LLM SDK | Claude Agent SDK | Pi-mono (multi-provider) |
| Client SDK | Python (`duvo-sandstorm[client]`) | TypeScript (`@sandcaster/sdk`) |
| CLI | Click | Ink + React TUI with live status |
| API framework | FastAPI | Hono |
| Monorepo | flat | Turborepo with isolated packages |
| Models | Claude (multi-cloud + OpenRouter) | Anthropic, OpenAI, Google, OpenRouter |
| Sandbox providers | E2B only | E2B, Vercel, Docker, Cloudflare |
| Thinking levels | No | none / low / medium / high |
| Multi-sandbox | No | Composite sandboxes with cross-provider orchestration |
| Branching | No | Speculative branching with LLM judge evaluation |
| Chat platforms | No | Slack, Discord, Telegram |
| Sessions | No | Persistent sessions with thread context |

## Architecture

```
sandcaster/
├── packages/
│   ├── core               @sandcaster/core — schemas, config, sandbox orchestration, runner
│   │   ├── providers/     E2B, Vercel, Docker, Cloudflare Containers
│   │   ├── runner/        In-sandbox runner, IPC client, composite tools
│   │   ├── branching/     Speculative branching orchestrator + evaluators
│   │   └── session/       Session management, conversation threading
│   ├── sdk                @sandcaster/sdk — standalone TypeScript client (npm)
│   ├── chat               @sandcaster/chat — unified chat bot (Slack, Discord, Telegram)
│   ├── cloudflare-worker  Cloudflare Worker proxy for sandbox operations
│   └── ts-config          @sandcaster/ts-config — shared TypeScript configs
├── apps/
│   ├── api                @sandcaster/api — Hono REST server (SSE streaming)
│   ├── cli                @sandcaster/cli — Ink TUI + chat bot (npm)
│   └── web                @sandcaster/web — docs site (getsandcaster.com)
├── examples/              15 copy-paste starters
└── scripts/               E2B template + changelog sync
```

### Execution flow

```
sandcaster "prompt" -f report.pdf
  │
  ├─ Load sandcaster.json + .env
  ├─ Resolve model (alias or auto-detect from API keys)
  ├─ Resolve sandbox provider (config > env auto-detect > docker > e2b)
  ├─ Create primary sandbox (E2B / Vercel / Docker / Cloudflare)
  ├─ Upload runner, config, user files, skills
  ├─ Execute: node /opt/sandcaster/runner.mjs
  ├─ Stream JSON-line events → TUI / SSE
  │   ├─ [branching] Fork N branches, evaluate with LLM judge
  │   └─ [composite] Intercept IPC requests from runner
  │       ├─ spawn_sandbox → SandboxPool creates secondary sandbox
  │       ├─ exec_in → run command in named sandbox
  │       ├─ transfer_files → copy files between sandboxes
  │       └─ kill_sandbox → tear down named sandbox
  ├─ Extract generated artifacts
  └─ Kill all sandboxes (secondaries first, primary last)
```

## Multi-model support

Set a model alias in `sandcaster.json` or pass `--model`:

| Alias | Resolves to |
|-------|-------------|
| `sonnet` | `claude-sonnet-4-6` |
| `opus` | `claude-opus-4-6` |
| `haiku` | `claude-haiku-4-5` |
| `gpt5` | `gpt-5.4` |
| `gpt5mini` | `gpt-5-mini` |
| `gemini` | `gemini-3.1-pro-preview` |

If no model is specified, Sandcaster auto-detects from your API keys:
`ANTHROPIC_API_KEY` > `OPENAI_API_KEY` > `GOOGLE_API_KEY` > `OPENROUTER_API_KEY`

You can also pass any full model ID directly (e.g. `--model claude-opus-4-6`).

## Sandbox providers

Sandcaster supports multiple sandbox backends. Set `sandboxProvider` in `sandcaster.json` or let Sandcaster auto-detect from your environment:

| Provider | Env var | Use case |
|----------|---------|----------|
| `e2b` | `E2B_API_KEY` | Cloud sandbox with custom templates, streaming, reconnect |
| `vercel` | `VERCEL_TOKEN` | Vercel Sandbox with snapshot support and streaming |
| `docker` | Local daemon or `DOCKER_HOST` | Local development, no cloud account needed |
| `cloudflare` | `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_SANDBOX_WORKER_URL` | Edge-based sandbox via Cloudflare Containers |

Auto-detection priority: `E2B_API_KEY` > `VERCEL_TOKEN` > Cloudflare env vars > Docker socket > E2B (fallback).

```json
{
  "sandboxProvider": "docker"
}
```

## Speculative branching

Run the same prompt through multiple branches in parallel and let an LLM judge pick the best result. Useful for code generation, test strategies, or any task where exploring alternatives improves quality.

```json
{
  "branching": {
    "enabled": true,
    "count": 3,
    "trigger": "always",
    "evaluator": {
      "type": "llm-judge",
      "model": "sonnet"
    }
  }
}
```

CLI flags: `--branches 3 --branch-trigger always --evaluator llm-judge`

Each branch can use a different model or sandbox provider. The evaluator scores all branches and selects a winner with reasoning.

## Composite sandboxes

Agents can dynamically spawn, coordinate, and tear down multiple sandboxes during a single run. This enables workflows like running a security scanner in one sandbox while building in another, or parallelizing work across providers.

Composite mode activates automatically when the primary sandbox supports it (requires `fileSystem` + `shellExec` capabilities — E2B and Docker). The agent gets five additional tools:

| Tool | Description |
|------|-------------|
| `spawn_sandbox` | Create a new sandbox by name and provider |
| `exec_in` | Run a shell command in a named sandbox |
| `transfer_files` | Copy files between sandboxes (supports globs) |
| `kill_sandbox` | Tear down a named sandbox |
| `list_sandboxes` | List all active sandboxes in the session |

Communication between the runner (inside the primary sandbox) and the host uses a nonce-authenticated file-based IPC protocol. The host intercepts requests from the runner's stdout, executes them against the SandboxPool, and writes responses back via atomic file rename.

### Guardrails

Config sets the ceiling. Per-request overrides can only tighten limits, never broaden them.

| Guardrail | Default | Config key |
|-----------|---------|------------|
| Max concurrent sandboxes | 3 | `composite.maxSandboxes` (1-20) |
| Max total spawns per session | 10 | `composite.maxTotalSpawns` (1-100) |
| Allowed providers | all | `composite.allowedProviders` |
| IPC poll interval | 50ms | `composite.pollIntervalMs` (10-1000) |

File transfers enforce per-file (25MB) and total (50MB) size limits with path traversal protection.

### Cleanup

All secondary sandboxes are killed automatically when the run completes (secondaries first, primary last). A `SIGTERM` handler ensures cleanup on graceful shutdown in all modes (composite and non-composite).

## Chat bots

Sandcaster includes a unified chat bot package (`@sandcaster/chat`) supporting Slack, Discord, and Telegram. Each message spawns a sandboxed agent session, with thread-based conversation tracking and automatic session management.

### Zero-code (CLI)

```bash
# Set platform tokens in your environment, then:
sandcaster chat start
```

### Production gateway

For production deployments, use the HTTP gateway pattern with Hono webhook routes:

```typescript
import { createChatBot, createChatWebhookRoutes } from "@sandcaster/chat";

const { bot, pool } = await createChatBot({
  platforms: { slack: { botToken, appToken, signingSecret } },
  sessionTimeoutMs: 600_000,
  allowedChannels: ["C01234ABCDE"],
  onNewSession: async (session) => { /* wire up agent */ },
  onSessionMessage: async (session, text) => { /* continue session */ },
});

const routes = createChatWebhookRoutes(bot);
```

See [`examples/15-chat-bot`](examples/15-chat-bot/) for a full working example with both CLI and gateway modes.

### Features

- Thread-to-session mapping with per-thread mutex for message serialization
- Thread re-engagement: rebuilds context from thread history when session expires
- Deduplication (10-min TTL) to prevent duplicate processing
- Access control via `allowedChannels` and `allowedUsers`
- Event-to-text bridge streams agent output as markdown to chat

## SDK

```bash
npm install @sandcaster/sdk
```

```typescript
import { SandcasterClient } from "@sandcaster/sdk";

const client = new SandcasterClient({
  baseUrl: "http://localhost:8000",
  apiKey: "your-token",
});

for await (const event of client.query({ prompt: "Analyze this market" })) {
  if (event.type === "assistant") console.log(event.content);
  if (event.type === "file") console.log(`artifact: ${event.path}`);
  if (event.type === "result") console.log(`cost: $${event.costUsd}`);
}
```

The SDK implements `Symbol.asyncDispose` for automatic cleanup and supports `AbortSignal` for cancellation.

## API

Start the server:

```bash
sandcaster serve --port 8000
```

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/health` | Status and version |
| `POST` | `/query` | Stream agent execution as SSE |
| `GET` | `/runs` | List recent runs (limit: 1-200) |
| `POST` | `/sessions/:sessionId/message` | Send message to an existing session |

## Configuration

`sandcaster.json` at your project root:

```json
{
  "systemPrompt": "You are a research analyst...",
  "model": "sonnet",
  "maxTurns": 20,
  "timeout": 300,
  "outputFormat": { "type": "json_schema", "schema": { "..." : "..." } },
  "skillsDir": ".claude/skills",
  "allowedTools": ["bash", "file_read", "file_write"],
  "templateSkills": true,
  "thinkingLevel": "medium",
  "agents": {
    "dependency-scanner": {
      "description": "Checks dependencies for known CVEs",
      "tools": ["Read", "Glob", "Bash"],
      "model": "haiku"
    }
  },
  "provider": "anthropic",
  "sandboxProvider": "e2b",
  "branching": {
    "enabled": true,
    "count": 3,
    "trigger": "always",
    "evaluator": { "type": "llm-judge", "model": "sonnet" }
  },
  "composite": {
    "maxSandboxes": 3,
    "maxTotalSpawns": 10,
    "allowedProviders": ["e2b", "docker"]
  },
  "chat": {
    "sessionTimeoutMs": 600000,
    "allowedChannels": ["C01234ABCDE"],
    "botName": "sandcaster"
  }
}
```

## Skills

Drop a `SKILL.md` file in your skills directory:

```markdown
---
name: owasp-top-10
description: OWASP Top 10 security review checklist
---

Use this checklist when auditing application code...
```

Skills are injected into the agent's context and can be loaded on-demand via the `read_skill` tool.

## CLI commands

| Command | Description |
|---------|-------------|
| `sandcaster [prompt]` | Run agent with optional prompt (default command) |
| `sandcaster serve` | Start Hono API server |
| `sandcaster init [starter]` | Scaffold a starter project |
| `sandcaster chat start` | Start chat bot (Slack/Discord/Telegram) |
| `sandcaster session <id>` | Interact with an existing session |
| `sandcaster templates` | List or push E2B sandbox templates |

## Development

```bash
bun install              # Install all workspace dependencies
bunx turbo build         # Build all packages
bunx turbo test          # Run all tests
bunx turbo lint          # Lint all packages (Biome)
```

Published packages use [Changesets](https://github.com/changesets/changesets) for versioning. CI publishes `@sandcaster/sdk` and `@sandcaster/cli` to npm with provenance on every release.

## Community

Docs and changelog at [getsandcaster.com](https://getsandcaster.com).

If Sandcaster saves you runner plumbing, please star the repo.

If you want a new starter, a provider integration, or a sharper deploy story, open an issue or
start a discussion.

## License

[MIT](LICENSE)
