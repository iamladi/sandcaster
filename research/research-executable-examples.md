---
date: 2026-03-19
git_commit: 685ac1f6adba4d11d9d9090f4998b96537484a4d
branch: main
repository: iamladi/sandcaster
topic: Building executable examples for Sandcaster
tags: [examples, sdk, cli, api, core, developer-experience, onboarding]
status: complete
last_updated: 2026-03-19
last_updated_by: research-team (locator, analyzer, pattern-finder + web-search)
---

# Research: Building Executable Examples for Sandcaster

## Research Question

What does the codebase look like today, and what patterns exist (internally and externally) to inform building a set of standalone, executable example scripts in an `examples/` root directory that demonstrate SDK client usage, CLI usage, Core library internals, and API server interaction?

## Summary

The Sandcaster monorepo has a well-defined public API surface across four packages/apps. The SDK client (`SandcasterClient`) is the primary consumer-facing API with streaming async iterables. The core library exposes `runAgentInSandbox()` and `SessionManager` as key entry points. The API server defines REST+SSE routes via Hono. The CLI uses citty with Ink TUI rendering.

Internally, test files (especially integration tests) serve as the best existing "usage examples" — they demonstrate client initialization, event consumption, session lifecycle, and error handling patterns. The Python predecessor (Sandstorm) has 7 example directories at `/Users/iamladi/Projects/experiments/sandstorm/examples/` following a config-per-directory pattern.

Externally, the E2B cookbook, Vercel AI SDK, and Hono examples repos provide proven patterns for structuring executable examples in TypeScript monorepos. The consensus is: workspace member with `workspace:*` deps, numeric-prefixed directories for progressive complexity, `.env.example` for credential documentation, and `bun run` for direct execution.

Team composition: Analyzer [Consensus], Pattern Finder [Consensus], Web Search Researcher. Locator timed out but its scope was covered by the other two teammates' file:line citations.

---

## Detailed Findings

### 1. SDK Client — Public API Surface

[Analyzer] [Pattern Finder] [Consensus]

The primary consumer API is `SandcasterClient` at `packages/sdk/src/client.ts:17`.

**Constructor:**
```ts
new SandcasterClient({ baseUrl: string, apiKey?: string })
```
— `packages/sdk/src/client.ts:22`, options type at `packages/sdk/src/types.ts:302-305`

**Methods:**

| Method | Signature | Location |
|--------|-----------|----------|
| `query` | `(request: QueryRequest, options?: { signal?: AbortSignal }): AsyncIterable<SandcasterEvent>` | `client.ts:146` |
| `health` | `(): Promise<{ status: string }>` | `client.ts:169` |
| `listRuns` | `(): Promise<Run[]>` | `client.ts:186` |
| `createSession` | `(request: SessionCreateRequest, options?): AsyncIterable<SandcasterEvent>` | `client.ts:203` |
| `sendSessionMessage` | `(sessionId: string, message: SessionMessageRequest, options?): AsyncIterable<SandcasterEvent>` | `client.ts:226` |
| `attachSession` | `(id: string, options?): AsyncIterable<SandcasterEvent>` | `client.ts:250` |
| `listSessions` | `(): Promise<SessionRecord[]>` | `client.ts:269` |
| `getSession` | `(id: string): Promise<Session>` | `client.ts:286` |
| `deleteSession` | `(id: string): Promise<void>` | `client.ts:303` |
| `[Symbol.asyncDispose]` | `(): Promise<void>` | `client.ts:318` |

All streaming methods return `AsyncIterable<SandcasterEvent>`. The client handles SSE parsing internally via `parseSSEStream()` at `packages/sdk/src/stream.ts:42`.

