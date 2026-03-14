---
title: "Multi-provider sandbox architecture"
type: Refactor
issue: 4
research: ["research/research-multi-provider-sandbox-architecture.md"]
status: Ready for Implementation
reviewed: true
reviewers: ["codex", "gemini"]
created: 2026-03-14
---

# PRD: Multi-Provider Sandbox Architecture

## Metadata
- **Type**: Refactor
- **Priority**: High
- **Severity**: N/A
- **Estimated Complexity**: 8
- **Created**: 2026-03-14
- **Status**: Ready for Implementation

## Overview

### Problem Statement

Sandcaster is hardcoded to E2B for sandbox execution. The E2B coupling is concentrated in 2 core files (`sandbox.ts`, `files.ts`) but prevents users from choosing alternative providers like Vercel Sandbox, Cloudflare Containers, or local Docker. There is no abstraction layer — switching providers requires rewriting core execution logic.

### Goals & Objectives

1. Define a `SandboxProvider` interface that captures the minimal runtime API surface (create, files.write, files.read, commands.run, kill)
2. Refactor existing E2B code behind this interface with zero behavioral regression
3. Add Vercel Sandbox, Cloudflare Containers, and local Docker as alternative providers
4. Enable per-request and per-config provider selection with env-var auto-detection fallback
5. Remove the E2B-specific webhook infrastructure (clean break for future multi-provider lifecycle events)

### Success Metrics

- **Primary Metric**: All existing tests pass after E2B refactor (zero regression)
- **Secondary Metrics**: At least 2 alternative providers (Vercel + Docker) are functional with tests
- **Quality Gates**: Provider interface has full test coverage; each provider has unit tests with mocked SDK

## User Stories

### Story 1: Provider selection via config
- **As a**: Sandcaster user
- **I want**: to set `sandboxProvider: "vercel"` in my `sandcaster.json`
- **So that**: my agents run in Vercel Sandbox instead of E2B
- **Acceptance Criteria**:
  - [ ] `sandboxProvider` field accepted in `sandcaster.json`
  - [ ] `sandboxProvider` field accepted in API request body
  - [ ] Provider resolved via: request > config > env auto-detect > "e2b" default

### Story 2: Auto-detection from API keys
- **As a**: developer with `VERCEL_TOKEN` set but no `E2B_API_KEY`
- **I want**: Sandcaster to auto-detect and use Vercel Sandbox
- **So that**: I don't need to explicitly configure the sandbox provider
- **Acceptance Criteria**:
  - [ ] Auto-detection order: `E2B_API_KEY` → e2b, `VERCEL_TOKEN` → vercel, `CLOUDFLARE_API_TOKEN` → cloudflare
  - [ ] Falls back to "e2b" when no keys detected

### Story 3: Local development without cloud keys
- **As a**: developer without cloud provider API keys
- **I want**: to run agents in a local Docker container
- **So that**: I can develop and test without cloud dependencies
- **Acceptance Criteria**:
  - [ ] `sandboxProvider: "docker"` uses local Docker
  - [ ] Docker provider works without any cloud API keys
  - [ ] Runner bundle and file operations work identically to cloud providers

### Story 4: SDK consumer selects provider
- **As a**: SDK consumer
- **I want**: to pass `sandboxProvider` in my query request
- **So that**: I can choose the sandbox provider per API call
- **Acceptance Criteria**:
  - [ ] `@sandcaster/sdk` `QueryRequest` type includes `sandboxProvider` field
  - [ ] Field is passed through to API and respected

## Requirements

### Functional Requirements

1. **FR-1**: Provider interface with `create()` returning Result type (`{ ok, instance }` | `{ ok, code, message, hint }`)
   - Details: No exceptions for expected failures (auth, rate limit, timeout). Provider normalizes its own SDK errors. All `SandboxInstance` methods (files.write, files.read, commands.run, kill) throw `SandboxOperationError` with a standard `{ code, message, hint }` shape for post-create failures. `kill()` must be idempotent (no throw on double-kill or already-stopped sandbox).
   <!-- Addressed: Unified error contract for all provider operations, not just create() [Codex: Error Contract Stops at create()] -->
   - Priority: Must Have

2. **FR-2**: Provider registry with lazy dynamic import
   - Details: Only import provider SDK when that provider is selected. `import("e2b")` / `import("@vercel/sandbox")` at runtime. When a dynamic import fails with `MODULE_NOT_FOUND`, return a specific error code `PROVIDER_SDK_MISSING` with hint: `"Install the provider SDK: bun add @vercel/sandbox"`.
   <!-- Addressed: Explicit MODULE_NOT_FOUND error mapping [Consensus: Missing-Module Failure Path] -->
   - Priority: Must Have

