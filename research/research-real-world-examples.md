---
date: 2026-03-19
git_commit: 549f934
branch: plan/executable-examples
repository: iamladi/sandcaster
topic: Real-world examples that demonstrate what problems Sandcaster solves
tags: [examples, use-cases, developer-experience, real-world]
status: complete
last_updated: 2026-03-19
last_updated_by: web-search-researcher + codebase-explorer
---

# Research: Real-World Examples for Sandcaster

## Research Question

What real-world problems can developer teams solve with Sandcaster, and what examples would best demonstrate this value? These are problem-oriented examples (not feature demos) that show users what they can achieve.

## Summary

Research across E2B production usage, Devin/SWE-agent/OpenHands enterprise deployments, CI/CD automation literature, developer productivity studies, and the Sandstorm predecessor reveals a clear hierarchy of proven use cases. The strongest signal comes from three categories: security vulnerability remediation (20x documented time savings), CI failure triage (multiple production deployments at Dagger/Elastic/Gitar), and test generation sweeps (50% → 80-90% coverage as batch tasks).

Sandcaster's specific capabilities (sandbox isolation + bash + file I/O + speculative branching + structured JSON output + multi-agent orchestration) map directly to these use cases. The sandbox isolation is especially valuable for security-sensitive tasks (running `npm audit`, analyzing untrusted code) and for parallel exploration (speculative branching for migration strategies).

---

## Detailed Findings

### Tier 1 — Proven Demand, Clear ROI, Repeatable

These use cases have documented enterprise adoption and measurable time savings.

#### 1. Security Vulnerability Remediation

**Problem**: SonarQube/Veracode/Snyk backlogs sit for months because fixing CVEs is tedious, repetitive, and low-priority. One org saved 5-10% of total dev time by automating this.

**Evidence**: Devin processes vulns at 20x human speed (1.5 min vs 30 min per vuln). Claude Code Security found 500+ previously undetected vulns in open-source codebases. OpenAI Codex Security is now in research preview for the same use case.

**How Sandcaster solves it**: Agent reads vulnerability report → clones affected code into sandbox → applies fix → runs tests → outputs structured patch + explanation. Sandbox isolation means untrusted code never touches production.

**Sandcaster capabilities used**: `bash` (run `npm audit`, `pip audit`, build/test), `file_read`, `file_write`, structured `outputFormat` for findings, `agents` for parallel scanning (dependency + code + config).

**Sandstorm precedent**: `security-auditor/` example with 3 sub-agents (dependency-scanner, code-scanner, config-scanner).

#### 2. CI Failure Triage + Auto-Fix

**Problem**: CI failures are repetitive — the same classes of failures show up over and over (dependency conflicts, environment drift, flaky tests, misconfigured secrets). Triage is expensive and boring.

**Evidence**: Dagger, Elastic, and Gitar all have production self-healing CI. GitHub Copilot now autonomously diagnoses flaky tests. The pattern: agent reads CI logs → explores files → writes fix → re-runs tests → posts as PR comment.

**How Sandcaster solves it**: Feed CI logs to agent in sandbox → agent reads repo code → identifies root cause → applies fix → runs build/test to validate → outputs structured diff + explanation.

**Sandcaster capabilities used**: `bash` (run builds, tests, linters), `file_read`/`file_write`, structured output for the fix report.

#### 3. Test Generation Sweeps

**Problem**: Legacy modules have 0-50% test coverage. Writing tests is the task developers most want to offload to AI.

**Evidence**: Teams report coverage jumps from 50-60% to 80-90% as a first-pass task. 93% acceleration in regression cycle. Teams treat this as "disposable-first" work — agent writes tests, human reviews.

**How Sandcaster solves it**: Point agent at an untested module → generates test suite → runs it in sandbox to verify tests pass → iterates on failures → outputs test files + coverage report.

**Sandcaster capabilities used**: `bash` (run test framework, check coverage), `file_read`/`file_write`, speculative `branching` (try multiple testing strategies: unit vs integration vs property-based).

#### 4. Dependency Audit + CVE Report

**Problem**: Keeping dependencies updated and secure is a continuous, never-ending chore. npm/pip/cargo audit output is noisy and hard to prioritize.

**Evidence**: Core E2B cookbook use case. The Sandstorm security-auditor example specifically targets this with `bash` running `npm audit`.

**How Sandcaster solves it**: Agent runs audit commands in sandbox → cross-references with CVE databases → produces prioritized report with severity, affected packages, recommended fix versions, and upgrade paths.

**Sandcaster capabilities used**: `bash` (run `npm audit`, `pip audit`, `cargo audit`), structured `outputFormat` for the vulnerability report.

---

### Tier 2 — High Value, Slightly More Complex

These have strong enterprise signals but require more setup/context.

#### 5. Code Migration (Framework/Version Upgrades)