**QueryRequest shape** — `packages/sdk/src/types.ts:179-219`:
```ts
interface QueryRequest {
  prompt: string;
  apiKeys?: { anthropic?: string; e2b?: string; openrouter?: string; vercel?: string; cloudflare?: string };
  model?: string;
  maxTurns?: number;
  outputFormat?: Record<string, unknown>;
  timeout?: number;
  files?: Record<string, string>;
  allowedSkills?: string[];
  allowedTools?: string[];
  provider?: "anthropic" | "vertex" | "bedrock" | "openrouter";
  thinkingLevel?: "none" | "low" | "medium" | "high";
  sandboxProvider?: "e2b" | "vercel" | "docker" | "cloudflare";
  branching?: { enabled?: boolean; count?: number; ... };
}
```

**Event type system** — `packages/sdk/src/types.ts:5-171` — 19 event types in discriminated union:
- Core: `system`, `assistant`, `tool_use`, `tool_result`, `thinking`, `file`, `result`, `stderr`, `warning`, `error`
- Session: `session_created`, `session_expired`, `session_command_result`
- Branch: `branch_request`, `confidence_report`, `branch_start`, `branch_progress`, `branch_complete`, `branch_selected`, `branch_summary`

---

### 2. Core Execution Flow

[Analyzer]

**Main entry:** `runAgentInSandbox(options: RunOptions)` at `packages/core/src/sandbox.ts:186`

**Execution lifecycle:**
1. Resolve sandbox provider — `sandbox-resolver.ts:74` (chain: request > config > env auto-detect > "e2b" default)
2. Get provider from registry — `sandbox-registry.ts:37` (lazy-loads provider SDK)
3. Resolve credential — request.apiKeys > env var
4. Create sandbox — `provider.create({ template, timeoutMs, envs, metadata, apiKey })` at `sandbox.ts:246`
5. Setup composite/IPC if configured — `sandbox.ts:271-336`
6. Upload runner bundle — writes `runner.mjs` to `/opt/sandcaster/runner.mjs` at `sandbox.ts:342`
7. Upload agent config — writes `agent_config.json` at `sandbox.ts:350`
8. Upload user files — to sandbox working directory at `sandbox.ts:368`
9. Execute runner — `instance.commands.run("node /opt/sandcaster/runner.mjs")` at `sandbox.ts:406`
10. Stream events — parse JSON lines from stdout at `sandbox.ts:430`
11. Extract generated files — after runner completes at `sandbox.ts:530`
12. Kill sandbox — always in `finally` block at `sandbox.ts:550`

**Inside the sandbox** (`runner-main.ts:14`):
- Creates Pi-mono `Agent` instance
- Model resolved via `resolveModelFromConfig()` — aliases at `model-aliases.ts:8`: `sonnet` → claude-sonnet-4-6, `opus` → claude-opus-4-6, `haiku` → claude-haiku-4-5, `gpt5` → gpt-5.4, `gemini` → gemini-3.1-pro-preview
- Tools: `bash`, `file_read`, `file_write`, `read_skill` (+ `branch`, `report_confidence` when branching enabled)
- Events translated via `createEventTranslator()` at `event-translator.ts:78`

**SandboxInstance interface** — `packages/core/src/sandbox-provider.ts:74`:
```ts
interface SandboxInstance {
  readonly workDir: string;
  readonly capabilities: SandboxCapabilities;
  files: { write(path, content), read(path, opts?) };
  commands: { run(cmd, opts?) };
  kill(): Promise<void>;
}
```

**SessionManager** — `packages/core/src/session-manager.ts`:
```ts
const manager = new SessionManager({
  store,
  sandboxFactory: async () => sandbox,
  runAgent: agentFunction,
  idleTimeoutMs: 5_000,
  maxActiveSessions: 10,
});

const { sessionId, events } = await manager.createSession({ prompt: "hi" });
for await (const event of events) { ... }
await manager.sendMessage(sessionId, { prompt: "follow up" });
await manager.deleteSession(sessionId);
await manager.shutdown();
```
— Usage pattern from `packages/core/src/__tests__/session/session-manager.test.ts:151-169`

---

### 3. Speculative Branching

[Analyzer]