3. **FR-3**: Provider resolution chain: `request.sandboxProvider` > `config.sandboxProvider` > env auto-detect > `"e2b"`
   - Details: Follows existing model-aliases pattern. Auto-detection from env vars. Credential resolution follows the same chain: `request.apiKeys.<provider>` > env var for that provider. When no credentials exist for the resolved provider, return error code `PROVIDER_AUTH_MISSING` with hint listing the required env vars. When no cloud keys exist AND no explicit provider is set, auto-detect falls back to `"docker"` (if Docker is available) before defaulting to `"e2b"` (which will fail without a key). Unknown provider names from config/env fail fast with validation error listing known providers.
   <!-- Addressed: Credential precedence undefined [Codex], No-credentials conflicts with Docker story [Codex], Invalid provider config behavior [Codex] -->
   - Priority: Must Have

4. **FR-4**: `SandboxInstance` exposes `workDir` property
   - Details: Each provider returns its native default (`/home/user` for E2B, `/vercel/sandbox` for Vercel). All file operations use `instance.workDir`.
   - Priority: Must Have

5. **FR-5**: Capability matrix with graceful degradation
   - Details: Full 8-boolean `SandboxCapabilities` interface. Capabilities are classified as **degradable** (streaming → buffered output, networkPolicy → ignored, snapshots → ignored, reconnect → ignored) or **hard-required** (fileSystem, shellExec, envInjection — all providers must support these). When a degradable capability is missing, the orchestrator falls back silently. When a hard-required capability is missing, `create()` returns error code `CAPABILITY_MISSING` listing the missing capability. `commands.run` must accept optional `timeoutMs` parameter; when a command exceeds it, the provider kills the command and returns `exitCode: -1` with stderr indicating timeout. Providers must support `AbortSignal` on streaming commands for cancellation.
   <!-- Addressed: Capability matrix ambiguity [Codex], Timeout/cancellation semantics [Codex] -->
   - Priority: Must Have

6. **FR-6**: Remove E2B webhook infrastructure
   - Details: Remove `/webhooks/e2b` route, CLI webhook commands, `webhookUrl` from `SandcasterConfigSchema`, and related test files.
   - Priority: Must Have

7. **FR-7**: Schema extensions for `sandboxProvider` field
   - Details: Add `SANDBOX_PROVIDER_VALUES` const, `sandboxProvider` to `QueryRequestSchema` and `SandcasterConfigSchema`, extend `apiKeys` with `vercel` and `cloudflare` fields.
   - Priority: Must Have

8. **FR-8**: Cloudflare provider using `@cloudflare/sandbox` SDK
   - Details: Cloudflare ships a Sandbox SDK (`@cloudflare/sandbox`) with built-in `exec()`, `execStream()`, `readFile()`, `writeFile()` — no custom sidecar HTTP server needed. The provider wraps this SDK. Note: requires a Cloudflare Worker to host the Durable Object binding — the provider operates through a deployed Worker endpoint, not direct SDK calls from the Sandcaster process.
   - Priority: Should Have

9. **FR-9**: Guaranteed cleanup on partial failure
   - Details: `runAgentInSandbox()` must call `kill()` in a `finally` block after successful `create()`, regardless of failures during upload/run/extract. `kill()` must be idempotent across all providers. Docker provider must create containers with `--rm` flag or label containers for garbage collection on startup.
   <!-- Addressed: Cleanup on partial failure [Codex], Docker zombie container leaks [Gemini] -->
   - Priority: Must Have

10. **FR-10**: Template/image ID validation per provider
    - Details: When `sandboxProvider` is overridden per-request but the config contains a provider-specific template ID (e.g., E2B template name passed to Vercel), the provider's `create()` must validate the identifier format and return error code `INVALID_TEMPLATE_FOR_PROVIDER` with a clear hint, rather than passing it through to fail cryptically at the SDK level.
    <!-- Addressed: Cross-provider template incompatibility [Gemini] -->
    - Priority: Must Have

11. **FR-11**: API key redaction in logs/events/errors
    - Details: Any log output, error message, or SandcasterEvent that might include request payload data must redact `apiKeys.*` fields. Provider error messages must never include raw API keys or tokens.
    <!-- Addressed: Secret handling for new apiKeys fields [Codex] -->
    - Priority: Must Have

### Non-Functional Requirements

1. **NFR-1**: Bundle size
   - Requirement: Provider SDKs must not be bundled unless used
   - Target: Zero additional bundle size when using default E2B provider
   - Measurement: `bunx turbo build` output size unchanged for E2B-only usage

2. **NFR-2**: Cold start parity
   - Requirement: Provider abstraction must not add measurable latency to sandbox creation
   - Target: <10ms overhead from provider resolution + dynamic import
   - Measurement: Benchmark before/after

3. **NFR-3**: Error fidelity
   - Requirement: Provider-normalized errors must preserve actionable hints
   - Target: Every error code has a user-facing hint string
   - Measurement: Test coverage for all error classification paths

### Technical Requirements

- **Stack**: TypeScript ESM, Bun, Vitest 4, Hono (for Cloudflare sidecar)
- **Dependencies**: `@vercel/sandbox@^1.8` (new, optional peer — avoid 2.x beta which has breaking renames), `@cloudflare/sandbox` (for CF worker package), `dockerode` or `execa` (for Docker provider)
- **Architecture**: Strategy pattern + registry with lazy dynamic imports. No decorators.
- **Data Model**: No database changes. Schema-only additions.
- **API Contracts**: `POST /query` body gains optional `sandboxProvider` field. No breaking changes.

