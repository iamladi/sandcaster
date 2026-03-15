---
title: "Speculative Branching: Parallel Agent Execution with Competitive Selection"
type: Feature
issue: 6
research: []
status: Ready for Implementation
reviewed: true
reviewers: ["codex", "gemini"]
created: 2026-03-15
---

# PRD: Speculative Branching — Parallel Agent Execution with Competitive Selection

## Metadata
- **Type**: Feature
- **Priority**: High
- **Severity**: N/A
- **Estimated Complexity**: 9
- **Created**: 2026-03-15
- **Status**: Ready for Implementation

## Overview

### Problem Statement

AI agents commit to a single execution path and have no mechanism to explore alternatives. When an agent picks the wrong approach — a bad search strategy, incorrect fix, suboptimal analysis — it wastes turns and tokens on a dead end. The user must re-run the entire query with a modified prompt, hoping for a better outcome.

Sandcaster's unique sandbox-per-request architecture makes it possible to solve this: fork execution into N parallel sandboxes, run competing approaches simultaneously, and select the winner. This is speculative execution applied to AI agents — a proven technique from CPU architecture and distributed systems, never applied to agent runtimes.

### Goals & Objectives

1. Enable agents to explore multiple solution paths in parallel via isolated sandboxes
2. Provide three branching triggers: explicit tool call, confidence-based self-report, and config-driven always-branch
3. Deliver a pluggable evaluator framework with LLM-judge and schema-validation as built-in options
4. Visualize branch progress and results in the CLI TUI with collapsed/expandable display
5. Support per-branch provider and model overrides for cost optimization (cheap exploration, expensive final)

### Success Metrics

- **Primary Metric**: Branch-enabled runs produce higher-quality outputs than single-path runs (measured by evaluator scores on a benchmark set)
- **Secondary Metrics**:
  - Branching adds < 10% wall-clock overhead vs sequential retry (due to parallelism)
  - TUI renders branch progress without layout jank or memory leaks
  - Per-branch cost optimization reduces total cost by 30-60% vs running all branches on the same model
- **Quality Gates**:
  - All existing tests continue to pass (zero regressions)
  - New code has > 90% line coverage
  - Branch execution correctly cleans up all sandbox instances (no resource leaks)

## User Stories

### Story 1: Explicit Branching
- **As a**: developer building a research agent
- **I want**: the agent to explore multiple search strategies in parallel
- **So that**: I get the best research output without manually re-running with different prompts
- **Acceptance Criteria**:
  - [ ] Agent can call `branch()` tool with N alternative prompts
  - [ ] Each branch runs in its own isolated sandbox
  - [ ] Results are evaluated and the best branch is returned
  - [ ] Original run events + branch events are all streamed to the client

### Story 2: Confidence-Based Auto-Branching
- **As a**: user running complex analysis tasks
- **I want**: the system to automatically branch when the agent is uncertain
- **So that**: low-confidence decisions get explored from multiple angles without my intervention
- **Acceptance Criteria**:
  - [ ] Agent self-reports confidence via `report_confidence` tool
  - [ ] When confidence drops below configurable threshold, branching triggers automatically
  - [ ] System prompt is augmented to instruct agent on confidence reporting
  - [ ] Threshold is configurable in sandcaster.json

### Story 3: Always-Branch Mode
- **As a**: user who wants maximum output quality
- **I want**: every query to automatically run N parallel attempts
- **So that**: the best result is always selected without any agent cooperation
- **Acceptance Criteria**:
  - [ ] `alwaysBranch: true` in config triggers N parallel runs from the start
  - [ ] Each branch can use a different provider/model combination
  - [ ] Total cost is reported across all branches
  - [ ] Works with any existing starter template

### Story 4: Custom Evaluator
- **As a**: developer with domain-specific quality criteria
- **I want**: to define my own evaluation logic for selecting the winning branch
- **So that**: branch selection matches my specific use case
- **Acceptance Criteria**:
  - [ ] Evaluator is configured in sandcaster.json
  - [ ] LLM-judge and schema-validation are provided as built-in evaluator types
  - [ ] Custom evaluator accepts a user-defined prompt
  - [ ] Evaluator receives all branch results and returns a winner with reasoning

## Requirements

### Functional Requirements

1. **FR-1**: `branch()` tool callable from within sandbox agent
   - Details: Tool accepts `alternatives` (array of prompt strings) and `reason` (string). Emitting a `branch_request` event terminates the current run.
   - Priority: Must Have

2. **FR-2**: Parallel sandbox execution for branches
   - Details: N sandboxes created and executed concurrently via `Promise.allSettled`. Each branch is a full `runAgentInSandbox()` call with its own config.
   - Priority: Must Have

3. **FR-3**: Evaluator framework with pluggable strategies
   - Details: `Evaluator` interface with `evaluate(results: BranchResult[]) => EvaluationResult`. Built-in: `llm-judge`, `schema`. User-defined: `custom` with prompt string.
   - Priority: Must Have

4. **FR-4**: `report_confidence` tool for self-assessment
   - Details: Tool accepts `level` (0.0-1.0) and `reason` (string). Emits `confidence_report` event. Below-threshold triggers branching.
   - Priority: Must Have

5. **FR-5**: Config-driven `alwaysBranch` mode
   - Details: When enabled, orchestrator skips initial run and creates N parallel branches immediately with the original prompt.
   - Priority: Must Have

6. **FR-6**: Per-branch provider and model overrides
   - Details: `branches` array in config specifies `{provider?, model?, sandboxProvider?}` per branch index. Unspecified branches inherit from parent config.
   - Priority: Must Have

7. **FR-7**: New event types for branch lifecycle
   - Details: `branch_request`, `branch_start`, `branch_progress`, `branch_complete`, `branch_selected`, `branch_summary` events added to SandcasterEvent union.
   - Priority: Must Have