**Entry:** `runBranchedAgent(options: BranchRunOptions)` at `packages/core/src/branching/branch-orchestrator.ts:225`

**Three trigger modes:**
1. **`always`** (line 250): Skip initial run, immediately create N branches
2. **`explicit`** (line 354): Run initial agent; if it calls the `branch` tool, fork into branches
3. **`confidence`** (line 295): Run initial agent; if `report_confidence` tool reports below threshold, auto-branch

**Flow:** Orchestrator runs initial agent → trigger fires → `runBranchingPath()` (line 372) → `runSingleBranch()` (line 106) for each alternative → concurrent execution with stagger delay (200ms default) → evaluator selects winner

**Evaluators** (`evaluator.ts`):
- `LlmJudgeEvaluator` (line 121): LLM judges best result
- `SchemaEvaluator` (line 178): JSON schema validation + LLM fallback
- `CustomEvaluator` (line 240): User-provided prompt
- Factory: `createEvaluator(config, outputSchema?)` (line 279)

**Branch events:** `branch_start` → `branch_progress` (multiple) → `branch_complete` → `branch_selected` → `result` → `branch_summary`

---

### 4. API Server

[Analyzer]

**Entry:** `createApp(deps: AppDeps)` at `apps/api/src/app.ts:12`
**Standalone server:** `apps/api/src/node.ts:1` (uses `@hono/node-server`)

**Routes:**

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| GET | `/health` | `routes/health.ts` | Health check |
| POST | `/query` | `routes/query.ts:14` | One-shot agent query, SSE stream |
| GET | `/runs` | `routes/runs.ts` | List past runs |
| POST | `/sessions` | `routes/sessions.ts:47` | Create session, SSE stream |
| POST | `/sessions/:id/messages` | `routes/sessions.ts:94` | Send message/command, SSE stream |
| GET | `/sessions` | `routes/sessions.ts:166` | List sessions |
| GET | `/sessions/:id` | `routes/sessions.ts:176` | Get session detail |
| DELETE | `/sessions/:id` | `routes/sessions.ts:188` | Delete session |
| GET | `/sessions/:id/events` | `routes/sessions.ts:197` | Attach to live SSE stream |

**Middleware:** requestId (always), CORS (optional), Bearer token auth (optional) — `app.ts:17-24`

**AppDeps** — `apps/api/src/types.ts:8`:
```ts
interface AppDeps {
  runStore?: IRunStore;
  runAgent?: (options: RunOptions) => AsyncGenerator<SandcasterEvent>;
  sessionManager?: SessionManager;
  apiKey?: string;
  version?: string;
  corsOrigins?: string[];
}
```

---

### 5. CLI Commands

[Analyzer]

**Entry:** `apps/cli/src/index.ts:1` — Uses citty for command parsing, loads `.env` at startup (line 14-18)

| Command | Location | Description |
|---------|----------|-------------|
| `sandcaster query <prompt>` | `commands/query.tsx:240` | Run agent with TUI. Flags: `--model/-m`, `--provider`, `--file/-f`, `--timeout/-t`, `--max-turns`, `--no-tui`, `--template/-T`, `--branches/-B`, `--branch-trigger`, `--evaluator`, `--confidence-threshold` |
| `sandcaster serve` | `commands/serve.ts:96` | Start API server. Flags: `--port/-p` (8000), `--host/-h` (0.0.0.0) |
| `sandcaster session list\|delete\|attach` | `commands/session.ts:186` | Session management |
| `sandcaster init` | `commands/init.ts` | Initialize project |
| `sandcaster templates` | `commands/templates.ts` | List/manage templates |

**Shorthand:** `sandcaster "prompt"` auto-injects "query" subcommand (`index.ts:48-53`)

---

### 6. Configuration

[Analyzer] [Pattern Finder] [Consensus]

**Environment variables:**