## Scope

### In Scope

- `SandboxProvider` interface, `SandboxInstance` interface, `SandboxCapabilities` interface
- Provider registry with lazy dynamic import
- Provider resolution function (request > config > env > default)
- E2B provider (refactor existing code)
- Vercel Sandbox provider
- Docker provider (local dev/test)
- Cloudflare Containers provider + Cloudflare Worker proxy (using `@cloudflare/sandbox` SDK)
- Schema extensions (`SANDBOX_PROVIDER_VALUES`, `sandboxProvider` field, `apiKeys` extensions)
- SDK type updates (`sandboxProvider` field in `QueryRequest`)
- Webhook removal (route, CLI commands, config field, tests)
- Error normalization (Result type pattern, provider-specific error mapping)
- `workDir` on `SandboxInstance`
- Tests for all new code

### Out of Scope

- Provider-specific webhook/lifecycle event abstraction (deferred)
- Cost tracking normalization across providers (deferred)
- Vercel snapshot management CLI commands
- Cloudflare container deployment tooling (wrangler config)
- Migration tooling for existing `sandcaster.json` files
- Multi-provider concurrent execution (running same agent on multiple providers)

### Future Considerations

- Abstract lifecycle webhook system per provider
- Cost estimation normalization (`costUsd` in result events per provider)
- Provider health checks and automatic failover
- Snapshot/template management CLI per provider

## Impact Analysis

### Affected Areas

- `packages/core/src/sandbox.ts` — Major refactor: extract provider-agnostic orchestration
- `packages/core/src/files.ts` — Change `Sandbox` type to `SandboxInstance`, use `workDir`
- `packages/core/src/schemas.ts` — Add `SANDBOX_PROVIDER_VALUES`, extend schemas
- `packages/core/src/errors.ts` — Add `SandboxErrorCode` type
- `packages/core/src/index.ts` — Export new modules
- `packages/sdk/src/types.ts` — Add `sandboxProvider` to `QueryRequest`
- `apps/api/src/app.ts` — Remove webhook route registration
- `apps/api/src/routes/webhooks.ts` — Delete
- `apps/api/src/__tests__/routes/webhooks.test.ts` — Delete
- `apps/cli/src/commands/webhook.ts` — Delete
- `apps/api/src/types.ts` — Remove `webhookSecret` from `AppDeps`

### Users Affected

- **API consumers**: Gain optional `sandboxProvider` field (non-breaking)
- **SDK consumers**: Gain optional `sandboxProvider` field (non-breaking)
- **CLI users**: Lose `webhook` commands (breaking but low-usage feature)
- **Config users**: `webhookUrl` field no longer recognized (breaking, silent ignore via schema)

### System Impact

- **Performance**: Negligible — one dynamic import on first use, then cached
- **Security**: Cloudflare Worker proxy requires authentication (ephemeral token generated at sandbox creation, validated via Authorization header on all proxy requests). New `apiKeys` fields (vercel, cloudflare) must be redacted in all log/error output. Each provider handles its own auth validation.
<!-- Addressed: Cloudflare sidecar/worker security [Consensus: Critical] -->
- **Data Integrity**: No data model changes

### Dependencies

- **Upstream**: None
- **Downstream**: `@sandcaster/sdk` types, `@sandcaster/api` routes
- **External**: `@vercel/sandbox` (new optional dep), Docker daemon (for Docker provider)

### Breaking Changes

- [ ] CLI `webhook` commands removed
- [ ] `webhookUrl` config field removed from `SandcasterConfigSchema`
- [ ] `/webhooks/e2b` API route removed
- [ ] `webhookSecret` removed from `AppDeps` type

## Solution Design

### Approach

**Strategy pattern with lazy registry.** Each provider implements a `SandboxProvider` interface. Providers are registered by name and loaded via dynamic `import()` on first use. The existing `runAgentInSandbox()` function is refactored to accept a `SandboxInstance` (created by the resolved provider) instead of directly calling E2B APIs.

**Key design decisions from interview:**

1. **Result type for create()** — `provider.create()` returns `{ ok: true, instance }` or `{ ok: false, code, message, hint }`. No exceptions for expected failures. This eliminates `classifySandboxError()` and moves error classification into each provider.

2. **Lazy dynamic import** — Provider SDKs loaded via `import("e2b")` / `import("@vercel/sandbox")` only when selected. Keeps bundle lean.

3. **Opaque template ID** — The `template` field in config maps to different concepts per provider (E2B template name, Vercel snapshot ID, Docker image tag) but is treated as an opaque string.

4. **Provider supplies `workDir`** — `SandboxInstance.workDir` returns the provider's native working directory. `files.ts` uses this instead of hardcoded `/home/user`.

5. **Full capability matrix with graceful degradation** — 8 boolean flags. When a required capability is missing, fall back (e.g., buffered output when streaming unavailable) rather than failing.

6. **Webhook removal** — Clean break. Remove all webhook infrastructure. Re-add with proper multi-provider design later.