8. **FR-8**: TUI branch visualization (collapsed + expandable)
   - Details: During execution: compact progress bar per branch. After completion: winner expanded, others collapsed but expandable. Shows cost, turns, status per branch.
   - Priority: Must Have

9. **FR-9**: Branch history in run records
   - Details: Run JSONL records include branch metadata: count, winner ID, per-branch cost/turns, evaluator type, evaluation reasoning.
   - Priority: Should Have

10. **FR-10**: CLI arguments for branching
    - Details: `--branches N`, `--branch-trigger <explicit|confidence|always>`, `--evaluator <llm-judge|schema|custom>`, `--confidence-threshold <0-1>`
    - Priority: Should Have

### Non-Functional Requirements

1. **NFR-1**: Resource Cleanup
   - Requirement: All sandbox instances (including failed branches) must be killed in `finally` blocks
   - Target: Zero resource leaks even on timeout, abort, or evaluator failure
   - Measurement: Integration test with fault injection verifies cleanup

2. **NFR-2**: Parallel Execution Performance
   - Requirement: Branches execute truly in parallel, not sequentially
   - Target: Wall-clock time for N branches ~ max(branch_time), not sum(branch_times)
   - Measurement: Timing test with mock sandboxes

3. **NFR-3**: Graceful Degradation
   - Requirement: If branching fails (e.g., sandbox creation fails for some branches), fall back to available results
   - Target: At least 1 successful branch produces a result
   - Measurement: Test with partial sandbox failures

4. **NFR-4**: Event Stream Ordering
   - Requirement: Branch events maintain correct ordering (branch_start before branch_progress before branch_complete)
   - Target: No out-of-order events in any execution path
   - Measurement: Event ordering assertions in integration tests

5. **NFR-5**: Abort Signal Propagation
   - Requirement: Parent abort (CLI exit, API disconnect) kills ALL active branch sandboxes within 1s
   - Target: Zero orphaned sandboxes after client disconnect
   - Measurement: Integration test with AbortController triggering mid-branch-execution

6. **NFR-6**: Timeout Inheritance
   - Requirement: Branch timeouts reflect remaining parent time, not fresh timeout
   - Target: Total wall-clock time never exceeds 2x original timeout (initial run + branches)
   - Measurement: Timing test verifying branches respect remaining timeout

### Technical Requirements

- **Stack**: TypeScript ESM, Bun, Vitest 4, Zod, Pi-mono
- **Dependencies**: No new external dependencies (LLM-judge evaluator uses existing Pi-mono Agent)
- **Architecture**: New `branching/` module in `@sandcaster/core` with orchestrator, evaluator, and types. New tools added to `runner/sandbox-tools.ts`. TUI components in `apps/cli/src/tui/`.
- **Data Model**: Extended `SandcasterEvent` union, extended `SandcasterConfig` and `QueryRequest` schemas, extended `Run` schema
- **API Contracts**: `/query` SSE endpoint streams branch events transparently. No new endpoints needed.

## Scope

### In Scope

- `branch()` and `report_confidence` tools in the sandbox runner
- `runBranchedAgent()` orchestrator wrapping `runAgentInSandbox()`
- Evaluator framework: `llm-judge`, `schema`, `custom` strategies
- All three triggers: explicit, confidence-based, config-driven
- New branch-related event types
- TUI branch progress and detail components
- Per-branch provider/model/sandboxProvider overrides
- CLI arguments for branch configuration
- Branch metadata in run JSONL records
- SDK types updated for new events
- Comprehensive test suite

### Out of Scope

- Mid-branch checkpointing/snapshotting (requires provider snapshot support not yet implemented)
- Recursive branching (branches within branches)
- Inter-branch communication (branches are fully isolated)
- Branch result caching/deduplication across runs
- Web UI for branch visualization (CLI TUI only)
- Real-time branch cancellation from TUI (branches run to completion)

### Future Considerations

- Recursive branching with depth limits for complex multi-step exploration
- Semantic deduplication of branch results before evaluation
- Provider-level snapshot support for cheaper mid-execution forking
- Adaptive branch count based on task complexity estimation
- Branch result streaming to external observability systems (OpenTelemetry)

## Impact Analysis

### Affected Areas

- `packages/core/src/` — New branching module, extended schemas, extended runner tools and events
- `packages/sdk/src/types.ts` — New event types for SDK consumers
- `apps/cli/src/tui/` — New TUI components for branch visualization
- `apps/cli/src/hooks/` — Extended state management for branch-aware rendering
- `apps/cli/src/commands/query.tsx` — New CLI arguments, branch orchestrator integration
- `apps/api/src/routes/` — `/query` route transparently streams branch events (no changes needed)

### Users Affected

- **CLI users**: See branch progress in TUI, new CLI flags available
- **API consumers**: Receive new event types in SSE stream (additive, non-breaking)
- **SDK users**: New event types in TypeScript union (compile-time safe with exhaustive checks)

### System Impact

- **Performance**: N branches = N concurrent sandbox instances. Memory and CPU proportional to branch count. Network I/O proportional to branch count. Bounded by config.
- **Security**: No new attack surface. Each branch runs in its own isolated sandbox. Evaluator LLM calls use the same API key management as regular runs.
- **Data Integrity**: Branch metadata in run records is additive. No schema migration needed.

### Dependencies

- **Upstream**: Pi-mono Agent (tool registration), sandbox providers (parallel create)
- **Downstream**: SDK consumers will see new event types (non-breaking addition to discriminated union)
- **External**: LLM providers for evaluator judge calls (same providers already used for agent runs)

### Breaking Changes