| Variable | Purpose | Required? |
|----------|---------|-----------|
| `E2B_API_KEY` | E2B sandbox provider | Required (default provider) |
| `ANTHROPIC_API_KEY` | Anthropic models | At least one LLM key |
| `OPENAI_API_KEY` | OpenAI models | Alternative |
| `GOOGLE_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` | Google models | Alternative |
| `OPENROUTER_API_KEY` | OpenRouter proxy | Alternative |
| `VERCEL_TOKEN` | Vercel sandbox provider | If using Vercel |
| `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_SANDBOX_WORKER_URL` | Cloudflare provider | If using Cloudflare |
| `DOCKER_HOST` | Docker sandbox provider | Optional |
| `SANDCASTER_API_KEY` | API server auth | Optional |
| `SANDCASTER_API_URL` | CLI session commands base URL | Default: http://localhost:8000 |
| `SANDCASTER_TEMPLATE` | Custom sandbox template | Optional |

**Provider auto-detection** — `packages/core/src/sandbox-resolver.ts:32-42`:
Priority: E2B → Vercel → Cloudflare → Docker → fallback E2B

**Config file:** `sandcaster.json` — loaded by `loadConfig()` at `packages/core/src/config.ts:61`. Schema at `packages/core/src/schemas.ts:182`.

**Model aliases** — `packages/core/src/model-aliases.ts:8`: `sonnet`, `opus`, `haiku`, `gpt5`, `gemini`

---

### 7. Error Handling Conventions

[Analyzer] [Pattern Finder] [Consensus]

**Error hierarchy** — `packages/core/src/errors.ts`:
```
SandcasterError (base, has .code)
  ├── AuthError (code: "AUTH_ERROR")
  ├── ValidationError (code: "VALIDATION_ERROR")
  └── SandboxError (code: "SANDBOX_ERROR", has .stage)
SandboxOperationError (code: SandboxErrorCode, has .hint)
SessionError (.code: "SESSION_NOT_FOUND" | "SESSION_BUSY" | "SESSION_CAPACITY_EXCEEDED")
```

**Result types (no-throw pattern)** — `packages/core/src/sandbox-provider.ts:94-96`:
```ts
type CreateResult =
  | { ok: true; instance: SandboxInstance }
  | { ok: false; code: SandboxErrorCode; message: string; hint?: string };
```

**Error events in stream** — errors during agent runs are yielded as events, not thrown:
```ts
yield { type: "error", content: "Runner error: ...", code: "RUNNER_ERROR" };
```

---

### 8. Usage Patterns from Tests

[Pattern Finder]

**SDK client query** — `packages/sdk/src/__tests__/client.test.ts:57-71`:
```ts
const client = new SandcasterClient({ baseUrl: "http://localhost:3000" });
for await (const event of client.query({ prompt: "do something" })) {
  console.log(event.type, event.content);
}
```

**Query with abort** — `packages/sdk/src/__tests__/client.test.ts:149-193`:
```ts
const controller = new AbortController();
for await (const event of client.query(
  { prompt: "test" },
  { signal: controller.signal },
)) {
  collected.push(event);
  controller.abort();
}
```

**Session lifecycle** — `packages/sdk/src/__tests__/session.test.ts:56-103`:
```ts
for await (const event of client.createSession({ prompt: "test" })) { ... }
for await (const event of client.sendSessionMessage("sess-1", { prompt: "hello" })) { ... }
for await (const event of client.attachSession("sess-1")) { ... }
const sessions = await client.listSessions();
const session = await client.getSession("sess-1");
await client.deleteSession("sess-1");
```

**API integration test** — `apps/api/src/__tests__/integration.test.ts:1-81`:
```ts
const app = createApp({
  runAgent: fakeRunAgent,
  runStore: createRunStore({ path: `/tmp/sandcaster-integration-${crypto.randomUUID()}.jsonl` }),
  apiKey: "test-api-key-that-is-32-chars-ok",
  version: "0.1.0",
  corsOrigins: ["http://localhost:3000"],
});
const res = await app.request("/health");
const res = await app.request("/query", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({ prompt: "hello" }),
});
```