### Alternatives Considered

1. **Plugin packages (e.g. `@sandcaster/provider-vercel`)**
   - Pros: Maximum decoupling, independent versioning
   - Cons: More repo structure changes, harder to coordinate interface changes
   - Why rejected: Over-engineering for a private monorepo. Lazy dynamic imports achieve the same bundle isolation.

2. **Central error classifier with provider hints**
   - Pros: Less change to sandbox.ts
   - Cons: Muddier ownership, provider still needs to know about hint taxonomy
   - Why rejected: Result type is cleaner — no exceptions for expected failures.

3. **Explicit-only provider selection (no auto-detect)**
   - Pros: Simpler, no magic
   - Cons: Poor DX — forces users to always set `sandboxProvider`
   - Why rejected: Auto-detect from env vars matches existing model-aliases pattern.

### Data Model Changes

None. Schema-only additions to `QueryRequestSchema` and `SandcasterConfigSchema`.

### API Changes

- `POST /query` body: Optional `sandboxProvider` field (one of `SANDBOX_PROVIDER_VALUES`)
- `POST /query` body: `apiKeys` gains optional `vercel` and `cloudflare` fields
- `POST /webhooks/e2b`: **Removed**
- `DELETE /webhooks/e2b`: N/A (was CLI-only, not an API route)

### UI/UX Changes

- CLI loses `webhook register`, `webhook list`, `webhook delete`, `webhook test` commands
- No TUI changes — provider selection is config/env driven

## Implementation Plan

### Phase 1: Webhook Removal (Pre-cleanup)
**Complexity**: 2 | **Priority**: High

<!-- Addressed: Webhook deletion sequence causes rework [Gemini] — delete legacy webhook code BEFORE extracting E2B provider to avoid refactoring dead code -->

- [ ] Delete `apps/api/src/routes/webhooks.ts`
- [ ] Delete `apps/api/src/__tests__/routes/webhooks.test.ts`
- [ ] Delete `apps/cli/src/commands/webhook.ts`
- [ ] Update `apps/api/src/app.ts` — Remove `registerWebhookRoutes` import and call
- [ ] Update `apps/api/src/types.ts` — Remove `webhookSecret` from `AppDeps`
- [ ] Update `packages/core/src/schemas.ts` — Remove `webhookUrl` from `SandcasterConfigSchema`
- [ ] Update any tests referencing `webhookSecret` or webhook routes (check `app.test.ts`, `integration.test.ts`)
- [ ] Verify: `bunx turbo test` still passes

### Phase 2: Interface, Registry & Schema Foundation
**Complexity**: 4 | **Priority**: High

- [ ] Create `packages/core/src/sandbox-provider.ts` — `SandboxProvider`, `SandboxInstance`, `SandboxCapabilities`, `SandboxProviderConfig`, `CreateResult`, `SandboxErrorCode`, `SandboxOperationError` types. Include `workDir` on `SandboxInstance`. Define degradable vs hard-required capabilities. Add `timeoutMs` and `signal` to command options. Require idempotent `kill()`.
- [ ] Create `packages/core/src/sandbox-registry.ts` — Provider registry with `registerSandboxProvider()`, `getSandboxProvider()`, lazy dynamic import loader. Catch `MODULE_NOT_FOUND` errors → return `PROVIDER_SDK_MISSING` with install hint.
- [ ] Create `packages/core/src/sandbox-resolver.ts` — `resolveSandboxProvider()` function implementing resolution chain (request > config > env > default). Include credential resolution matrix per provider. When no cloud keys and no explicit provider, try Docker fallback. Unknown provider names fail fast with validation error.
- [ ] Extend `packages/core/src/schemas.ts` — Add `SANDBOX_PROVIDER_VALUES`, `sandboxProvider` field to both schemas, extend `apiKeys` with `vercel` and `cloudflare`
- [ ] Extend `packages/core/src/errors.ts` — Add `SandboxErrorCode` type, `SandboxOperationError` class
- [ ] Tests: `sandbox-provider.test.ts` (type assertions), `sandbox-registry.test.ts` (registration, resolution, unknown provider error, `PROVIDER_SDK_MISSING` on missing module), `sandbox-resolver.test.ts` (all resolution paths including no-credentials fallback to Docker, unknown provider validation error, credential precedence matrix)

### Phase 3: E2B Provider Extraction & Core Refactor
**Complexity**: 5 | **Priority**: High

- [ ] Create `packages/core/src/providers/e2b.ts` — Extract E2B-specific code from `sandbox.ts` into provider implementing `SandboxProvider` interface with Result type error handling. Template validation: verify template string format. Idempotent `kill()`.
- [ ] Refactor `packages/core/src/sandbox.ts` — `runAgentInSandbox()` now resolves provider, calls `provider.create()`, works with `SandboxInstance`. Remove `classifySandboxError()`, remove direct E2B imports. Guaranteed `kill()` in `finally` block after successful `create()` (FR-9). Redact `apiKeys` in any error/log output (FR-11).
- [ ] Refactor `packages/core/src/files.ts` — Replace `import type { Sandbox } from "e2b"` with `import type { SandboxInstance }`. Replace hardcoded `/home/user` with `instance.workDir`
- [ ] Update `packages/core/src/index.ts` — Export new modules (sandbox-provider, sandbox-registry, sandbox-resolver)
- [ ] Update existing tests: `sandbox.test.ts` (remove E2B mock, test provider-agnostic flow), `files.test.ts` (use `SandboxInstance` mock with `workDir`)
- [ ] Tests: `providers/e2b.test.ts` (create success, all 5 E2B error types mapped to Result codes, file ops, command ops with timeout, kill idempotent, template validation)