<!-- Addressed: [Codex, Medium] SDK consumers with exhaustive switch may see compile-time breaks -->

- [x] **Compile-time impact for SDK consumers**: Adding new event types to the `SandcasterEvent` discriminated union will cause TypeScript compile errors for consumers using exhaustive `switch` statements without a `default` case. This is by design (the exhaustive check catches missing handlers). Migration guidance: add a `default` case to event switch statements, or handle the new `branch_*` and `confidence_report` event types explicitly.
- [x] **Runtime non-breaking**: All new events are additive. Consumers that ignore unknown event types are unaffected.

## Solution Design

### Approach

**Architecture: Two-level orchestration**

The branching system operates at two levels:

1. **Inside sandbox (Level 2)**: The `branch()` and `report_confidence` tools run within the agent's sandbox. When triggered, they emit special events via stdout and terminate the current agent run.

2. **Outside sandbox (Level 1)**: The `BranchOrchestrator` wraps `runAgentInSandbox()`. It intercepts branch-triggering events from the initial run, creates N parallel sandbox executions, collects results, runs the evaluator, and yields the winning branch's events.

**Flow for explicit branching:**

```
User prompt → runBranchedAgent()
                  ↓
             runAgentInSandbox() [initial run]
                  ↓
             Agent calls branch({alternatives: [...]})
                  ↓
             Runner emits branch_request event, aborts agent
                  ↓
             Orchestrator detects branch_request
                  ↓
             yield branch_summary event (start)
                  ↓
             Promise.allSettled([
               runAgentInSandbox(branch_0_options),
               runAgentInSandbox(branch_1_options),
               runAgentInSandbox(branch_2_options),
             ])
                  ↓
             Collect BranchResult[] (events, final result, cost, turns)
                  ↓
             evaluator.evaluate(results) → winner
                  ↓
             yield branch_selected event
             yield winning branch events
             yield branch_summary event (end)
```

**Flow for config-driven (alwaysBranch):**

```
User prompt → runBranchedAgent()
                  ↓
             Skip initial run
                  ↓
             Promise.allSettled([
               runAgentInSandbox(branch_0_options),  // same prompt, different model/provider
               ...
             ])
                  ↓
             (same evaluation flow)
```

**Flow for confidence-based:**

```
User prompt → runBranchedAgent()
                  ↓
             runAgentInSandbox() with report_confidence tool + augmented system prompt
                  ↓
             Agent calls report_confidence({level: 0.3, reason: "..."})
                  ↓
             Runner emits confidence_report event
                  ↓
             Orchestrator detects confidence < threshold
                  ↓
             (same branching flow as explicit, but alternatives are auto-generated)
```

**Evaluator Framework:**

```typescript
interface Evaluator {
  evaluate(
    originalPrompt: string,
    results: BranchResult[],
  ): Promise<EvaluationResult>;
}

interface BranchResult {
  branchId: string;
  branchIndex: number;
  events: SandcasterEvent[];
  finalContent: string;
  costUsd?: number;
  numTurns?: number;
  status: 'success' | 'error';
}

interface EvaluationResult {
  winnerId: string;
  winnerIndex: number;
  reasoning: string;
  scores?: Record<string, number>; // branchId → score
}
```

Built-in evaluators:
- **llm-judge**: Creates a Pi-mono Agent with a judge prompt, passes all branch results, asks it to select the best one with reasoning
- **schema**: If outputFormat is set, validates each result against the JSON schema. Among valid results, picks the one with lowest cost. Falls back to llm-judge if all or none validate.
- **custom**: User provides an evaluation prompt in config. The prompt receives all branch results as context.

**Branch Context Preservation (mid-run branching):**

<!-- Addressed: [Consensus, Critical] Branches must receive context from pre-branch execution -->

When branching triggers mid-run (explicit or confidence), the orchestrator captures a **branch context** from the initial run's events:
1. All `assistant` (complete), `tool_use`, and `tool_result` events from the initial run are serialized into a conversation summary
2. This summary is prepended to each branch's prompt as a "conversation so far" system context
3. Any user-uploaded files from the original request are also forwarded to each branch sandbox
4. Files *generated* by the agent during the initial run are NOT transferred (too complex, deferred to snapshot support)

This ensures branches have the textual context of what the agent discovered/decided before branching, even though they run in fresh sandboxes.

**Recursive Branching Guard:**

<!-- Addressed: [Consensus, High] Prevent infinite branching loops -->

Branch sandboxes do NOT receive the `branch` or `report_confidence` tools. The orchestrator strips these tools from the tool set when constructing branch run options. If an agent inside a branch somehow attempts to call `branch()`, it will receive a tool-not-found error. This prevents infinite branching loops and unbounded resource consumption.

**Event Streaming Model (hybrid):**

<!-- Addressed: [Consensus, High] Resolve streaming vs buffered inconsistency -->

The orchestrator uses a **hybrid streaming model**:
- **During branch execution**: The orchestrator emits `branch_progress` events periodically (every N seconds or on turn boundaries) with status, turn count, and cost per branch. This keeps the TUI alive and responsive.
- **After all branches complete**: The orchestrator collects all branch events into arrays (needed for evaluation), runs the evaluator, then emits the winning branch's full event sequence followed by `branch_selected` and `branch_summary` events.
- **Event ID continuity**: The winning branch's events are emitted with their original ordering. The `branch_start`/`branch_complete` envelope events clearly delineate branch boundaries so clients can reconstruct the timeline.

**Timeout Semantics:**

<!-- Addressed: [Codex, High] Resolve timeout model -->

Branches inherit the **remaining timeout** from the parent request, not a fresh full timeout. If the initial run consumed 60s of a 300s timeout before branching, each branch gets 240s. This prevents timeout extension attacks and respects API gateway connection limits. A hard absolute ceiling (`maxBranchTimeout`, default: parent timeout) is configurable to override this.

