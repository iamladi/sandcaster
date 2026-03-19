# Competitive Analysis

Agent researches competitors, crawls their sites, and produces a structured market analysis.

## Prerequisites

- sandcaster CLI installed (from monorepo: `cd apps/cli && bun link`)

## Setup

```bash
export E2B_API_KEY="your-key"       # https://e2b.dev/dashboard
export OPENAI_API_KEY="your-key"    # https://platform.openai.com/api-keys
```

## Run

```bash
sandcaster "Analyze the CRM market: HubSpot, Salesforce, Pipedrive"
```

## What Happens

The agent fetches competitor websites, analyzes positioning and features, and returns a structured JSON report with competitor profiles, market insights, and recommendations.

## Configuration

See `sandcaster.json` for the full configuration. Key settings:
- `model`: gpt5 (OpenAI gpt-5.4 — cost-efficient default)
- `maxTurns`: 20 (enough for multi-site research)
- `outputFormat`: JSON schema for competitive analysis report

## Troubleshooting

- **"No LLM provider API key found"**: Set `OPENAI_API_KEY` in your environment
- **"E2B_API_KEY not set"**: Get a key at https://e2b.dev/dashboard
- **Model not available**: Replace `gpt5` with `sonnet` or `haiku` in sandcaster.json