**Problem**: Migrating from React class → hooks, Angular → React, Python 2 → 3, .NET Framework → .NET Core. These are massive, repetitive, file-by-file tasks.

**Evidence**: Money Forward: Vue → React migration 13 days → 5 days (90% time saved on API migration). Devin: .NET Framework → .NET Core in days vs weeks. The key insight: speculative branching is uniquely suited — try multiple migration strategies in parallel, evaluate which compiles + passes tests.

**How Sandcaster solves it**: Agent reads source files → applies migration pattern → runs build/tests in sandbox → if tests fail, tries alternate approach (branching) → outputs migrated code + migration report.

**Sandcaster capabilities used**: `bash`, `file_read`/`file_write`, speculative `branching` (try 3 migration strategies, pick the one that compiles), structured output for migration report.

**Sandstorm precedent**: `repo-migration/` example with phased migration planning.

#### 6. API Documentation / OpenAPI Generation

**Problem**: API docs are always out of date. Generating OpenAPI specs from existing code or from third-party API docs is tedious.

**Evidence**: Sandstorm's `docs-to-openapi/` example validates this use case. Documentation generation documented at 400k+ repo scale by Devin.

**How Sandcaster solves it**: Agent crawls API endpoints (from code or docs) → infers request/response schemas → generates OpenAPI YAML → validates with `openapi-lint`.

**Sandcaster capabilities used**: `bash`, `file_read`/`file_write`, web browsing (if available), structured output.

**Sandstorm precedent**: `docs-to-openapi/` example.

#### 7. Codebase Onboarding / Architecture Documentation

**Problem**: New developer joins team, spends 2-4 weeks understanding the codebase. Architecture docs are non-existent or stale.

**Evidence**: DeepWiki supports 5M+ line codebases for this purpose. Augment Code confirmed teams want dead code detection + architecture analysis.

**How Sandcaster solves it**: Agent reads codebase → traces entry points, dependencies, data flow → produces structured architecture document with module map, dependency graph, key patterns, and tech debt highlights.

**Sandcaster capabilities used**: `bash` (run `grep`, analyze imports), `file_read`, structured `outputFormat` for architecture report.

#### 8. PR Review / Code Quality Sweep

**Problem**: PR reviews are a bottleneck. Finding bugs, security issues, and style violations before human review saves everyone time.

**Evidence**: Qodo, CodeRabbit show strong market appetite. Sandstorm's `code-reviewer/` example validates the pattern.

**How Sandcaster solves it**: Agent reads diff/files → runs linters/tests → produces structured findings with severity, file:line, description, and fix suggestion.

**Sandcaster capabilities used**: `bash`, `file_read`, structured `outputFormat` for findings, `agents` for parallel review (security + performance + maintainability).

**Sandstorm precedent**: `code-reviewer/` example.

---

### Tier 3 — Real but More Context-Dependent

#### 9. Competitive / Research Brief

**Problem**: Product teams need competitive intelligence. Researching 5-10 competitors manually takes days.

**Evidence**: Sandstorm's flagship use case. Structured output with comparison matrix.

**Sandstorm precedent**: `competitive-analysis/` example.

#### 10. Issue / Bug Triage

**Problem**: Bug tracker backlogs grow faster than teams can triage. Classifying by severity, finding duplicates, and routing to the right owner is repetitive.

**Evidence**: Sandstorm's `issue-triage/` example. OpenHands production workflow: Datadog errors → GitHub issues → root cause analysis.

**Sandstorm precedent**: `issue-triage/` example.

#### 11. Data Pipeline / ETL Automation

**Problem**: One-off data transformations (CSV → JSON, API → SQLite, scrape → structured data) are common but tedious to write.

**Evidence**: Core E2B cookbook use case. Pandas/numpy pre-installed in E2B sandbox. Sandstorm targets: "scrape top 50 YC companies → CSV, fetch arxiv papers → summaries, build SQLite from web data."

**Sandcaster capabilities used**: `bash` (run Python/Node scripts), `file_read`/`file_write`.

#### 12. Changelog / Release Notes Generation

**Problem**: Writing changelogs from git history is tedious. Teams skip it or produce low-quality notes.

**How Sandcaster solves it**: Agent reads git log between two tags → categorizes commits → generates structured changelog with breaking changes, features, fixes.

---

## Proposed Real-World Examples for Sandcaster

Based on the research, here are the highest-impact real-world examples to add alongside the existing feature examples. Each is a standalone `sandcaster.json` + `README.md` directory.

### Priority Examples (Tier 1 — add these)