### Phase 4: Vercel Sandbox Provider
**Complexity**: 4 | **Priority**: High

- [ ] Add `@vercel/sandbox@^1.8` as optional dependency in `packages/core/package.json` (pin to 1.x — 2.x beta has breaking `sandbox`→`session` rename)
- [ ] Create `packages/core/src/providers/vercel.ts` — Vercel provider implementation:
  - Create with snapshots, writeFiles batch (requires Buffer), readFileToBuffer, runCommand with `sh -c` wrapper, stop
  - Auth: SDK reads from env vars only (no constructor args) — require `VERCEL_TOKEN` + `VERCEL_TEAM_ID` + `VERCEL_PROJECT_ID` for non-Vercel environments, or `VERCEL_OIDC_TOKEN` for Vercel deployments
  - `workDir`: `/vercel/sandbox` (Vercel default). Must call `mkDir()` before `writeFiles()` if target dir doesn't exist
  - Non-zero exit codes returned, not thrown — check `exitCode` explicitly
  - `logs()` throws `StreamError` if sandbox stops mid-stream — needs try/catch around async iteration
- [ ] Handle streaming adaptation: Vercel's `command.logs()` AsyncGenerator → callback-based `onStdout`/`onStderr` for `SandboxInstance.commands.run`
- [ ] Handle graceful degradation: Buffer output when streaming callbacks not provided
- [ ] Tests: `providers/vercel.test.ts` (create, file ops with Buffer conversion, mkDir before write, command execution with exit code check, streaming bridge with StreamError handling, error mapping, snapshot support, auth failure, rate limit, timeout, template validation for snapshot IDs)
<!-- Addressed: Negative-path test coverage [Codex] — error matrix for all provider-specific failure modes -->

### Phase 5: Local Docker Provider
**Complexity**: 4 | **Priority**: Medium

- [ ] Use `execa` + `docker` CLI for Docker interaction (resolved: lighter than `dockerode`, sufficient for dev/test use case, Bun-compatible)
<!-- Addressed: Docker dependency choice unresolved [Codex] -->
- [ ] Create `packages/core/src/providers/docker.ts` — Docker provider: pull/start container with `--rm` flag (auto-remove on stop to prevent zombie containers), `docker exec` for commands, `docker cp` for file I/O, `docker rm -f` for kill (idempotent). Label containers with `sandcaster=true` for garbage collection. On provider init, reap any orphaned `sandcaster=true` containers from previous crashed sessions.
<!-- Addressed: Docker zombie container leaks [Gemini] -->
- [ ] Define default Docker image requirements (Node.js, runner dependencies pre-installed)
- [ ] Create `Dockerfile.sandbox` in repo root — Base image for local sandbox execution
- [ ] Tests: `providers/docker.test.ts` (create with mocked execa, file ops, command exec with timeout, kill idempotent, container cleanup with --rm, orphan reaping, auth failure N/A for Docker, template validation for Docker image tags)

### Phase 6: Cloudflare Containers Provider
**Complexity**: 5 | **Priority**: Medium

**Updated based on web research:** Cloudflare ships `@cloudflare/sandbox` SDK with built-in `exec()`, `execStream()`, `readFile()`, `writeFile()` — no custom sidecar HTTP server needed. However, the Sandbox SDK operates inside a Cloudflare Worker context (Durable Objects binding). The Sandcaster provider must communicate with a deployed Worker that proxies sandbox operations.

- [ ] Create `packages/cloudflare-worker/` — New package: Cloudflare Worker that exposes Sandcaster-compatible HTTP endpoints backed by `@cloudflare/sandbox`
  - **Authentication**: Generate ephemeral token on sandbox creation, require `Authorization: Bearer <token>` on all subsequent requests. Token stored in Durable Object state, validated on every proxy call.
  <!-- Addressed: Cloudflare Worker security [Consensus: Critical] -->
  - `POST /sandbox/create` — Create sandbox session, return `{ sessionId, token }`
  - `POST /sandbox/:id/files/write` — Proxy to `sandbox.writeFile()` (requires auth)
  - `GET /sandbox/:id/files/read` — Proxy to `sandbox.readFile()` (requires auth)
  - `POST /sandbox/:id/exec` — Proxy to `sandbox.exec()` → `{ stdout, stderr, exitCode }` (requires auth)
  - `POST /sandbox/:id/exec/stream` — Proxy to `sandbox.execStream()` via SSE (requires auth)
  - `POST /sandbox/:id/kill` — Proxy to `sandbox.destroy()` (requires auth)
