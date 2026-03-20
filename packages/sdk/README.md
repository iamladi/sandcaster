# @sandcaster/sdk

TypeScript SDK for [Sandcaster](https://github.com/iamladi/sandcaster) — run AI agents in isolated sandboxes.

[![npm](https://img.shields.io/npm/v/@sandcaster/sdk)](https://www.npmjs.com/package/@sandcaster/sdk)
[![license](https://img.shields.io/npm/l/@sandcaster/sdk)](https://github.com/iamladi/sandcaster/blob/main/LICENSE)

## Install

```bash
npm i @sandcaster/sdk
```

## Quick start

```ts
import { SandcasterClient } from "@sandcaster/sdk";

const client = new SandcasterClient({
  baseUrl: "http://localhost:8000",
  apiKey: "your-api-key",
});

for await (const event of client.query({ prompt: "Summarize the top HN stories" })) {
  if (event.type === "assistant") {
    process.stdout.write(event.content);
  }
}
```

### Sessions

Sessions keep sandbox state alive between messages:

```ts
let sessionId: string;

for await (const event of client.createSession({ prompt: "Set up a Python project" })) {
  if (event.type === "session_created") sessionId = event.sessionId;
}

for await (const event of client.sendSessionMessage(sessionId, { prompt: "Add a test suite" })) {
  if (event.type === "assistant") process.stdout.write(event.content);
}
```

### Cleanup

The client implements `Symbol.asyncDispose`, so all in-flight requests are aborted when the scope exits:

```ts
await using client = new SandcasterClient({ baseUrl: "http://localhost:8000" });
// requests abort automatically when `client` goes out of scope
```

## API

All streaming methods return `AsyncIterable<SandcasterEvent>` and accept an optional `{ signal?: AbortSignal }`.

| Method | Description |
|--------|-------------|
| `query(request)` | Stream a one-shot agent query |
| `createSession(request)` | Create a persistent session and run the first query |
| `sendSessionMessage(id, message)` | Send a follow-up message to a session |
| `attachSession(id)` | Attach to a running session and observe events |
| `listSessions()` | List all sessions |
| `getSession(id)` | Get session details |
| `deleteSession(id)` | Delete a session |
| `health()` | Server health check |
| `listRuns()` | List all runs |

## Event types

Events are a discriminated union on `type`. The core types are:

| Type | Description |
|------|-------------|
| `system` | System messages (sandbox ready, etc.) |
| `assistant` | Model output (`delta` or `complete`) |
| `thinking` | Model thinking (`delta` or `complete`) |
| `tool_use` | Tool invocation |
| `tool_result` | Tool output (includes `isError`) |
| `file` | File created/modified in the sandbox |
| `result` | Final result with cost, turns, and duration |
| `error` | Error with optional `code` and `hint` |
| `warning` | Non-fatal warning |
| `stderr` | Stderr output from the sandbox |
| `session_created` | Session created with `sessionId` |
| `session_expired` | Session timed out |
| `session_command_result` | Session command result |
| `branch_start` | Branch execution started |
| `branch_progress` | Branch progress update |
| `branch_complete` | Branch finished |
| `branch_selected` | Winning branch chosen by evaluator |
| `branch_summary` | Summary of all branches |
| `branch_request` | Agent requested branching |
| `confidence_report` | Agent confidence level |

## License

MIT — see the [main repo](https://github.com/iamladi/sandcaster) for full documentation.