**Abort Signal Propagation:**

<!-- Addressed: [Codex, High] Parent abort / client disconnect handling -->

The orchestrator accepts an `AbortSignal` from the parent context (CLI process exit, API client SSE disconnect). When the signal fires, ALL active branch sandboxes are killed via their `instance.kill()` methods in a `Promise.allSettled` cleanup sweep. This prevents resource leaks on user cancellation.

**Parallelism Cap:**

<!-- Addressed: [Codex, High] Resolve max branches limit -->

Hard cap of **5 branches** maximum (configurable via `branching.maxBranches`). Validated in the Zod schema — requests exceeding the cap are rejected with a clear error. The orchestrator also staggers sandbox creation with a configurable delay (default 200ms) to avoid provider rate limits.

**Evaluator Failure Fallback:**

<!-- Addressed: [Codex, High] Define evaluator failure path -->

If the evaluator fails (timeout, auth error, malformed response, invalid winner ID), the orchestrator falls back to **first successful branch** selection. A `warning` event is emitted explaining the evaluator failure and fallback. This ensures branching always produces a result even when evaluation breaks.

**Key Design Decisions:**

1. **Branches are full `runAgentInSandbox()` calls** — not lightweight forks. This is more expensive but guarantees perfect isolation and works with all providers without snapshot support.

2. **The branch() tool terminates the current run** — the agent can't continue after branching. This simplifies the execution model (no need to merge branch results back into a continuing conversation).

3. **Evaluator runs outside all sandboxes** — it's an LLM call (or schema check) in the orchestrator process, not inside a sandbox. This keeps evaluation fast and cheap.

4. **Per-branch overrides use array indexing** — `branches: [{model: "haiku"}, {model: "sonnet"}, {model: "opus"}]`. If the branch count exceeds the array length, remaining branches inherit from parent config.

5. **Confidence trigger is one-shot** — the first `confidence_report` event below threshold triggers branching. Subsequent low-confidence reports in the same run are ignored to prevent duplicate branch launches.

6. **Config precedence** — CLI flags > QueryRequest fields > sandcaster.json, consistent with existing Sandcaster precedence for other fields.

7. **Alternatives count resolution** — For explicit triggers, `alternatives.length` overrides `config.branching.count`. For always-branch and confidence triggers, `config.branching.count` is used. Maximum 10 alternatives per branch() call (validated in tool schema).

### Alternatives Considered

1. **Sandbox snapshotting + restore**
   - Pros: Cheaper (reuse sandbox state up to branch point), faster (skip re-execution of pre-branch work)
   - Cons: Not all providers support snapshots. E2B has limited snapshot support. Docker snapshots are heavyweight. Adds provider-specific complexity.
   - Why rejected: Fragile across providers. Fresh sandboxes are simpler and guaranteed to work everywhere. Can be added later as an optimization.

2. **In-sandbox branching (multiple agent loops in one sandbox)**
   - Pros: No extra sandbox creation cost. Branches share filesystem state.
   - Cons: No isolation between branches. State leakage. Can't use different providers per branch. Resource contention.
   - Why rejected: Violates the core isolation principle that makes Sandcaster valuable.

3. **Heuristic confidence detection (analyze agent output for hedging language)**
   - Pros: No agent cooperation needed.
   - Cons: Fragile across models and languages. False positives. Not model-agnostic.
   - Why rejected: LLM self-report is more reliable and works across all models that support tool use.

### Data Model Changes

<!-- Addressed: [Codex, High] Canonical event schema now includes branch_progress -->

**Extended `SandcasterEvent` union** (additive — 7 new event types):

```typescript
| { type: "branch_request"; alternatives: string[]; reason?: string }
| { type: "confidence_report"; level: number; reason: string }
| { type: "branch_start"; branchId: string; branchIndex: number; totalBranches: number; prompt: string }
| { type: "branch_progress"; branchId: string; branchIndex: number; status: "running" | "completed" | "error"; numTurns?: number; costUsd?: number }
| { type: "branch_complete"; branchId: string; status: "success" | "error"; costUsd?: number; numTurns?: number; content?: string }
| { type: "branch_selected"; branchId: string; branchIndex: number; reason: string; scores?: Record<string, number> }
| { type: "branch_summary"; totalBranches: number; successCount: number; totalCostUsd: number; evaluator: string; winnerId?: string }
```

**Extended `SandcasterConfig`** (additive):

```typescript
branching?: {
  enabled?: boolean;           // default false
  count?: number;              // default 3, max 5
  maxBranches?: number;        // hard cap, default 5, max 10
  trigger?: 'explicit' | 'confidence' | 'always';  // default 'explicit'
  confidenceThreshold?: number; // default 0.5, for 'confidence' trigger
  staggerDelayMs?: number;     // delay between sandbox creation, default 200
  evaluator?: {
    type: 'llm-judge' | 'schema' | 'custom';  // default 'llm-judge'
    prompt?: string;           // for 'custom' type
    model?: string;            // for 'llm-judge' type
  };
  branches?: Array<{
    provider?: string;
    model?: string;
    sandboxProvider?: string;
  }>;
}
```

**Extended `QueryRequest`** (additive — same branching fields as config, allowing per-request override).

**Extended `Run`** (additive):

```typescript
branchCount?: number;
branchWinnerId?: string;
branchCosts?: Record<string, number>; // branchId → cost
evaluatorType?: string;
```

### API Changes

No new endpoints. The existing `/query` SSE endpoint transparently streams the new branch event types. Consumers that don't understand branch events can safely ignore them (the final `result` event is still emitted as before).

### UI/UX Changes

