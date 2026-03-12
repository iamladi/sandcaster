# Sandcaster

A runtime for AI agents in isolated E2B sandboxes. (inspired by https://github.com/tomascupr/sandstorm)

## TDD

tdd: strict

## Stack

- **Runtime**: bun
- **Monorepo**: Turborepo
- **Language**: TypeScript (ESM-only)
- **LLM orchestration**: Pi-mono (`@mariozechner/pi-ai`, `@mariozechner/pi-agent-core`)
- **API**: Hono
- **Sandboxes**: E2B
- **CLI/TUI**: Ink + React
- **Testing**: Vitest 4
- **Formatting/Linting**: Biome (runs automatically via hook)

## Commands

```bash
bun install              # Install all workspace dependencies
bunx turbo build         # Build all packages (tsc, topological order)
bunx turbo test          # Run all tests (Vitest)
bunx turbo lint          # Lint all packages (Biome)
bun run scripts/create-template.ts  # Create E2B sandbox template (needs E2B_API_KEY)
```

## Package Structure

```
packages/core       — @sandcaster/core (data + execution layer)
packages/sdk        — @sandcaster/sdk (standalone client SDK)
packages/ts-config  — @sandcaster/ts-config (shared TypeScript configs)
apps/api            — @sandcaster/api (Hono server, depends on core)
apps/cli            — @sandcaster/cli (Ink TUI, depends on core + sdk)
apps/slack-bot      — @sandcaster/slack-bot (Slack bot, depends on core)
```

## Conventions

- Internal dependencies use `workspace:*`
- Build output goes to `dist/`
- Each package extends `@sandcaster/ts-config/node.json` (or `react.json` for CLI)
- No npm publishing — private monorepo
