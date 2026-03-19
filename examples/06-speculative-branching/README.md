# Speculative Branching

Agent runs 3 parallel branches for the same task, then an LLM judge picks the best result.

## Prerequisites

- sandcaster CLI installed (from monorepo: `cd apps/cli && bun link`)

## Setup

```bash
export E2B_API_KEY="your-key"       # https://e2b.dev/dashboard
export OPENAI_API_KEY="your-key"    # https://platform.openai.com/api-keys
```

## Run

```bash
sandcaster "Write a function to parse CSV files"
```

## What Happens

Sandcaster spawns 3 parallel sandbox branches, each independently implementing the task. An LLM judge evaluates all results for correctness, readability, and performance, then selects the best implementation.

## Configuration

See `sandcaster.json` for the full configuration. Key settings:
- `model`: gpt5 (OpenAI gpt-5.4 — cost-efficient default)
- `branching.enabled`: true (activates speculative branching)
- `branching.count`: 3 (number of parallel branches)
- `branching.trigger`: always (branch on every request)
- `branching.evaluator`: llm-judge with custom evaluation prompt

## Troubleshooting

- **"No LLM provider API key found"**: Set `OPENAI_API_KEY` in your environment
- **"E2B_API_KEY not set"**: Get a key at https://e2b.dev/dashboard
- **Model not available**: Replace `gpt5` with `sonnet` or `haiku` in sandcaster.json
