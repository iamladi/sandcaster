# @sandcaster/cli

CLI for [Sandcaster](https://github.com/iamladi/sandcaster) — run AI agents in isolated sandboxes.

[![npm](https://img.shields.io/npm/v/@sandcaster/cli)](https://www.npmjs.com/package/@sandcaster/cli)
[![license](https://img.shields.io/npm/l/@sandcaster/cli)](https://github.com/iamladi/sandcaster/blob/main/LICENSE)

## Install

```bash
npm i -g @sandcaster/cli
```

## Quick start

```bash
# Initialize a project from a starter template
sandcaster init general-assistant

# Run a query
sandcaster "Compare Notion, Coda, and Slite for async product teams"
```

## Commands

| Command | Description |
|---------|-------------|
| `sandcaster <prompt>` | Run an AI agent in a sandbox (default command) |
| `sandcaster init [starter] [dir]` | Initialize a `sandcaster.json` config from a starter |
| `sandcaster serve` | Start the Sandcaster API server |
| `sandcaster session list` | List active and recent sessions |
| `sandcaster session attach <id>` | Attach to a live session |
| `sandcaster session delete <id>` | Delete a session |
| `sandcaster templates [name]` | List and inspect available templates |

### Query options

```
-T, --template <name>       Use a starter template
-m, --model <model>         Model override
-f, --file <path>           Upload files (repeatable)
-t, --timeout <secs>        Sandbox timeout
    --max-turns <n>         Max agent turns
    --no-tui                Output JSON lines instead of TUI
-B, --branches <n>          Parallel branches (1-5)
    --branch-trigger <mode> Branch trigger (explicit, confidence, always)
    --evaluator <type>      Evaluator (llm-judge, schema, custom)
    --provider <name>       LLM provider (anthropic, vertex, bedrock, openrouter)
```

## Starters

Use `sandcaster init <starter>` to scaffold a project:

| Starter | Description | Aliases |
|---------|-------------|---------|
| `general-assistant` | General-purpose agent for mixed workflows | — |
| `research-brief` | Research a topic and return a decision brief | `competitive-analysis` |
| `document-analyst` | Analyze transcripts, reports, PDFs, or decks | — |
| `support-triage` | Triage tickets into priorities and next actions | `issue-triage` |
| `api-extractor` | Crawl docs and draft an OpenAPI spec | `docs-to-openapi` |
| `security-audit` | Structured security review with sub-agents | — |

## Configuration

Projects are configured via `sandcaster.json`. Run `sandcaster init` to generate one, or see the [main repo](https://github.com/iamladi/sandcaster) for the full schema.

## License

MIT — see the [main repo](https://github.com/iamladi/sandcaster) for full documentation.