**Scripts pattern** — `scripts/create-template.ts:1-48` — top-level await, immediate error exit for missing env vars, no function wrappers.

---

### 9. Sandstorm (Python Predecessor) Examples

[Pattern Finder]

Sandstorm has 7 examples at `/Users/iamladi/Projects/experiments/sandstorm/examples/`:
- `competitive-analysis/` — `sandstorm.json` with `system_prompt`, `model`, `output_format`
- `code-reviewer/` — `sandstorm.json` with `allowed_tools: ["Read", "Glob", "Grep"]`
- `security-auditor/` — `sandstorm.json` with `agents` (multi-agent) + `skills_dir`
- `content-brief/`, `docs-to-openapi/`, `issue-triage/`, `repo-migration/`

**Structure:** Each example is a directory containing `sandstorm.json` (config) + `README.md`.

**Python client** — `src/sandstorm/client.py:33-136`:
```python
async with SandstormClient("https://host", api_key="key") as client:
    async for event in client.query("Hello world"):
        print(event.type, event.data)
```

---

### 10. External Best Practices

[Web Search Researcher]

#### E2B Cookbook (`e2b-dev/e2b-cookbook`)
- 42 examples, each fully self-contained with own `package.json`, `index.ts`, `.env.template`, `README.md`
- Scripts: `"start": "tsx index.ts"`
- README: 3 steps (install → configure env → run)

#### Vercel AI SDK (`vercel/ai`)
- `examples/` registered as workspace glob in monorepo
- Individual examples use `"ai": "workspace:*"` to reference workspace packages
- `.env.example` for credential documentation
- `tsx` for direct TypeScript execution, no build step needed
- Examples excluded from `turbo build` pipelines

#### Hono Examples (`honojs/examples`)
- Separate npm workspace per example
- Run via `npm -w [workspace] run dev` from repo root

#### Pi-mono (`badlogic/pi-mono`)
- No `examples/` directory — usage documented through inline README code blocks only
- Sandcaster would be the first place with runnable pi-ai examples

#### Turborepo + Bun Mechanics
- **Workspace approach:** Add `"examples"` to root `workspaces` array, each example declares `"@sandcaster/core": "workspace:*"`
- **Critical constraint:** Packages must be built first (they point to `./dist/`). Run `bunx turbo build` before examples.

#### Env Var Consensus
- `.env.example` committed to git, `.env` gitignored
- Each var documented with inline comment and docs URL

#### Progressive Complexity Pattern
- Numeric prefixes enforce reading order (`01-basic/`, `02-intermediate/`, `03-advanced/`)
- Root `README.md` acts as curriculum guide

---

## Code References

### Package Entry Points
- `packages/sdk/src/index.ts` — SDK exports
- `packages/sdk/src/client.ts:17` — `SandcasterClient` class
- `packages/sdk/src/types.ts` — All SDK types
- `packages/sdk/src/stream.ts:42` — SSE stream parser
- `packages/core/src/index.ts` — Core exports
- `packages/core/src/sandbox.ts:186` — `runAgentInSandbox()`
- `packages/core/src/branching/branch-orchestrator.ts:225` — `runBranchedAgent()`
- `packages/core/src/session-manager.ts` — `SessionManager`
- `packages/core/src/config.ts:61` — `loadConfig()`
- `packages/core/src/schemas.ts:182` — `SandcasterConfigSchema`
- `packages/core/src/sandbox-resolver.ts:74` — `resolveSandboxProvider()`
- `packages/core/src/sandbox-registry.ts:37` — `getSandboxProvider()`
- `packages/core/src/model-aliases.ts:8` — Model alias mapping
- `packages/core/src/errors.ts` — Error hierarchy
- `packages/core/src/sandbox-provider.ts:74` — `SandboxInstance` interface
- `packages/core/src/sandbox-provider.ts:94` — `CreateResult` type