- [ ] Create `packages/core/src/providers/cloudflare.ts` — Cloudflare provider: communicate with deployed Worker via HTTP/fetch. Store ephemeral auth token from create response, attach to all subsequent requests.
- [ ] Handle `@cloudflare/sandbox` constraints: no stdin support, ephemeral storage (design for cold-start reinit), Workers subrequest limits (use WebSocket transport if available)
- [ ] Handle graceful degradation for streaming: SSE from Worker → callback bridge
- [ ] Tests: `providers/cloudflare.test.ts` (HTTP interaction mocked, auth token flow, unauthorized request rejection, all error codes), `cloudflare-worker/` unit tests for all endpoints including auth middleware
<!-- Addressed: Negative-path test coverage [Codex] -->

### Phase 7: SDK Update & Integration Testing
**Complexity**: 3 | **Priority**: High

- [ ] Update `packages/sdk/src/types.ts` — Add `sandboxProvider` field to `QueryRequest`, extend `apiKeys` with `vercel` and `cloudflare`
- [ ] Create `packages/core/src/__tests__/sandbox-integration.test.ts` — End-to-end tests with mocked providers: resolve provider → create → upload → run → extract → kill
- [ ] Verify provider resolution chain with all combinations (request, config, env, default)
- [ ] Verify graceful degradation paths (non-streaming provider falls back to buffered output)
- [ ] Verify cleanup guarantee: kill() called after create() even when upload/run/extract fail
- [ ] Verify error propagation: provider returns error Result → correct SandcasterEvent yielded
- [ ] Verify apiKey redaction: no raw keys in error messages or events
- [ ] Run full test suite: `bunx turbo test`
- [ ] Run full build: `bunx turbo build`
- [ ] Run lint: `bunx turbo lint`

## Relevant Files

### Existing Files

- `packages/core/src/sandbox.ts` — Main refactor target: E2B orchestration → provider-agnostic
- `packages/core/src/files.ts` — E2B `Sandbox` type → `SandboxInstance`, hardcoded `/home/user` → `workDir`
- `packages/core/src/schemas.ts` — Add `SANDBOX_PROVIDER_VALUES`, extend schemas
- `packages/core/src/errors.ts` — Add `SandboxErrorCode` type
- `packages/core/src/index.ts` — Export new modules
- `packages/sdk/src/types.ts` — Add `sandboxProvider` to SDK types
- `apps/api/src/app.ts` — Remove webhook route registration
- `apps/api/src/types.ts` — Remove `webhookSecret` from deps
- `apps/api/src/routes/webhooks.ts` — Delete (webhook removal)
- `apps/api/src/__tests__/routes/webhooks.test.ts` — Delete (webhook removal)
- `apps/cli/src/commands/webhook.ts` — Delete (webhook removal)
- `packages/core/src/__tests__/sandbox.test.ts` — Refactor: remove E2B mocks, test provider-agnostic flow
- `packages/core/src/__tests__/files.test.ts` — Refactor: use `SandboxInstance` mock with `workDir`

### New Files

- `packages/core/src/sandbox-provider.ts` — Interface definitions (SandboxProvider, SandboxInstance, SandboxCapabilities, CreateResult, SandboxErrorCode)
- `packages/core/src/sandbox-registry.ts` — Provider registry (register, get, lazy import)
- `packages/core/src/sandbox-resolver.ts` — Provider resolution chain function
- `packages/core/src/providers/e2b.ts` — E2B provider implementation
- `packages/core/src/providers/vercel.ts` — Vercel Sandbox provider implementation
- `packages/core/src/providers/docker.ts` — Local Docker provider implementation
- `packages/core/src/providers/cloudflare.ts` — Cloudflare Containers provider implementation
- `packages/cloudflare-worker/` — Cloudflare Worker proxying `@cloudflare/sandbox` operations as HTTP endpoints
- `Dockerfile.sandbox` — Base Docker image for local provider

### Test Files

- `packages/core/src/__tests__/sandbox-provider.test.ts` — Type contract tests
- `packages/core/src/__tests__/sandbox-registry.test.ts` — Registry tests
- `packages/core/src/__tests__/sandbox-resolver.test.ts` — Resolution chain tests
- `packages/core/src/__tests__/providers/e2b.test.ts` — E2B provider unit tests
- `packages/core/src/__tests__/providers/vercel.test.ts` — Vercel provider unit tests
- `packages/core/src/__tests__/providers/docker.test.ts` — Docker provider unit tests
- `packages/core/src/__tests__/providers/cloudflare.test.ts` — Cloudflare provider unit tests
- `packages/core/src/__tests__/sandbox-integration.test.ts` — Integration tests
- `packages/cloudflare-worker/src/__tests__/` — Worker endpoint tests

## Testing Strategy

### Unit Tests