<!-- Addressed: [Gemini, High] TUI expansion is impossible after Ink unmounts; redesigned as static output -->

**TUI (Ink) — Live progress + static final output:**

During execution (live, rendered by Ink):
```
⟳ Branch 1/3  ████████░░  4 turns  $0.02  [haiku/docker]
⟳ Branch 2/3  ██████░░░░  3 turns  $0.05  [sonnet/e2b]
⟳ Branch 3/3  █████░░░░░  2 turns  $0.12  [opus/e2b]
```

After completion (static output, printed before Ink unmounts):
```
✓ Winner: Branch 2/3 (score: 0.92) — "Most comprehensive analysis with cited sources"
  ─── Branch 2 output ───
  [full winning agent output here]
  ──────────────────────

  ○ Branch 1 (score: 0.71) · 6 turns · $0.02 · haiku/docker
  ○ Branch 3 (score: 0.85) · 4 turns · $0.12 · opus/e2b

  Summary: 3 branches · $0.19 total · evaluator: llm-judge · 14s
```

To view non-winning branch details, use `--no-tui` mode (full JSON output) or the `/runs` history endpoint. Interactive post-exit expansion is not supported since Ink unmounts on process exit.

## Implementation Plan

### Phase 1: Core Branching Primitive
**Complexity**: 5 | **Priority**: High

- [ ] Define branch types in `packages/core/src/branching/types.ts` (BranchConfig, BranchResult, EvaluationResult, BranchRunOptions, BranchOverride)
- [ ] Add all 7 branch event types (`branch_request`, `confidence_report`, `branch_start`, `branch_progress`, `branch_complete`, `branch_selected`, `branch_summary`) to SandcasterEvent in `schemas.ts` and `event-translator.ts`
- [ ] Add branching fields to `SandcasterConfigSchema` and `QueryRequestSchema` in `schemas.ts` (including `maxBranches` cap validation: 1-10, `count` validation: 1-5, `staggerDelayMs`)
- [ ] Implement `branch()` tool in `packages/core/src/runner/sandbox-tools.ts` that emits `branch_request` event and signals runner to abort. Validate: 1-10 alternatives, non-empty prompt strings.
- [ ] Modify `runner-main.ts` to support branch tool abort signal (set flag on branch tool execution, abort agent on next `tool_execution_end`)
- [ ] Implement per-branch provider/model/sandboxProvider override resolution (merge branch-specific config with parent config, resolve credentials per branch)
- [ ] Implement `BranchOrchestrator` in `packages/core/src/branching/branch-orchestrator.ts`:
  - Intercept `branch_request` events mid-stream
  - Build branch context from pre-branch events (conversation summary for branch prompts)
  - Strip `branch`/`report_confidence` tools from branch sandbox tool sets (recursive branching guard)
  - Stagger sandbox creation with configurable delay to avoid provider rate limits
  - Create parallel `runAgentInSandbox()` calls with `Promise.allSettled`
  - Emit `branch_progress` events periodically during execution
  - Collect results, handle partial failures (NFR-3)
  - Accept and propagate `AbortSignal` to all branch sandboxes
  - Enforce remaining-timeout inheritance (not fresh timeout per branch)
  - Guarantee cleanup of ALL sandbox instances in `finally` blocks
- [ ] Export `runBranchedAgent()` from `@sandcaster/core` as the branching entry point
- [ ] Write tests: branch types/schema validation, branch tool behavior (emit + abort + input validation), orchestrator with mock sandboxes (parallel exec, event ordering, cleanup on success/failure/abort, staggered creation, timeout inheritance, recursive guard, branch context capture, partial failure fallback)

### Phase 2: Evaluator Framework + All Triggers
**Complexity**: 5 | **Priority**: High