### API Server
- `apps/api/src/app.ts:12` — `createApp()`
- `apps/api/src/node.ts:1` — Standalone server
- `apps/api/src/types.ts:8` — `AppDeps`
- `apps/api/src/routes/query.ts:14` — POST /query
- `apps/api/src/routes/sessions.ts:47` — Session routes
- `apps/api/src/routes/health.ts` — Health check

### CLI
- `apps/cli/src/index.ts:1` — CLI entry point
- `apps/cli/src/commands/query.tsx:240` — Query command
- `apps/cli/src/commands/serve.ts:96` — Serve command
- `apps/cli/src/commands/session.ts:186` — Session commands
- `apps/cli/src/commands/init.ts` — Init command
- `apps/cli/src/commands/templates.ts` — Templates command

### Tests (Usage Examples)
- `packages/sdk/src/__tests__/client.test.ts` — SDK client usage patterns
- `packages/sdk/src/__tests__/session.test.ts` — Session lifecycle patterns
- `packages/sdk/src/__tests__/types.test.ts` — Event type narrowing
- `apps/api/src/__tests__/integration.test.ts` — API integration patterns
- `packages/core/src/__tests__/session/session-manager.test.ts` — SessionManager usage
- `packages/core/src/__tests__/sandbox-integration.test.ts` — Provider registration

### Existing Scripts
- `scripts/create-template.ts` — Top-level await script pattern

### Sandstorm Examples
- `/Users/iamladi/Projects/experiments/sandstorm/examples/` — 7 example directories
- `/Users/iamladi/Projects/experiments/sandstorm/src/sandstorm/client.py:33` — Python client pattern

---

## Architecture Documentation

### Data Flow: User Prompt → Result

```
User prompt
  → CLI (citty) / SDK client / API POST /query
    → QueryRequestSchema validation (Zod)
    → loadConfig() from sandcaster.json
    → runAgentInSandbox() OR runBranchedAgent()
      → resolveSandboxProvider() → getSandboxProvider()
      → provider.create() → SandboxInstance
      → Upload runner.mjs + agent_config.json + files
      → instance.commands.run("node /opt/sandcaster/runner.mjs")
        → [Inside sandbox] Agent.prompt() with tools
        → Events streamed as JSON lines to stdout
      → Parse JSON lines → yield SandcasterEvent
      → Extract generated files
      → Kill sandbox
    → SSE stream to client
```

### Example Coverage Matrix

The examples should cover these interaction layers:

| Layer | Package | Key Entry Point | Minimum Env Vars |
|-------|---------|----------------|------------------|
| SDK Client → API | `@sandcaster/sdk` | `new SandcasterClient()` | `SANDCASTER_API_URL`, LLM key |
| Core Direct | `@sandcaster/core` | `runAgentInSandbox()` | `E2B_API_KEY`, LLM key |
| Core Sessions | `@sandcaster/core` | `SessionManager` | `E2B_API_KEY`, LLM key |
| Core Branching | `@sandcaster/core` | `runBranchedAgent()` | `E2B_API_KEY`, LLM key |
| API Server | `@sandcaster/api` | `createApp()` | `E2B_API_KEY`, LLM key |
| CLI | `@sandcaster/cli` | `sandcaster "prompt"` | `E2B_API_KEY`, LLM key |

---

## Related Research