- Provider interface compliance: Each provider's `create()` returns correct `CreateResult` shape
- E2B error mapping: All 5 E2B error types → correct `SandboxErrorCode`
- Vercel streaming bridge: `command.logs()` AsyncGenerator → `onStdout`/`onStderr` callbacks
- Docker provider: `docker exec`, `docker cp` command construction
- Cloudflare provider: HTTP request construction for all endpoints
- Registry: registration, lookup, unknown provider error
- Resolver: all 4 resolution paths (request, config, env, default), auto-detect from env vars
- Schema validation: `sandboxProvider` field accepted/rejected correctly

### Integration Tests

- Full flow with mock provider: resolve → create → upload → run → extract → kill
- Provider resolution chain with overlapping config (request overrides config overrides env)
- Graceful degradation: non-streaming provider falls back to buffered output
- Error propagation: provider returns error Result → correct SandcasterEvent yielded

### E2E Tests

- Manual: Run actual agent with E2B provider (existing flow, regression check)
- Manual: Run actual agent with Docker provider (local dev scenario)
- Manual: Run actual agent with Vercel Sandbox (requires VERCEL_TOKEN)

### Manual Test Cases

1. **Test Case**: E2B regression
   - Steps: Set `E2B_API_KEY`, run `sandcaster "hello"` with default config
   - Expected: Agent runs identically to before refactor

2. **Test Case**: Provider auto-detection
   - Steps: Unset `E2B_API_KEY`, set `VERCEL_TOKEN`, run `sandcaster "hello"`
   - Expected: Agent runs on Vercel Sandbox

3. **Test Case**: Explicit provider override
   - Steps: Set both keys, add `"sandboxProvider": "vercel"` to `sandcaster.json`
   - Expected: Agent runs on Vercel despite E2B key being present

## Risk Assessment

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Vercel Sandbox SDK API changes | Low | High | Pin version, test against specific SDK version |
| Cloudflare Sandbox SDK evolves (public beta) | Medium | Medium | Pin version, wrap behind provider interface |
| Docker provider file I/O performance (docker cp) | Medium | Medium | Benchmark vs cloud providers, document as dev-only |
| Dynamic import caching behavior differences across runtimes | Low | Medium | Test on Bun specifically, document Node.js compatibility |
| Vercel streaming model (AsyncGenerator) differs from callback model | Medium | Medium | Thorough adapter testing, edge cases for early termination |

### Business Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Webhook removal breaks existing deployments | Low | Medium | Document in changelog, breaking changes section |
| Users confused by provider auto-detection | Low | Low | Clear error messages with detected provider name |

### Mitigation Strategy

Ship Phase 1-2 (interface + E2B refactor) first and validate zero regression before adding alternative providers. Each provider phase is independently shippable and testable.

## Rollback Strategy

### Rollback Steps

1. Revert to previous commit — E2B hardcoded behavior is fully preserved in git history
2. If mid-refactor: the E2B provider extraction is designed to be a pure refactor — same behavior, different code structure
3. If alternative provider fails: set `sandboxProvider: "e2b"` explicitly (auto-detection defaults to E2B anyway)

### Rollback Conditions

- Existing E2B tests fail after Phase 2
- Performance regression >100ms on sandbox creation
- Provider resolution produces unexpected results in production

## Validation Commands

```bash
# Run all tests
bunx turbo test

# Run core package tests only
cd packages/core && bun test

# Run specific provider tests
cd packages/core && bun test src/__tests__/providers/

# Lint all packages
bunx turbo lint

# Build all packages
bunx turbo build

# Verify no E2B imports outside providers/e2b.ts (after Phase 2)
grep -r "from \"e2b\"" packages/core/src/ --include="*.ts" | grep -v "providers/e2b"

# Verify webhook removal
grep -r "webhook" apps/api/src/ --include="*.ts" | wc -l  # should be 0

# Type check
cd packages/core && bunx tsc --noEmit
cd packages/sdk && bunx tsc --noEmit
cd apps/api && bunx tsc --noEmit
```

## Acceptance Criteria

- [ ] `SandboxProvider` interface defined with `create()` returning `CreateResult` (Result type)
- [ ] Provider registry supports registration and lazy dynamic import
- [ ] Provider resolution chain works: request > config > env auto-detect > "e2b"
- [ ] E2B provider extracted — all existing sandbox.test.ts and files.test.ts pass
- [ ] No direct E2B imports outside `providers/e2b.ts`
- [ ] Vercel Sandbox provider implemented with streaming bridge
- [ ] Docker provider implemented for local dev/test with zombie prevention
- [ ] Cloudflare provider + Worker proxy implemented with ephemeral auth
- [ ] Webhook infrastructure completely removed (Phase 1)
- [ ] SDK types updated with `sandboxProvider` field
- [ ] All providers have negative-path test coverage (auth, rate limit, timeout, template validation)
- [ ] API key redaction verified in all error/log output
- [ ] `SandboxInstance.workDir` used instead of hardcoded paths
- [ ] All new code has test coverage
- [ ] `bunx turbo test` passes
- [ ] `bunx turbo build` passes
- [ ] `bunx turbo lint` passes

## Dependencies

### New Dependencies

