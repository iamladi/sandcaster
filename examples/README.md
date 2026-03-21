# Sandcaster Examples

Copy-paste-ready examples for Sandcaster. Each directory is self-contained: `sandcaster.json` + `README.md`.

## Prerequisites

```bash
cd apps/cli && bun link   # registers `sandcaster` globally (from monorepo)
```

## Examples

| # | Example | Description | Env vars |
|---|---------|-------------|----------|
| 01 | [hello-sandbox](01-hello-sandbox/) | Minimal agent in E2B sandbox | `E2B_API_KEY`, `OPENAI_API_KEY` |
| 02 | [code-reviewer](02-code-reviewer/) | Code review with structured JSON output | `E2B_API_KEY`, `OPENAI_API_KEY` |
| 03 | [competitive-analysis](03-competitive-analysis/) | Market research with web crawling | `E2B_API_KEY`, `OPENAI_API_KEY` |
| 04 | [structured-output](04-structured-output/) | Extract TODOs with JSON schema | `E2B_API_KEY`, `OPENAI_API_KEY` |
| 05 | [multi-agent-security-audit](05-multi-agent-security-audit/) | Coordinated sub-agents for security review | `E2B_API_KEY`, `OPENAI_API_KEY` |
| 06 | [speculative-branching](06-speculative-branching/) | Multiple approaches evaluated by LLM judge | `E2B_API_KEY`, `OPENAI_API_KEY` |
| 07 | [provider-vercel](07-provider-vercel/) | Hello world on Vercel Sandbox | `VERCEL_TOKEN`, `OPENAI_API_KEY` |
| 08 | [provider-cloudflare](08-provider-cloudflare/) | Hello world on Cloudflare Containers | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_SANDBOX_WORKER_URL`, `OPENAI_API_KEY` |
| 09 | [provider-docker](09-provider-docker/) | Hello world on local Docker | `OPENAI_API_KEY` |
| 10 | [fix-ci-failure](10-fix-ci-failure/) | Debug CI logs and propose a fix | `E2B_API_KEY`, `OPENAI_API_KEY` |
| 11 | [generate-tests](11-generate-tests/) | Generate test suite with branching strategies | `E2B_API_KEY`, `OPENAI_API_KEY` |
| 12 | [dependency-audit](12-dependency-audit/) | Audit deps for CVEs, produce prioritized report | `E2B_API_KEY`, `OPENAI_API_KEY` |
| 13 | [generate-api-docs](13-generate-api-docs/) | Generate OpenAPI spec from source code | `E2B_API_KEY`, `OPENAI_API_KEY` |
| 14 | [onboard-to-codebase](14-onboard-to-codebase/) | Produce architecture overview of a codebase | `E2B_API_KEY`, `OPENAI_API_KEY` |
| 15 | [chat-bot](15-chat-bot/) | Chat bot with Slack/Discord/Telegram + HTTP gateway | `E2B_API_KEY`, `ANTHROPIC_API_KEY`, platform tokens |
| 16 | [github-pr-companion](16-github-pr-companion/) | Auto-fix review bot comments on PRs + HTTP gateway | `E2B_API_KEY`, `OPENAI_API_KEY`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_TOKEN` |

## Running an example

```bash
cd examples/01-hello-sandbox
sandcaster "Hello, what can you do?"
```

## Model

All examples use `gpt5` (OpenAI `gpt-5.4`) for cost efficiency. To use a different model, edit `"model"` in `sandcaster.json`:

| Alias | Model |
|-------|-------|
| `gpt5` | `gpt-5.4` |
| `sonnet` | `claude-sonnet-4-6` |
| `haiku` | `claude-haiku-4-5` |
| `gpt5mini` | `gpt-5-mini` |

## Troubleshooting

- **"No LLM provider API key found"**: Set `OPENAI_API_KEY` in your environment
- **"E2B_API_KEY not set"**: Get a key at https://e2b.dev/dashboard
- **Model not available**: Replace `gpt5` with `sonnet` or `haiku` in `sandcaster.json`
- **"sandcaster: command not found"**: Run `cd apps/cli && bun link` from the monorepo root