- `research/research-sandcaster-rewrite-deep.md` — Full architecture research for the rewrite
- `research/research-multi-provider-sandbox-architecture.md` — Sandbox provider system
- `plans/` — Implementation plans 01-09
- Sandstorm source at `/Users/iamladi/Projects/experiments/sandstorm`
- [e2b-dev/e2b-cookbook](https://github.com/e2b-dev/e2b-cookbook) — 42 E2B examples
- [vercel/ai examples](https://github.com/vercel/ai) — In-monorepo example workspace pattern
- [honojs/examples](https://github.com/honojs/examples) — Workspace-per-example pattern
- [badlogic/pi-mono](https://github.com/badlogic/pi-mono) — Pi-ai source (no examples)

---

## Follow-up Research [2026-03-19]

### User Decisions

1. **Default sandbox provider:** E2B for most examples. Dedicated provider-specific examples for Vercel, Cloudflare, and Docker to show setup.
2. **Default LLM model:** `gpt-5.4-mini` (OpenAI) — chosen for cost savings, considered smarter and cheaper than Haiku 4.5.
3. **Format:** Standalone `.ts` scripts in root `examples/` directory.
4. **Credentials:** Real credentials required (no mock fallback).
5. **Audience:** Both evaluators (quick-start) and integrators (detailed).
6. **Scope:** All four layers — SDK client, CLI, Core internals, API server.

### Blocker: `gpt-5.4-mini` Not in Model Alias Map

The current alias map at `packages/core/src/runner/model-aliases.ts:7-13` contains:

```ts
const ALIAS_MAP = {
  sonnet:  { provider: "anthropic", modelId: "claude-sonnet-4-6" },
  opus:    { provider: "anthropic", modelId: "claude-opus-4-6" },
  haiku:   { provider: "anthropic", modelId: "claude-haiku-4-5" },
  gpt5:    { provider: "openai",   modelId: "gpt-5.4" },
  gemini:  { provider: "google",   modelId: "gemini-3.1-pro-preview" },
};
```

`gpt-5.4-mini` is **not** a known alias. The fallback at line 33 tries `getModel("anthropic", alias)` which would fail for an OpenAI model. **A new alias must be added before examples can use it.**

Proposed addition:
```ts
gpt5mini: { provider: "openai", modelId: "gpt-5.4-mini" },
```

This requires a code change + test update in `packages/core/src/__tests__/runner/model-aliases.test.ts`.

### Revised Example Plan

Given the decisions, the examples should be structured as:

**E2B examples (default provider):**
- `01-hello-sandbox/` — Minimal: run a prompt in E2B sandbox, print events
- `02-file-upload/` — Upload files to sandbox, run agent, extract results
- `03-structured-output/` — Use `outputFormat` for JSON output
- `04-sessions/` — Create session, send follow-up messages, list/delete
- `05-speculative-branching/` — Run branched agent with evaluator
- `06-sdk-client/` — Use SDK against running API server
- `07-api-server/` — Start Hono server programmatically, query it

**Provider-specific examples:**
- `08-provider-vercel/` — Setup and run with Vercel sandboxes (`VERCEL_TOKEN`)
- `09-provider-cloudflare/` — Setup and run with Cloudflare sandboxes (`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_SANDBOX_WORKER_URL`)
- `10-provider-docker/` — Setup and run with local Docker (no API key needed)

**All examples use `model: "gpt5mini"` (pending alias addition) with `OPENAI_API_KEY`.**

### Required Env Vars Per Example

| Example | Sandbox Env Var | LLM Env Var |
|---------|----------------|-------------|
| 01-07 (E2B) | `E2B_API_KEY` | `OPENAI_API_KEY` |
| 06 (SDK) | `SANDCASTER_API_URL` | `OPENAI_API_KEY` |
| 08 (Vercel) | `VERCEL_TOKEN` | `OPENAI_API_KEY` |
| 09 (Cloudflare) | `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_SANDBOX_WORKER_URL` | `OPENAI_API_KEY` |
| 10 (Docker) | Docker daemon running | `OPENAI_API_KEY` |

---

## Open Questions

1. **Workspace vs. flat scripts:** Should `examples/` be a workspace member (like Vercel AI SDK) or flat standalone scripts? Workspace approach gives `workspace:*` resolution but requires `bunx turbo build` first. Flat approach is simpler but needs manual path resolution.
2. **API server dependency:** SDK client example (06) requires a running API server. Should it start its own server inline, or document "run `sandcaster serve` in another terminal"?
3. **E2B template requirement:** Does the default E2B template work out-of-the-box for examples, or does the user need to run `scripts/create-template.ts` first?
4. **Cost awareness:** Real sandboxes cost money. Should examples document approximate cost per run?
