---
title: "Executable examples directory"
type: Feature
issue: null
research: ["research/research-executable-examples.md", "research/research-real-world-examples.md"]
status: Ready for Implementation
reviewed: true
reviewers: ["codex", "gemini"]
created: 2026-03-19
---

# PRD: Executable Examples Directory

## Metadata
- **Type**: Feature
- **Priority**: High
- **Estimated Complexity**: 4
- **Created**: 2026-03-19
- **Status**: Ready for Implementation

## Overview

### Problem Statement
Sandcaster has no runnable examples. Users evaluating or integrating the project have to read test files or the Sandstorm predecessor to understand how to use it. We need a set of copy-paste-ready example directories that work out of the box with minimal setup — optimized for both human readers and AI agents (Claude Code, Cursor, etc.).

### Goals & Objectives

1. Create 14 example directories: 6 feature demos, 3 provider examples, and 5 real-world problem-solving examples
2. Each example is fully self-contained: `sandcaster.json` + `README.md`, copyable as a standalone directory
3. Examples work by running `sandcaster "prompt"` from the example directory — no TypeScript compilation, no package.json, no imports
4. Progressive complexity from "hello world" to multi-agent security audits and speculative branching
5. All examples use `gpt5mini` (gpt-5.4-mini) model alias for cost efficiency

### Success Metrics

- **Primary Metric**: A new user can copy any E2B example directory, set `E2B_API_KEY` + `OPENAI_API_KEY`, and run it successfully. Provider examples require their respective env vars (see per-example table below).
- **Secondary Metrics**: Each README is under 50 lines; each `sandcaster.json` is under 80 lines
- **Quality Gates**: All configs validate against `SandcasterConfigSchema` via automated CI test; all READMEs follow consistent format

## User Stories

### Story 1: Evaluator Quick Start
- **As a**: developer evaluating Sandcaster
- **I want**: to copy one example directory and run it immediately
- **So that**: I can see what Sandcaster does without reading the full codebase
- **Acceptance Criteria**:
  - [ ] Can `cp -r examples/01-hello-sandbox ~/test && cd ~/test/01-hello-sandbox`
  - [ ] E2B examples need `E2B_API_KEY` + `OPENAI_API_KEY`; provider examples need their respective vars
  - [ ] Runs with `sandcaster "prompt"` — requires CLI linked globally from monorepo (`bun link` in `apps/cli`)

### Story 2: AI Agent Onboarding
- **As a**: developer using Claude Code or Cursor
- **I want**: example directories with clear README and simple config
- **So that**: my AI assistant can read the example and help me adapt it
- **Acceptance Criteria**:
  - [ ] README explains what the example does, what env vars are needed, and the exact run command
  - [ ] `sandcaster.json` is self-documenting with clear field names
  - [ ] No ambiguous instructions that require human interpretation