- [ ] Define `Evaluator` interface in `packages/core/src/branching/evaluator.ts`
- [ ] Implement `LlmJudgeEvaluator`: creates Pi-mono Agent with structured judge prompt, passes branch results, returns winner with reasoning and scores
- [ ] Implement `SchemaEvaluator`: validates results against `outputFormat` JSON schema, picks valid result with lowest cost, falls back to LLM judge
- [ ] Implement `CustomEvaluator`: takes user-provided prompt, injects branch results as context, returns winner
- [ ] Implement `createEvaluator(config: EvaluatorConfig)` factory function
- [ ] Implement evaluator failure fallback: on timeout/auth/parse error, select first successful branch, emit warning event
- [ ] Implement `report_confidence` tool in `sandbox-tools.ts`: accepts level (0-1) and reason, emits `confidence_report` event. One-shot semantics: only first below-threshold report triggers branching, subsequent reports ignored.
- [ ] Add confidence system prompt augmentation in `runner-main.ts` (when confidence trigger is active, append instructions to system prompt including "suggest alternative approaches when reporting low confidence")
- [ ] Implement config-driven `alwaysBranch` trigger in orchestrator (skip initial run, create N parallel branches immediately)
- [ ] Implement confidence threshold detection in orchestrator (watch for `confidence_report` events below threshold, one-shot guard)
- [ ] Auto-generate alternative prompts for confidence-triggered branching (use agent's suggested alternatives from confidence report, or rephrase original prompt with different approach instructions)
- [ ] Wire evaluator into orchestrator: call after all branches complete, handle failure fallback
- [ ] Write tests: each evaluator type, evaluator factory, evaluator failure/timeout/malformed response fallback, confidence tool (one-shot semantics, range validation), always-branch flow, confidence-triggered flow, alternative prompt generation, config precedence (CLI > request > file)

### Phase 3: TUI Visualization + CLI Integration
**Complexity**: 4 | **Priority**: Medium

- [ ] Create `BranchProgress` component in `apps/cli/src/tui/BranchProgress.tsx`: compact progress bars with status, turns, cost, provider/model per branch (live, rendered by Ink during execution)
- [ ] Create `BranchSummary` component in `apps/cli/src/tui/BranchSummary.tsx`: static final output showing winner expanded + loser one-line summaries (printed before Ink unmounts)
- [ ] Create `useBranch` hook in `apps/cli/src/hooks/useBranch.ts`: branch-aware state management (tracks per-branch events, progress, results from `branch_progress`/`branch_complete`/`branch_selected` events)
- [ ] Integrate branch components into `App.tsx`: render BranchProgress during execution, BranchSummary on completion
- [ ] Update `StatusBar.tsx` to show branch count and total cost across branches
- [ ] Add CLI arguments to `query.tsx`: `--branches`, `--branch-trigger`, `--evaluator`, `--confidence-threshold`
- [ ] Wire CLI query command to use `runBranchedAgent()` when branching is enabled (fall back to `runAgentInSandbox()` when disabled)
- [ ] Update SDK types in `packages/sdk/src/types.ts` with all 7 new event types + migration guidance comment for exhaustive switch consumers
- [ ] Write tests: BranchProgress rendering (running/completed/error states), BranchSummary rendering (winner + losers), useBranch state transitions, CLI argument parsing and precedence

### Phase 4: Branch History + Polish
**Complexity**: 3 | **Priority**: Low

- [ ] Extend `Run` schema with branch metadata fields (branchCount, branchWinnerId, branchCosts, evaluatorType)
- [ ] Update run recording in API routes to capture branch metadata from branch_summary events
- [ ] Update `/runs` endpoint response to include branch metadata
- [ ] Add branch info to `--no-tui` JSON output mode
- [ ] Write E2E tests: full branch lifecycle with mock providers (explicit, confidence, always-branch triggers)
- [ ] Update starters to demonstrate branching (e.g., research-brief with `alwaysBranch: true` variant)

## Relevant Files

### Existing Files

- `packages/core/src/sandbox.ts` — Main `runAgentInSandbox()` function; branching orchestrator wraps this
- `packages/core/src/runner/runner-main.ts` — Agent loop inside sandbox; needs branch tool + abort signal
- `packages/core/src/runner/sandbox-tools.ts` — Tool definitions; add branch() and report_confidence() tools
- `packages/core/src/runner/event-translator.ts` — Event type definitions; add branch event types
- `packages/core/src/schemas.ts` — Zod schemas; extend SandcasterConfig, QueryRequest, SandcasterEvent, Run
- `packages/core/src/sandbox-provider.ts` — SandboxProvider interface; no changes but referenced for parallel create
- `packages/core/src/sandbox-registry.ts` — Provider registry; used by orchestrator to resolve per-branch providers
- `packages/core/src/sandbox-resolver.ts` — Provider + credential resolution; used for per-branch overrides
- `apps/cli/src/tui/App.tsx` — Main TUI component; integrate branch rendering
- `apps/cli/src/tui/AgentStream.tsx` — Event rendering; referenced by branch detail display
- `apps/cli/src/tui/StatusBar.tsx` — Status bar; add branch stats
- `apps/cli/src/hooks/useAgent.ts` — Agent state hook; branch state management pattern reference
- `apps/cli/src/commands/query.tsx` — CLI query command; add branch args, switch to runBranchedAgent
- `packages/sdk/src/types.ts` — SDK event types; add branch event types

### New Files

- `packages/core/src/branching/types.ts` — Branch-specific types: BranchConfig, BranchResult, EvaluationResult, BranchRunOptions
- `packages/core/src/branching/branch-orchestrator.ts` — Main orchestration: runBranchedAgent(), parallel execution, event interception
- `packages/core/src/branching/evaluator.ts` — Evaluator interface + LlmJudgeEvaluator + SchemaEvaluator + CustomEvaluator + factory
- `apps/cli/src/tui/BranchProgress.tsx` — Compact branch progress bars component
- `apps/cli/src/tui/BranchDetail.tsx` — Expandable branch detail/output component
- `apps/cli/src/hooks/useBranch.ts` — Branch-aware state management hook

### Test Files

- `packages/core/src/branching/__tests__/types.test.ts` — Schema validation for branch types
- `packages/core/src/branching/__tests__/branch-orchestrator.test.ts` — Orchestrator: parallel execution, event interception, cleanup, error handling
- `packages/core/src/branching/__tests__/evaluator.test.ts` — All evaluator types: llm-judge, schema, custom, factory
- `packages/core/src/runner/__tests__/branch-tool.test.ts` — branch() tool behavior: event emission, abort signal
- `packages/core/src/runner/__tests__/confidence-tool.test.ts` — report_confidence() tool behavior
- `apps/cli/src/tui/__tests__/BranchProgress.test.tsx` — Branch progress rendering states
- `apps/cli/src/tui/__tests__/BranchDetail.test.tsx` — Branch detail rendering, expansion
- `apps/cli/src/hooks/__tests__/useBranch.test.ts` — Branch state transitions
- `apps/cli/src/__tests__/e2e/branching.e2e.test.ts` — Full lifecycle E2E tests

## Testing Strategy

### Unit Tests

- **Branch types**: Zod schema validation for BranchConfig, BranchResult, EvaluationResult
- **Branch tool**: Emits correct branch_request event, returns termination message, sets abort flag
- **Confidence tool**: Emits confidence_report with level and reason, validates level range 0-1
- **Orchestrator**:
  - Detects branch_request events mid-stream and creates parallel branches
  - Handles alwaysBranch by skipping initial run
  - Handles confidence trigger with threshold comparison
  - Cleans up all sandbox instances on success, failure, and timeout
  - Falls back gracefully when some branches fail
  - Yields events in correct order (branch_start → branch_complete → branch_selected → branch_summary)
- **Evaluators**:
  - LlmJudge: calls Pi-mono Agent with correct judge prompt, returns winner with reasoning
  - Schema: validates against outputFormat, selects valid result, falls back to LLM judge
  - Custom: injects user prompt with branch results, returns winner
  - Factory: creates correct evaluator type from config
- **TUI components**: Render correct states (running, completed, error), expand/collapse, cost display
- **useBranch hook**: State transitions for branch lifecycle events
- **Per-branch overrides**: Config merging logic (branch-specific overrides parent)

### Integration Tests

- Full branching flow with mock sandbox providers: initial run → branch_request → parallel execution → evaluation → winner selection
- Event stream integrity: verify complete event sequence from branch start to summary (including branch_progress events)
- Resource cleanup: inject failures at various points, verify all sandboxes are killed
- Abort signal propagation: trigger AbortController mid-execution, verify all branches killed within 1s
- Timeout inheritance: verify branches respect remaining parent timeout, not fresh timeout
- Recursive branching guard: verify branch sandbox does NOT have branch/report_confidence tools
- Branch context: verify pre-branch conversation events are captured and passed to branch prompts
- Evaluator failure fallback: mock evaluator timeout/error, verify first-successful-branch selection + warning event
- Config precedence: CLI > request > file for all branching fields
- Provider credential resolution per branch: verify each branch resolves correct API key for its provider
- Staggered creation: verify sandbox creation delay between branches

### E2E Tests

- Explicit branching: agent calls branch(), 3 branches run, winner selected
- Confidence branching: agent reports low confidence, automatic branching triggered
- Always-branch: 3 parallel runs, evaluator selects winner
- Mixed providers: branches on different sandbox providers
- Error recovery: one branch fails, remaining branches produce result

### Manual Test Cases

1. **Real E2B branching**:
   - Steps: Run `ds "research the top 3 approaches to X" --branches 3 --branch-trigger always`
   - Expected: 3 E2B sandboxes created in parallel, TUI shows progress bars, winner selected and displayed

## Risk Assessment

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Sandbox provider rate limits under parallel creation | Medium | High | Stagger creation with configurable delay (default 500ms). Catch rate limit errors and retry with backoff. |
| LLM judge evaluator produces inconsistent rankings | Medium | Medium | Include structured evaluation criteria in judge prompt. Allow user to override with custom evaluator. |
| Branch tool abort signal race condition (agent continues after branch) | Low | Medium | Use synchronous flag + immediate abort in event subscriber. Test with timing-sensitive scenarios. |
| Memory pressure from N concurrent sandbox event streams | Low | Medium | Collect branch events into arrays (not streaming) since we need all results for evaluation anyway. |
| Pi-mono Agent doesn't support custom tool schemas for branch/confidence tools | Low | High | Verify tool registration API supports TypeBox schemas. Fall back to string-only params if needed. |

### Business Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Users confused by multiplied costs (N branches = ~Nx cost) | Medium | Medium | Clear cost reporting in TUI and events. Default branch count is 3 (not excessive). Document cost implications. |
| Feature complexity deters adoption | Low | Medium | Branching is opt-in. Default behavior unchanged. Progressive disclosure: start with alwaysBranch, graduate to explicit. |

### Mitigation Strategy

- Ship Phase 1 first and validate with real usage before committing to later phases
- All new functionality is opt-in and default-off
- Comprehensive cleanup guarantees prevent resource leaks even in failure scenarios
- Rate limit handling built into orchestrator from day one

## Rollback Strategy

### Rollback Steps

1. Remove `branching` fields from `SandcasterConfigSchema` and `QueryRequestSchema`
2. Remove `branch()` and `report_confidence` tools from `sandbox-tools.ts`
3. Remove new event types from `SandcasterEventSchema`
4. Delete `packages/core/src/branching/` directory
5. Delete TUI branch components
6. Revert `query.tsx` to use `runAgentInSandbox` directly

### Rollback Conditions

- Resource leaks: sandboxes not being cleaned up properly
- Cost runaway: evaluator LLM calls adding unexpected cost
- Provider instability: parallel sandbox creation causing provider-side issues

## Validation Commands

```bash
# Run all tests (including new branch tests)
bunx turbo test

# Run only branching tests
cd packages/core && bunx vitest run src/branching/

# Run TUI component tests
cd apps/cli && bunx vitest run src/tui/__tests__/Branch

# Lint all packages
bunx turbo lint

# Build all packages
bunx turbo build

# Type-check
bunx turbo build --filter=@sandcaster/core

# Verify no regressions in existing tests
bunx turbo test -- --reporter=verbose 2>&1 | grep -E "(PASS|FAIL)"
```

## Acceptance Criteria

- [ ] Agent can call `branch()` tool with alternatives, triggering parallel branch execution
- [ ] Agent can call `report_confidence()` tool, triggering branching when below threshold
- [ ] `alwaysBranch: true` in config runs N parallel branches from the start
- [ ] All three triggers work correctly and are tested
- [ ] LLM-judge, schema, and custom evaluators all select winners correctly
- [ ] Per-branch provider/model overrides resolve correctly
- [ ] All sandbox instances are cleaned up in all execution paths (success, failure, timeout)
- [ ] TUI shows collapsed branch progress during execution and expandable results after
- [ ] Branch metadata is recorded in run JSONL
- [ ] SDK types include all new branch event types
- [ ] All existing tests pass (zero regressions)
- [ ] New code has > 90% test coverage
- [ ] `bunx turbo build` succeeds
- [ ] `bunx turbo lint` succeeds

## Dependencies

### New Dependencies

- None — all functionality built on existing Pi-mono Agent, Zod, and Ink primitives

### Dependency Updates

- None required

## Notes & Context

### Additional Context

Sandcaster's multi-provider sandbox architecture uniquely enables speculative branching. No other agent framework has isolated sandbox-per-request execution that can be parallelized. This feature transforms Sandcaster from "run an agent in a sandbox" to "explore solution space in parallel and select the best outcome."

The `SandboxCapabilities` interface already includes a `snapshots: boolean` field, indicating that snapshot-based branching was contemplated in the original design. This implementation takes the simpler fresh-sandbox approach first, with snapshot optimization as a future enhancement.

### Assumptions

- Pi-mono Agent supports custom tool registration via the `AgentTool` interface (confirmed by existing tools in sandbox-tools.ts)
- Sandbox providers can handle concurrent `create()` calls (rate limiting handled by orchestrator)
- LLM providers support concurrent API calls for evaluator judge (standard behavior)

### Constraints

- TDD strict mode: tests must be written before implementation for each phase
- No new npm dependencies
- Must work with all 4 sandbox providers (E2B, Vercel, Docker, Cloudflare)
- Event stream format must remain backwards-compatible (new events are additive)

### Related Tasks/Issues

- Sub-agent orchestration (config schema has `agents` field but not wired) — branching is orthogonal but could compose with sub-agents in the future
- Structured output enforcement (`outputFormat` field exists but unused) — schema evaluator leverages this

### References

- Speculative execution in CPU architecture (branch prediction + parallel execution + commit/discard)
- Tree of Thoughts (Yao et al., 2023) — deliberate reasoning via branching exploration
- Beam search in NLP — parallel hypothesis tracking with scoring
- Monte Carlo Tree Search — exploration vs exploitation in decision trees

### Open Questions (Resolved)

- [x] Should the evaluator cost be included in the run's total cost? **YES** — evaluator cost is included in `branch_summary.totalCostUsd`
- [x] Should branches have independent timeouts or share the parent timeout? **REMAINING TIMEOUT** — branches inherit remaining time from parent request (resolved per Codex review)
- [x] Should the orchestrator support a max parallel branches limit? **YES** — hard cap of 5 (configurable via `maxBranches`, absolute max 10, validated in schema)
- [x] For confidence-triggered branching, how should alternative prompts be auto-generated? **AGENT-SUGGESTED** — system prompt augmentation instructs the agent to suggest alternative approaches when reporting low confidence. The `confidence_report` tool accepts an optional `alternatives` field.

## Blindspot Review

**Reviewers**: GPT-5.3-Codex (xhigh), Gemini 3 Pro
**Date**: 2026-03-15
**Plan Readiness**: Ready (after revision)

### Addressed Concerns

- [Consensus, Critical] Branches don't preserve pre-branch state → Added "Branch Context Preservation" section in Solution Design: orchestrator captures conversation events and forwards as context to branch prompts
- [Consensus, High] Recursive branching infinite loop → Added explicit guard: strip branch/report_confidence tools from branch sandboxes. Added to Phase 1 orchestrator tasks.
- [Consensus, High] Streaming vs buffered inconsistency → Added "Event Streaming Model (hybrid)" section: branch_progress events during execution, buffered collection for evaluation, winning events emitted after
- [Codex, High] FR-6 per-branch overrides sequenced too late (Phase 3) → Moved to Phase 1 orchestrator tasks
- [Codex, High] Event contract missing branch_progress → Added branch_progress to canonical event schema (now 7 event types)
- [Codex, High] Timeout model unresolved → Resolved: branches inherit remaining timeout. Added "Timeout Semantics" section + NFR-6
- [Codex, High] Parent abort/disconnect handling missing → Added "Abort Signal Propagation" section + NFR-5 + integration test
- [Codex, High] Parallelism cap unresolved → Resolved: hard cap 5 (configurable, max 10). Added maxBranches to config schema + validation
- [Codex, High] Evaluator failure path undefined → Added "Evaluator Failure Fallback" section: first-successful-branch + warning event. Added to Phase 2 tasks + tests
- [Gemini, High] TUI expansion impossible after Ink unmounts → Redesigned: static final output with winner expanded + loser summaries. Renamed BranchDetail → BranchSummary. Added --no-tui for full JSON output.
- [Codex, Medium] Confidence trigger multiple reports → Added one-shot semantics to design decisions (#5) and Phase 2 tasks
- [Codex, Medium] Config precedence undefined → Added design decision #6: CLI > QueryRequest > sandcaster.json
- [Codex, Medium] branch() input validation under-specified → Added design decision #7: alternatives.length wins for explicit, max 10. Added validation to Phase 1 branch tool task.
- [Codex, Medium] SDK breaking change understated → Updated Breaking Changes section with compile-time impact + migration guidance
- [Gemini, Medium] Rate limit mitigation missing from implementation → Added staggered creation with configurable delay to Phase 1 orchestrator tasks + staggerDelayMs config field
- [Gemini, Medium] Arity mismatch between config count and alternatives → Addressed by design decision #7

### Acknowledged but Deferred

- [Consensus, Critical] Full filesystem state transfer between initial sandbox and branches → Deferred to snapshot-based branching (Future Considerations). Current approach passes textual conversation context only. Rationale: filesystem sync adds significant complexity and provider-specific code. The agent's conversation context captures the key decisions; branch prompts should be self-contained.
- [Codex, Medium] Provider/auth failure paths per-branch → Partially addressed (NFR-3 graceful degradation). Full per-provider auth test matrix deferred to Phase 4 E2E tests.

### Dismissed

- [Codex, Medium] Scope creep from touching too many files → Dismissed: the feature inherently spans core, CLI, SDK, and API. File count is proportional to feature scope, not scope creep. Each change is targeted and necessary.