| # | Name | Problem | Config Highlights |
|---|------|---------|------------------|
| 10 | `fix-security-vulns/` | Fix SonarQube/Snyk findings automatically | `systemPrompt`: security fixer, `allowedTools`: bash + file I/O, `outputFormat`: patches + explanations |
| 11 | `fix-ci-failure/` | Read CI logs, find root cause, propose fix | `systemPrompt`: CI debugger, `allowedTools`: bash + file I/O |
| 12 | `generate-tests/` | Generate test suite for untested module | `systemPrompt`: test writer, `allowedTools`: bash + file I/O, `branching`: try 3 approaches |
| 13 | `dependency-audit/` | Run npm/pip audit, produce prioritized CVE report | `systemPrompt`: dependency auditor, `allowedTools`: bash, `outputFormat`: CVE report |

### Secondary Examples (Tier 2 — add if capacity)

| # | Name | Problem | Config Highlights |
|---|------|---------|------------------|
| 14 | `migrate-codebase/` | Migrate React class → hooks (or similar) | `systemPrompt`: migration specialist, `branching`: try 3 strategies |
| 15 | `generate-api-docs/` | Generate OpenAPI spec from codebase | `systemPrompt`: API doc generator, `outputFormat`: OpenAPI YAML |
| 16 | `onboard-to-codebase/` | Generate architecture doc for a new developer | `systemPrompt`: codebase analyst, `outputFormat`: architecture report |

---

## Code References

### Sandcaster Capabilities
- `packages/core/src/runner/sandbox-tools.ts` — 4 core tools (bash, file_read, file_write, read_skill) + 2 branch tools
- `packages/core/src/schemas.ts:182` — `SandcasterConfigSchema` (what config fields are available)
- `packages/core/src/branching/branch-orchestrator.ts:225` — `runBranchedAgent()` for speculative branching
- `packages/core/src/runner/model-aliases.ts:7` — model aliases

### Sandstorm Examples (Reference)
- `/Users/iamladi/Projects/experiments/sandstorm/examples/competitive-analysis/sandstorm.json` — Research brief with structured output
- `/Users/iamladi/Projects/experiments/sandstorm/examples/code-reviewer/sandstorm.json` — Code review with JSON findings
- `/Users/iamladi/Projects/experiments/sandstorm/examples/security-auditor/sandstorm.json` — Multi-agent security audit
- `/Users/iamladi/Projects/experiments/sandstorm/examples/docs-to-openapi/sandstorm.json` — API doc extraction
- `/Users/iamladi/Projects/experiments/sandstorm/examples/issue-triage/sandstorm.json` — Bug triage
- `/Users/iamladi/Projects/experiments/sandstorm/examples/repo-migration/sandstorm.json` — Migration planning
- `/Users/iamladi/Projects/experiments/sandstorm/examples/content-brief/sandstorm.json` — Content research

---

## Architecture Documentation

### Capability → Use Case Mapping

```
Sandbox Capabilities          Real-World Use Cases
─────────────────────         ─────────────────────
bash (shell commands)    →    CI fix, test generation, dependency audit, migration
file_read               →    Code review, architecture analysis, security scanning
file_write              →    Patch generation, test writing, doc generation
read_skill              →    Domain-specific audits (OWASP, style guides)
agents (multi-agent)    →    Security audit (3 scanners), parallel code review
branching (speculative) →    Migration strategies, test approaches, alternative fixes
outputFormat (JSON)     →    Structured reports, findings, CVE lists, migration plans
```

### What Makes Sandcaster Uniquely Suited

1. **Sandbox isolation** → Safe to run `npm audit`, analyze untrusted code, execute generated patches
2. **Bash execution** → Close the loop: write code + run tests + verify in same session
3. **Speculative branching** → Try multiple approaches in parallel sandboxes, pick what works
4. **Multi-agent orchestration** → Decompose complex audits into specialized sub-agents
5. **Structured output** → Machine-readable results that integrate into CI/CD, dashboards, ticket systems

---

## Related Research

- `research/research-executable-examples.md` — Feature-focused examples research
- `plans/10-executable-examples.md` — Implementation plan for examples directory
- Sandstorm source: `/Users/iamladi/Projects/experiments/sandstorm`
- [Devin 2025 Performance Review](https://cognition.ai/blog/devin-annual-performance-review-2025)
- [E2B Cookbook](https://github.com/e2b-dev/e2b-cookbook)
- [Dagger Self-Healing CI](https://dagger.io/blog/automate-your-ci-fixes-self-healing-pipelines-with-ai-agents/)
- [METR Developer Productivity Study](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/)

---

## Open Questions

1. **Sample data for security examples**: The `fix-security-vulns/` example needs a sample vulnerability report to include. Should it be a mock SonarQube export or a simplified format?
2. **CI logs format**: The `fix-ci-failure/` example needs sample CI log output. Should it be GitHub Actions format?
3. **Which migration to demonstrate**: React class → hooks? Python 2 → 3? Express → Hono? The migration example needs a concrete source/target.
4. **How many real-world examples total**: Research suggests 4 priority + 3 secondary = 7 new examples, for 16 total. Is that too many?