### Story 3: Provider Setup
- **As a**: developer using Vercel/Cloudflare/Docker instead of E2B
- **I want**: provider-specific examples showing the exact setup
- **So that**: I know which env vars to set and how the config differs
- **Acceptance Criteria**:
  - [ ] Each provider has a dedicated example directory
  - [ ] README documents provider-specific env vars and setup steps
  - [ ] The minimal config difference from E2B baseline is `sandboxProvider` field (plus any provider-required fields like Cloudflare's worker URL)

## Requirements

### Functional Requirements

1. **FR-1**: Add `gpt5mini` model alias mapping to `gpt-5.4-mini` on OpenAI provider
   - Details: New entry in `ALIAS_MAP` at `packages/core/src/runner/model-aliases.ts:7`
   - Priority: Must Have (prerequisite for all examples)

2. **FR-2**: Create `examples/` root directory with 14 example subdirectories
   - Details: Each contains `sandcaster.json` + `README.md`. 6 feature demos (01-06), 3 provider examples (07-09), 5 real-world examples (10-14)
   - Priority: Must Have

3. **FR-3**: Create root `examples/README.md` as curriculum index
   - Details: Lists all examples with one-line descriptions, env var requirements, and prerequisites
   - Priority: Must Have

4. **FR-4**: Create `.env.example` in `examples/` root for credential documentation
   - Details: Documents all possible env vars across all examples
   - Priority: Must Have

5. **FR-5**: Include sample data in code-analysis examples
   - Details: Examples 02 (code-reviewer), 04 (structured-output), 05 (security-audit) need small sample files so agents have something to analyze when the directory is copied standalone
   - Priority: Must Have
   <!-- Addressed: [Gemini] Missing target data in examples -->

6. **FR-6**: Add automated schema validation test
   - Details: A test in `packages/core` that globs `../../examples/*/sandcaster.json` and asserts each parses cleanly against `SandcasterConfigSchema`
   - Priority: Must Have
   <!-- Addressed: [Consensus] Schema validation to prevent bit-rot -->

### Non-Functional Requirements

1. **NFR-1**: Portability
   - Requirement: Each example directory works when copied outside the monorepo
   - Target: Zero monorepo dependencies — only requires `sandcaster` CLI installed
   - Measurement: Copy test to `/tmp`, verify it runs

2. **NFR-2**: Readability
   - Requirement: READMEs are scannable in under 30 seconds
   - Target: Under 50 lines, 3-section structure (What / Setup / Run)
   - Measurement: Line count check

### Technical Requirements

- **Stack**: JSON config files + Markdown (no TypeScript in examples)
- **Dependencies**: `sandcaster` CLI must be linked globally. From monorepo: `cd apps/cli && bun link`. Root README documents this as the current install path (npm global install deferred until publish).
- **Architecture**: Config-only pattern — `sandcaster.json` auto-loaded from `process.cwd()` by `loadConfig()` at `packages/core/src/config.ts:61`

## Scope

### In Scope

- `gpt5mini` model alias addition (code + test)
- 14 example directories with `sandcaster.json` + `README.md` (6 feature + 3 provider + 5 real-world)
- Root `examples/README.md` index (includes CLI install path via `bun link`, troubleshooting section)
- Root `examples/.env.example`
- `.gitignore` for `examples/` (ignore `.env` files)
- Sample data files for code-analysis and real-world examples (02, 04, 05, 10, 11, 12, 13) so they produce interesting output when copied standalone
- Automated schema validation test that globs `examples/*/sandcaster.json` and asserts they parse against `SandcasterConfigSchema`
<!-- Addressed: [Consensus] Installation paradox — document bun link path -->
<!-- Addressed: [Gemini] Missing target data for code-analysis examples -->
<!-- Addressed: [Consensus] Schema validation CI test to prevent bit-rot -->

### Out of Scope

- TypeScript script examples (no `index.ts` files — config-only pattern)
- Publishing `@sandcaster/sdk` or `@sandcaster/core` to npm
- Automated runtime execution of examples in CI (requires real API keys + costs money)
- Video or GIF demonstrations
- Deploying Cloudflare sandbox worker (documented as prerequisite in 08-provider-cloudflare README)

### Future Considerations

- TypeScript SDK examples once packages are published to npm
- Interactive tutorial mode in CLI
- Example template generator (`sandcaster init --example code-reviewer`)

## Impact Analysis

### Affected Areas

- `packages/core/src/runner/model-aliases.ts` — new alias entry
- `packages/core/src/__tests__/runner/model-aliases.test.ts` — new test case
- `examples/` — new directory tree (no existing files affected)

### Users Affected

- New users evaluating Sandcaster (positive: faster onboarding)
- Existing users (no impact — additive only)

### System Impact

- **Performance**: None — examples are runtime artifacts, not build artifacts
- **Security**: `.env.example` must NOT contain real credentials
- **Data Integrity**: N/A

### Dependencies

- **Upstream**: `sandcaster` CLI must be buildable and runnable
- **Downstream**: None
- **External**: E2B, OpenAI, Vercel, Cloudflare APIs (for running examples)

### Breaking Changes

- [x] **None**

## Solution Design

### Approach

Follow the Sandstorm config-only pattern: each example is a directory containing `sandcaster.json` (agent configuration) and `README.md` (human+AI readable instructions). Users `cd` into an example directory and run `sandcaster "their prompt"`. The CLI auto-loads `sandcaster.json` from `process.cwd()`.

**Directory structure:**
```
examples/
  README.md                      # Curriculum index
  .env.example                   # All env vars documented
  .gitignore                     # Ignore .env files
  01-hello-sandbox/
    sandcaster.json
    README.md
  02-code-reviewer/
    sandcaster.json
    README.md
  03-competitive-analysis/
    sandcaster.json
    README.md
  04-structured-output/
    sandcaster.json
    README.md
  05-multi-agent-security-audit/
    sandcaster.json
    README.md
  06-speculative-branching/
    sandcaster.json
    README.md
  07-provider-vercel/
    sandcaster.json
    README.md
  08-provider-cloudflare/
    sandcaster.json
    README.md
  09-provider-docker/
    sandcaster.json
    README.md
  10-fix-ci-failure/
    sandcaster.json
    README.md
    sample-logs/
  11-generate-tests/
    sandcaster.json
    README.md
    sample-code/
  12-dependency-audit/
    sandcaster.json
    README.md
  13-generate-api-docs/
    sandcaster.json
    README.md
    sample-code/
  14-onboard-to-codebase/
    sandcaster.json
    README.md
```

**README template (per example):**
```markdown
# [Example Name]

[One sentence: what this example does]

## Prerequisites

- sandcaster CLI installed (from monorepo: `cd apps/cli && bun link`)

## Setup

Set environment variables:
```bash
export E2B_API_KEY="your-key"       # https://e2b.dev/dashboard
export OPENAI_API_KEY="your-key"    # https://platform.openai.com/api-keys
```

## Run

```bash
sandcaster "your prompt here"
```

## What Happens

[2-3 sentences explaining what the agent does, what tools it uses, expected output]

## Configuration

See `sandcaster.json` for the full configuration. Key settings:
- `model`: gpt5mini (OpenAI gpt-5.4-mini — cost-efficient default)
- [other notable settings]

## Troubleshooting

- **"No LLM provider API key found"**: Set `OPENAI_API_KEY` in your environment
- **"E2B_API_KEY not set"**: Get a key at https://e2b.dev/dashboard
- **Model not available**: Replace `gpt5mini` with `sonnet`, `haiku`, or `gpt5` in sandcaster.json
```
<!-- Addressed: [Consensus] Installation paradox — document bun link, not npm install -->
<!-- Addressed: [Codex] Error path testing — troubleshooting section per README -->
<!-- Addressed: [Codex] Single model dependency — document model fallback -->

**sandcaster.json field names** (camelCase, matching `SandcasterConfigSchema`):
- `systemPrompt`, `model`, `maxTurns`, `timeout`, `outputFormat`, `allowedTools`, `sandboxProvider`, `branching`

### Alternatives Considered

1. **TypeScript script examples with workspace:* deps**
   - Pros: Shows SDK/API programmatic usage
   - Cons: Not portable (requires monorepo), needs build step, complex setup
   - Why rejected: User requires copy-paste portability

2. **Workspace member examples package**
   - Pros: Runs from monorepo root via `bun run examples/01/index.ts`
   - Cons: Not copyable as standalone directory
   - Why rejected: Conflicts with core requirement of single-directory portability

3. **Hybrid config + TypeScript**
   - Pros: Covers both simple and advanced use cases
   - Cons: Two patterns is confusing; advanced examples can't be portable until npm publish
   - Why rejected: Deferred until packages are published to npm

### Data Model Changes
None.

### API Changes
None.

### UI/UX Changes
None.

## Implementation Plan

### Phase 1: Model Alias Prerequisite
**Complexity**: 1 | **Priority**: High

- [ ] Add test for `gpt5mini` alias in `packages/core/src/__tests__/runner/model-aliases.test.ts`
- [ ] Add `gpt5mini: { provider: "openai", modelId: "gpt-5.4-mini" }` to `ALIAS_MAP` in `packages/core/src/runner/model-aliases.ts:7`
- [ ] Verify existing tests still pass: `bunx vitest run packages/core/src/__tests__/runner/model-aliases.test.ts`

### Phase 2: Examples Infrastructure
**Complexity**: 2 | **Priority**: High

- [ ] Create `examples/` directory
- [ ] Create `examples/README.md` — curriculum index with table of all examples, env var requirements, and run instructions
- [ ] Create `examples/.env.example` — documents all env vars across all examples
- [ ] Create `examples/.gitignore` — ignore `.env` files

### Phase 3: Core Examples (E2B + gpt5mini)
**Complexity**: 3 | **Priority**: High

**Prerequisite gate**: Before creating examples 05 and 06, verify that `agents` and `branching` config fields are fully supported at runtime (not just schema-valid). Run a quick manual test with each config shape.
<!-- Addressed: [Codex] Advanced feature dependencies not proven first -->

- [ ] `01-hello-sandbox/` — Minimal config: just `model` and a short `systemPrompt`. User runs `sandcaster "Hello, what can you do?"`. Demonstrates basic agent loop.
- [ ] `02-code-reviewer/` — Port Sandstorm's code-reviewer: `systemPrompt` for code review, `allowedTools: ["Read", "Glob", "Grep"]`, `outputFormat` with JSON schema for findings. Include `sample-code/` subdirectory with a small buggy TypeScript file for the agent to review. User runs `sandcaster "Review the code in sample-code/"`.
- [ ] `03-competitive-analysis/` — Port Sandstorm's competitive-analysis: `systemPrompt` for market analysis, `outputFormat` with JSON schema for competitors/comparison matrix. User runs `sandcaster "Analyze the CRM market: HubSpot, Salesforce, Pipedrive"`.
- [ ] `04-structured-output/` — Focus on `outputFormat` with a JSON schema. Include `sample-code/` with files containing TODO comments. User runs `sandcaster "Extract all TODO items from sample-code/"`.
- [ ] `05-multi-agent-security-audit/` — Port Sandstorm's security-auditor: uses `agents` field for multi-agent orchestration (dependency-scanner, code-scanner, config-scanner). Include `sample-app/` with a small Express app containing deliberate vulnerabilities.
- [ ] `06-speculative-branching/` — Uses `branching` config: `{ enabled: true, count: 3, trigger: "always", evaluator: "llm-judge" }`. Demonstrates multiple approaches evaluated by LLM. User runs `sandcaster "Write a function to parse CSV files"`.
<!-- Addressed: [Gemini] Missing target data — sample files in code-analysis examples -->

### Phase 4: Provider Examples
**Complexity**: 2 | **Priority**: High

- [ ] `07-provider-vercel/` — Same as 01-hello-sandbox but with `"sandboxProvider": "vercel"`. README documents `VERCEL_TOKEN` setup.
- [ ] `08-provider-cloudflare/` — Same as 01-hello-sandbox but with `"sandboxProvider": "cloudflare"`. README documents `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_SANDBOX_WORKER_URL` setup. README clearly states this requires a pre-deployed Cloudflare sandbox worker and is NOT a 2-minute quick start — links to Cloudflare worker deployment docs.
<!-- Addressed: [Gemini] Unclear provider prerequisites for Cloudflare -->
- [ ] `09-provider-docker/` — Same as 01-hello-sandbox but with `"sandboxProvider": "docker"`. README documents Docker daemon requirements (no API key needed).

### Phase 5: Real-World Problem-Solving Examples
**Complexity**: 3 | **Priority**: High

These examples demonstrate what real problems developer teams can solve with Sandcaster. Each targets a proven pain point with documented enterprise demand.

- [ ] `10-fix-ci-failure/` — Agent reads CI log output, identifies root cause, proposes fix. `systemPrompt`: CI debugger that reads logs, traces to source, and generates a patch. Include `sample-logs/` with a GitHub Actions failure log (build error + test failure). User runs `sandcaster "Fix the CI failure described in sample-logs/build-output.txt"`.
- [ ] `11-generate-tests/` — Agent generates a test suite for an untested module. `systemPrompt`: test writer that reads code and produces tests. Include `sample-code/` with an untested utility module. Uses `branching` to try multiple testing strategies (unit vs integration vs property-based) and pick the best. User runs `sandcaster "Write tests for sample-code/utils.ts"`.
- [ ] `12-dependency-audit/` — Agent runs `npm audit` / `pip audit` in sandbox, cross-references findings, produces prioritized CVE report. `systemPrompt`: dependency security auditor. `outputFormat` with JSON schema for vulnerabilities (severity, package, CVE, fix version). Include `sample-code/` with a `package.json` containing known vulnerable deps. User runs `sandcaster "Audit the dependencies in sample-code/"`.
- [ ] `13-generate-api-docs/` — Agent reads source code and generates OpenAPI spec. `systemPrompt`: API documentation specialist. Include `sample-code/` with a small Hono/Express API. `outputFormat` for structured endpoint documentation. User runs `sandcaster "Generate API documentation for sample-code/"`.
- [ ] `14-onboard-to-codebase/` — Agent reads a codebase and produces an architecture overview document. `systemPrompt`: codebase analyst that traces entry points, dependencies, and key patterns. `outputFormat` for architecture report (modules, data flow, tech stack, patterns). User runs `sandcaster "Explain the architecture of this codebase"`.

### Phase 6: Validation & CI Guard
**Complexity**: 2 | **Priority**: High

- [ ] Add automated test in `packages/core/src/__tests__/examples-schema.test.ts` that globs `../../examples/*/sandcaster.json` and asserts each parses against `SandcasterConfigSchema` without errors
- [ ] Verify all READMEs follow the 5-section template (Example Name / Prerequisites / Setup / Run / What Happens / Configuration / Troubleshooting)
- [ ] Run `bunx turbo build` to ensure no build regressions
- [ ] Run `bunx turbo test` to ensure model alias tests AND schema validation tests pass
<!-- Addressed: [Consensus] Schema validation CI test to prevent bit-rot -->
<!-- Addressed: [Codex] Quality gates lack enforcement path -->

## Relevant Files

### Existing Files
- `packages/core/src/runner/model-aliases.ts` — add `gpt5mini` alias
- `packages/core/src/__tests__/runner/model-aliases.test.ts` — add test for new alias
- `packages/core/src/schemas.ts:182` — `SandcasterConfigSchema` (reference for valid config fields)
- `packages/core/src/config.ts:61` — `loadConfig()` (how config files are loaded)
- `apps/cli/src/index.ts` — CLI entry point (how users run examples)

### New Files
- `examples/README.md` — Curriculum index with CLI install path and per-example env var table
- `examples/.env.example` — Env var documentation
- `examples/.gitignore` — Ignore .env files
- `examples/01-hello-sandbox/sandcaster.json` + `README.md`
- `examples/02-code-reviewer/sandcaster.json` + `README.md` + `sample-code/` (buggy TS file)
- `examples/03-competitive-analysis/sandcaster.json` + `README.md`
- `examples/04-structured-output/sandcaster.json` + `README.md` + `sample-code/` (files with TODOs)
- `examples/05-multi-agent-security-audit/sandcaster.json` + `README.md` + `sample-app/` (vulnerable Express app)
- `examples/06-speculative-branching/sandcaster.json` + `README.md`
- `examples/07-provider-vercel/sandcaster.json` + `README.md`
- `examples/08-provider-cloudflare/sandcaster.json` + `README.md`
- `examples/09-provider-docker/sandcaster.json` + `README.md`
- `examples/10-fix-ci-failure/sandcaster.json` + `README.md` + `sample-logs/` (GitHub Actions failure log)
- `examples/11-generate-tests/sandcaster.json` + `README.md` + `sample-code/` (untested utility module)
- `examples/12-dependency-audit/sandcaster.json` + `README.md` + `sample-code/` (package.json with vulnerable deps)
- `examples/13-generate-api-docs/sandcaster.json` + `README.md` + `sample-code/` (small Hono API)
- `examples/14-onboard-to-codebase/sandcaster.json` + `README.md`

### Test Files
- `packages/core/src/__tests__/runner/model-aliases.test.ts` — add `gpt5mini` test case
- `packages/core/src/__tests__/examples-schema.test.ts` — automated schema validation for all example configs

## Testing Strategy

### Unit Tests
- Test `resolveModel("gpt5mini")` returns OpenAI gpt-5.4-mini model
- Test all `examples/*/sandcaster.json` files parse against `SandcasterConfigSchema` (automated, runs in CI)

### Integration Tests
- N/A for automated CI (requires real API keys + costs money)

### Manual Test Cases

1. **Config validation**:
   - Steps: Write a script that loads each `sandcaster.json` through `SandcasterConfigSchema.safeParse()`
   - Expected: All 14 configs parse without errors

2. **Portability test**:
   - Steps: Copy `examples/01-hello-sandbox/` to `/tmp/`, set env vars, run `sandcaster "Hello"`
   - Expected: Agent runs successfully in E2B sandbox

3. **Provider test**:
   - Steps: Copy provider example, set provider-specific env vars, run
   - Expected: Agent runs on the specified provider

## Risk Assessment

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| `gpt-5.4-mini` not supported by Pi-mono's `getModel()` | Low | High | Verify with `getModel("openai", "gpt-5.4-mini")` before adding alias |
| Config field names change in future | Low | Medium | Automated schema validation test catches this in CI |
| E2B default template missing tools needed by examples | Medium | Medium | Test each example against live E2B before merging |
| All examples depend on single model (`gpt5mini`) | Medium | Medium | README troubleshooting documents fallback: replace with `sonnet`, `haiku`, or `gpt5` |
| `agents`/`branching` config not fully runtime-supported | Low | High | Prerequisite gate in Phase 3 verifies before writing examples 05/06 |

### Business Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Examples cost money to run (E2B + OpenAI) | High | Low | Document approximate cost in root README |

## Rollback Strategy

### Rollback Steps
1. `git revert` the commit — examples are additive-only, no existing code depends on them
2. The `gpt5mini` alias can be reverted independently if the model doesn't exist

### Rollback Conditions
- If `gpt-5.4-mini` is not a valid OpenAI model ID
- If example configs cause `loadConfig()` to emit unexpected warnings

## Validation Commands

```bash
# Run model alias tests
bunx vitest run packages/core/src/__tests__/runner/model-aliases.test.ts

# Build all packages (no regressions)
bunx turbo build

# Run all tests
bunx turbo test

# Validate example configs parse correctly (manual)
# cd examples/01-hello-sandbox && node -e "
#   const fs = require('fs');
#   const config = JSON.parse(fs.readFileSync('sandcaster.json', 'utf-8'));
#   console.log('Valid JSON:', Object.keys(config));
# "
```

## Acceptance Criteria

- [ ] `gpt5mini` alias resolves to OpenAI gpt-5.4-mini
- [ ] 14 example directories exist with valid `sandcaster.json` + `README.md`
- [ ] Root `examples/README.md` lists all 14 examples with descriptions and env var table
- [ ] Root `examples/.env.example` documents all required env vars
- [ ] All `sandcaster.json` files validate against `SandcasterConfigSchema` (automated test in CI)
- [ ] All READMEs follow consistent template (Prerequisites / Setup / Run / What Happens / Configuration / Troubleshooting)
- [ ] Examples with sample data (02, 04, 05, 10, 11, 12, 13) include working sample files
- [ ] All existing tests pass (`bunx turbo test`)
- [ ] No build regressions (`bunx turbo build`)
- [ ] Any single example directory is copyable and runnable outside the monorepo (requires CLI linked)

## Dependencies

### New Dependencies
None.

### Dependency Updates
None.

## Notes & Context

### Additional Context
- Sandstorm (Python predecessor) examples at `/Users/iamladi/Projects/experiments/sandstorm/examples/` serve as direct ports for examples 02, 03, 05
- `sandcaster.json` uses **camelCase** field names (unlike Sandstorm's snake_case `sandstorm.json`)
- The CLI auto-loads `sandcaster.json` from `process.cwd()` — no `--config` flag needed
- All examples use `gpt-5.4-mini` via `OPENAI_API_KEY` for cost efficiency (user decision)

### Assumptions
- `gpt-5.4-mini` is a valid model ID recognized by Pi-mono's `getModel("openai", "gpt-5.4-mini")`
- The default E2B sandbox template includes the tools referenced in examples (bash, file_read, file_write, etc.)
- Users will install the `sandcaster` CLI before running examples

### Constraints
- No npm publishing — examples must work without `@sandcaster/sdk` or `@sandcaster/core` as npm dependencies
- Config-only pattern — no TypeScript files in examples (deferred until npm publish)
- Real credentials required — no mock/dry-run mode

### Related Tasks/Issues
- Sandstorm examples (reference): `/Users/iamladi/Projects/experiments/sandstorm/examples/`
- Implementation plans: `plans/01-infra.md` through `plans/09-cf-gateway.md`

### References
- Research: `research/research-executable-examples.md`
- E2B Cookbook: https://github.com/e2b-dev/e2b-cookbook
- Vercel AI SDK examples: https://github.com/vercel/ai
- `SandcasterConfigSchema`: `packages/core/src/schemas.ts:182`

### Open Questions
- [ ] Is `gpt-5.4-mini` a valid Pi-mono model ID? Verify before implementation.
- [ ] Does E2B default template have all tools (bash, file_read, file_write, Glob, Grep) pre-installed?
- [ ] Should root README mention approximate cost per example run?

## Blindspot Review

**Reviewers**: GPT-5.3-Codex (xhigh), Gemini 3 Pro
**Date**: 2026-03-19
**Plan Readiness**: Ready (after revisions)

### Addressed Concerns

- [Consensus, Critical] Installation paradox — `bun install -g` won't work without npm publish → Documented `bun link` as install path in README template and root README
- [Consensus, High] Schema validation bit-rot — no CI enforcement for example configs → Added automated test in `packages/core/src/__tests__/examples-schema.test.ts` (Phase 5, FR-6)
- [Gemini, High] Multiline system prompts unreadable in JSON → Sandstorm examples use the same pattern successfully; system prompts are kept concise (1-3 sentences). Longer prompts can use `\n` escapes. Config readability is acceptable.
- [Gemini, High] Cloudflare provider requires pre-deployed worker → README for 08-provider-cloudflare explicitly states prerequisite; excluded from "quick start" metric
- [Gemini, Medium] Missing target data for code-analysis examples → Added `sample-code/` and `sample-app/` subdirectories in examples 02, 04, 05 (Phase 3, FR-5)
- [Codex, High] Env var acceptance criteria inconsistent → Split by example class with per-example env var table
- [Codex, High] Advanced features (agents/branching) not verified before porting → Added prerequisite gate in Phase 3
- [Codex, High] Single model dependency → Added troubleshooting section with fallback model instructions in README template
- [Codex, High] Error path testing missing → Added troubleshooting section in every README
- [Codex, High] Provider scope ambiguous → Providers bound to `SANDBOX_PROVIDER_VALUES` enum in `schemas.ts`: e2b, vercel, cloudflare, docker
- [Codex, High] Over-constrained provider config assumption → Changed criterion to "minimal required diff" allowing provider-specific fields
- [Codex, Medium] Quality gates lack enforcement → Schema validation test runs in CI via `bunx turbo test`

### Acknowledged but Deferred

- [Codex, High] Runtime validation — running all 14 examples end-to-end → Requires real API keys + costs money. Deferred to manual pre-merge validation. Not suitable for CI.
- [Codex, Medium] Validation sequencing — verify assumptions before writing all examples → Mitigated by prerequisite gate for advanced features. Config-only examples are trivially reworkable if assumptions fail.

### Dismissed

- [Gemini, High] JSON doesn't support multiline strings → This is a known JSON limitation. Sandstorm examples use the same pattern. System prompts in examples are intentionally concise (1-3 sentences). The `\n` escape is readable enough for config files. Adding JSONC/file-reference support is scope creep.
