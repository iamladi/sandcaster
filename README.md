# Sandcaster

Open-source runtime for general-purpose AI agents in isolated sandboxes.

CLI, API, TypeScript SDK, and Slack with streaming, file uploads, and config-driven behavior.

Built on [Pi-mono](https://github.com/nicholasgriffintn/pi-mono) and [E2B](https://e2b.dev).

<!-- [![CI](https://github.com/user/sandcaster/actions/workflows/ci.yml/badge.svg)](https://github.com/user/sandcaster/actions/workflows/ci.yml) -->
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9+-blue.svg)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.2+-f472b6.svg)](https://bun.sh/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Sandcaster is a TypeScript rewrite of [Sandstorm](https://github.com/tomascupr/sandstorm) for people who want real agent work, not a chat wrapper:

- Research Acme's competitors, crawl their sites and recent news, and write a one-page branded briefing PDF with sources
- Analyze uploaded transcripts or PDFs
- Triage incoming support tickets
- Run a security audit with coordinated sub-agents
- Turn docs into a draft OpenAPI spec

## Terminal demo

```bash
$ sandcaster init research-brief
$ cd research-brief
$ sandcaster "Research Acme's competitors, crawl their sites and recent news, and write a one-page branded briefing PDF with sources."

 WEBFETCH  competitor sites, product pages, and recent coverage
 STREAM    compared launches, pricing, positioning, and buyer signals
 WRITE     briefing.pdf
 WRITE     reports/sources.md

artifacts:
  - briefing.pdf
  - reports/sources.md

 sonnet  12 turns  $0.043  38s
```

The point is not that an agent can answer a question. It starts from a runnable starter, gets a
fresh sandbox, can read uploads or crawl the web, writes artifacts like `briefing.pdf`, streams
its work in a rich TUI, and tears itself down when the run is done.

## 60-second path

```bash
git clone https://github.com/iamladi/sandcaster.git
cd sandcaster
bun install && bunx turbo build
cd apps/cli && bun link      # registers the `sandcaster` command globally

sandcaster init
cd general-assistant
sandcaster "Compare Notion, Coda, and Slite for async product teams"
```

`sandcaster init` scaffolds a runnable starter with `sandcaster.json`, a starter README, `.env.example`,
and any starter-specific assets. If provider settings are missing, the guided flow asks once and
writes `.env` for you.

Direct forms:

```bash
sandcaster init --list
sandcaster init research-brief
sandcaster init security-audit my-audit
```

## Pick a starter

| Starter | Use it when you want to | Typical output | Aliases |
|---------|--------------------------|----------------|---------|
| `general-assistant` | Start with one flexible agent for mixed workflows | concise answer, plan, or artifact | - |
| `research-brief` | Research a topic, compare options, and support a decision | brief with findings, recommendations, and sources | `competitive-analysis` |
| `document-analyst` | Review transcripts, reports, PDFs, or decks | summary, risks, action items, open questions | - |
| `support-triage` | Triage support tickets or issue exports | prioritized queue with owners and next steps | `issue-triage` |
| `api-extractor` | Crawl docs and draft an API summary plus spec | endpoint summary and draft `openapi.yaml` | `docs-to-openapi` |
| `security-audit` | Run a structured security review with sub-agents | vulnerability report with remediation steps | - |

Need CRM access, ticket systems, or internal APIs? Add custom tools or skills to the sandbox.

## Why Sandcaster exists

Most agent projects break down in one of two ways:

- You wire the SDK yourself and end up rebuilding sandbox lifecycle, file uploads, streaming,
  config loading, and starter setup.
- You use an agent framework that is good at orchestration but weak at actually shipping a
  runnable agent product path.

Sandcaster is opinionated about the missing middle:

- starter to runnable project in one command
- fresh sandbox per request with teardown by default
- CLI, API, and Slack over the same runtime
- config-driven behavior through `sandcaster.json`
- multi-model support across Anthropic, OpenAI, Google, and OpenRouter
- sub-agent orchestration with configurable tools and models per agent
- skills system for reusable domain knowledge

## Why not wire the SDK yourself?

| Capability | Sandcaster | Raw SDK + E2B | DIY runner |
|------------|-----------|---------------|------------|
| Fresh sandbox per request | Built in | Manual wiring | Manual wiring |
| Streaming SSE endpoint | Built in | Manual wiring | Custom work |
| File uploads with path safety | Built in | Manual wiring | Custom work |
| `sandcaster.json` config layer | Built in | No | Custom work |
| Multi-model with auto-detection | Built in | No | Custom work |
| Sub-agent orchestration | Built in | No | Custom work |
| Skills system (SKILL.md) | Built in | No | Custom work |
| Structured JSON output schemas | Built in | Manual wiring | Custom work |
| Slack bot integration | Built in | No | Custom work |
| Starter scaffolding with `init` | Built in | No | Custom work |
| Rich terminal TUI (Ink) | Built in | No | Custom work |
| Run history + JSONL store | Built in | No | Custom work |
| OpenTelemetry integration | Built in | No | Custom work |
| HMAC webhook verification | Built in | No | Custom work |

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
| Models | Anthropic only | Anthropic, OpenAI, Google, OpenRouter |
| Sub-agents | No | Config-driven agent delegation |
| Skills | No | SKILL.md with YAML frontmatter |
| Thinking levels | No | none / low / medium / high |

## Architecture

```
sandcaster/
├── packages/
│   ├── core          @sandcaster/core — schemas, config, sandbox orchestration, runner
│   ├── sdk           @sandcaster/sdk — standalone TypeScript client
│   └── ts-config     @sandcaster/ts-config — shared TypeScript configs
├── apps/
│   ├── api           @sandcaster/api — Hono REST server (SSE streaming)
│   ├── cli           @sandcaster/cli — Ink TUI with starters catalog
│   └── slack-bot     @sandcaster/slack-bot — Slack integration
└── scripts/          E2B template management
```

### Execution flow

```
sandcaster "prompt" -f report.pdf
  │
  ├─ Load sandcaster.json + .env
  ├─ Resolve model (alias or auto-detect from API keys)
  ├─ Create E2B sandbox (template: sandcaster-v1)
  ├─ Upload runner, config, user files, skills
  ├─ Execute: node /opt/sandcaster/runner.mjs
  ├─ Stream JSON-line events → TUI / SSE
  ├─ Extract generated artifacts
  └─ Kill sandbox
```

## Multi-model support

Set a model alias in `sandcaster.json` or pass `--model`:

| Alias | Resolves to |
|-------|-------------|
| `sonnet` | `claude-sonnet-4-6` |
| `opus` | `claude-opus-4-6` |
| `haiku` | `claude-haiku-4-5` |
| `gpt4` | `gpt-4.1` |
| `gemini` | `gemini-2.5-pro` |
| `o3` | `o3` |

If no model is specified, Sandcaster auto-detects from your API keys:
`ANTHROPIC_API_KEY` > `OPENAI_API_KEY` > `GOOGLE_API_KEY` > `OPENROUTER_API_KEY`

## SDK

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
| `POST` | `/webhooks/e2b` | E2B lifecycle webhook (HMAC verified) |

## Configuration

`sandcaster.json` at your project root:

```json
{
  "systemPrompt": "You are a research analyst...",
  "model": "sonnet",
  "maxTurns": 20,
  "timeout": 300,
  "outputFormat": { "type": "json_schema", "schema": { ... } },
  "skillsDir": ".claude/skills",
  "allowedTools": ["bash", "file_read", "file_write"],
  "templateSkills": true,
  "agents": {
    "dependency-scanner": {
      "description": "Checks dependencies for known CVEs",
      "tools": ["Read", "Glob", "Bash"],
      "model": "haiku"
    }
  },
  "provider": "anthropic",
  "thinkingLevel": "medium"
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

## Development

```bash
bun install              # Install all workspace dependencies
bunx turbo build         # Build all packages
bunx turbo test          # Run all tests
bunx turbo lint          # Lint all packages (Biome)
```

## Community

If Sandcaster saves you runner plumbing, please star the repo.

If you want a new starter, a provider integration, or a sharper deploy story, open an issue or
start a discussion.

## License

[MIT](LICENSE)