- `@vercel/sandbox@^1.8` — Vercel Sandbox SDK (optional peer dependency in `packages/core`). Pin to 1.x — 2.0.0-beta has breaking renames (`sandbox`→`session`).
- `@cloudflare/sandbox` — Cloudflare Sandbox SDK (dependency of `packages/cloudflare-worker` only, not core)
- `dockerode@^4` — Docker Engine API client for Node.js (for Docker provider). Alternative: use `execa` + `docker` CLI directly.
- `hono` — Already in monorepo (for Cloudflare Worker package)

### Dependency Updates

- None expected

## Notes & Context

### Additional Context

- The research document (`research/research-multi-provider-sandbox-architecture.md`) contains detailed API surface analysis for all providers
- The Sandstorm reference project (`/Users/iamladi/Projects/experiments/sandstorm`) is E2B-only with no provider abstraction
- Pi-mono's `ApiProvider` registry pattern is the design inspiration for the sandbox provider registry

### Assumptions

- Vercel Sandbox SDK is stable and GA (not beta)
- Docker is available on developer machines for the Docker provider
- Cloudflare Containers public beta is stable enough for a provider implementation
- The `e2b` npm package will remain a required dependency (for the default provider) but alternative provider SDKs are optional

### Constraints

- TDD strict mode is active — tests must be written before implementation
- Biome formatting runs automatically via hook
- ESM-only — no CommonJS
- Bun runtime — dynamic imports must work with Bun's module resolution

### Related Tasks/Issues

- Research: `research/research-multi-provider-sandbox-architecture.md`

### References

- E2B SDK docs: https://e2b.dev/docs
- Vercel Sandbox docs: https://vercel.com/docs/sandbox
- Cloudflare Containers docs: https://developers.cloudflare.com/containers/
- Pi-mono API registry pattern (internal reference)

### Open Questions

- [ ] Should `dockerode` or `execa` + Docker CLI be used for the Docker provider? `execa` is lighter but `dockerode` has better streaming support.
- [ ] Vercel auth auto-detection: SDK reads env vars only (no constructor args). For non-Vercel envs, need `VERCEL_TOKEN` + `VERCEL_TEAM_ID` + `VERCEL_PROJECT_ID`. Should auto-detect check all three, or just `VERCEL_TOKEN`?
- [ ] Cloudflare Worker deployment: The `@cloudflare/sandbox` SDK only works inside a Worker context. Should the plan include a deploy script for the proxy Worker, or is that a manual prerequisite?
- [ ] Cloudflare sandbox constraints: No stdin support on `exec()`, ephemeral storage wiped on sleep. Are these acceptable limitations for agents?

## Blindspot Review

**Reviewers**: GPT-5.3-Codex (xhigh), Gemini 3 Pro
**Date**: 2026-03-14
**Plan Readiness**: Ready (after revisions)

### Addressed Concerns

- [Consensus, Critical] Cloudflare Worker security — unauthenticated RCE risk → Added ephemeral token auth to Phase 6, updated System Impact security section
- [Consensus, High] Missing MODULE_NOT_FOUND handling for lazy imports → Added `PROVIDER_SDK_MISSING` error code to FR-2 and registry tests
- [Codex, High] Error contract stops at create() — file/cmd/kill errors undefined → Extended FR-1 with `SandboxOperationError` for all post-create operations, idempotent `kill()`
- [Codex, High] Timeout/cancellation semantics missing → Added `timeoutMs` and `AbortSignal` to FR-5 command options
- [Codex, High] Cleanup on partial failure — leaked sandboxes → Added FR-9 with `finally` block requirement, Docker `--rm` flag
- [Codex, High] Credential precedence undefined → Extended FR-3 with credential resolution matrix per provider
- [Codex, High] No-credentials path conflicts with Docker story → Added Docker fallback when no cloud keys detected in FR-3
- [Gemini, High] Cross-provider template incompatibility → Added FR-10 with per-provider template ID validation
- [Gemini, Low] Webhook deletion sequence causes rework → Moved webhook removal to Phase 1 (before E2B refactor)
- [Gemini, Medium] Docker zombie container leaks → Added `--rm` flag, container labeling, orphan reaping to Phase 5
- [Codex, High] Secret handling for new apiKeys fields → Added FR-11 with redaction requirement
- [Codex, High] Negative-path test coverage for new providers → Added error matrix requirement to Phases 4-6
- [Codex, Medium] Capability matrix ambiguity → Classified capabilities as degradable vs hard-required in FR-5
- [Codex, Medium] Invalid provider config behavior → Added fail-fast validation to FR-3
- [Codex, Medium] Docker dependency choice unresolved → Resolved: use `execa` + Docker CLI in Phase 5

### Acknowledged but Deferred

- [Codex, Medium] Cloudflare lacks real integration validation — Only mocked tests planned for Cloudflare. Deferred: Cloudflare Sandbox SDK is public beta; real integration tests depend on Cloudflare account setup and Worker deployment which is out of scope for initial implementation.
- [Codex, High] Webhook removal rollback is too coarse — Valid concern about bundling refactor + removal in one plan. Mitigated by moving webhook removal to Phase 1 (isolated commit before any refactoring). Each phase is independently committable.

### Dismissed

- None — all findings were either addressed or deferred with justification.
