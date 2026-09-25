# GUI Integration

Orbit exposes an `OrbitApplicationService` and lower-level `ThreadManager` for
desktop and other event-driven clients. Keep them in a trusted process, such as
the Electron main process or Orbit's loopback Express server, and expose only
application-specific operations through a validated transport boundary.

```text
Renderer -> validated transport -> OrbitApplicationService -> ThreadManager -> Agent
```

Do not import Orbit into an untrusted renderer. Orbit can read workspace files,
load credentials, and start MCP processes, so direct renderer access would
expand the impact of a renderer compromise.

Project-enabled hosts group separate conversations through core catalog APIs.
See [Projects](projects.md) for navigation, archive, movement, runtime resolution
and the unchanged CLI scope.

## Application service

`OrbitApplicationService` is the recommended boundary for a complete GUI. It
resolves settings and context sources, manages durable sessions and their log
partitions, returns runtime inspection data, owns the diagnostic event buffer,
and delegates thread runs.

Persistent examples require [offline storage initialization](session-storage.md)
before creating the first Thread. For a complete runnable host, use the
[agent example](../examples/agent/README.md). The snippets below show
individual integration points; `workspacePath`, renderer delivery and owner
identity are supplied by the host.

Create one service for the host and subscribe before starting work:

```ts
import {OrbitApplicationService} from '@cybergarage/orbit'

const application = await OrbitApplicationService.create({cwd: workspacePath})
const unsubscribe = application.subscribeRunSnapshots((snapshot) => {
  sendToRenderer(snapshot)
})
const unsubscribeLogs = application.subscribeLogs((record) => {
  sendLogToRenderer(record)
})
const thread = application.createThread()
const started = await application.startRun(thread.id, 'Inspect the failing test.', requestId)
if (started.kind === 'run') {
  // Backfill authoritative state even if events arrived before this response.
  sendToRenderer(await application.queryRun(started.runId))
} else {
  sendCommandResponseToRenderer(started.response)
}
```

Keep the service and subscriptions alive while the UI is open. Render pending
approvals from Run snapshots. After authenticating and authorizing the operator,
reply to the exact request:

```ts
await application.replyApproval(runId, {
  requestId: approval.id,
  digest: approval.digest,
  approve: ownerDecision,
})
```

The `local-gui` scope is assigned by the service; it is not a user authentication
mechanism. A GUI transport must validate the client's ownership of the Session.
A request can expire or be cancelled before the reply arrives; refetch on stale
replies rather than manufacturing a new approval.

Use `application.cancelRun(runId)` when the owner requests stop. Continue
observing the Run until its terminal result. During host shutdown, stop new
admissions, unsubscribe, and await `application.close()`. Handle close failures
as described in [Managed Execution](execution.md). A supplied log store remains
host-owned and must be closed after the service has settled.

Use `getSessionLogs(thread.id, {limit: 200})` for log backfill,
`getLogHealth()` for sink health and `getThread(thread.id)` to refresh messages.

The service returns after required admission, before model completion. Its
result is discriminated by `kind`: `run` contains a run ID; `command` does not.
Use `queryRun(id)` for authoritative sequenced snapshots, `replyApproval` for
a bound decision and `cancelRun` to request stop. Stop acceptance is not proof
of termination. Refetch snapshots on event gaps and reconnect; ignore older
sequences for the same run. Diagnostics are optional observations.
Use `getPreferences()` and `updatePreferences()` to manage diagnostics pane
visibility independently from diagnostic capture. Full capture is temporary and
returns to Metadata after 15 minutes.

Session log records use the version 2 event schema documented in
[Session Logging](logging.md). Backfill returns an opaque `next` cursor that
can be supplied as `after`; record IDs remain accepted for version 1
compatibility. The loopback server accepts `level`, `category`, `eventType`,
`outcome`, `search`, `limit`, and `after` on
`GET /api/sessions/:sessionId/logs`. `GET /api/logs/health` returns sink
counters.

## Thread lifecycle

```ts
import {SessionRepository, ThreadManager} from '@cybergarage/orbit'

const repository = new SessionRepository()
const manager = new ThreadManager({
  onEvent(event) {
    mainWindow.webContents.send('orbit:event', event)
  },
  sessionRepository: repository,
})

const thread = manager.createThread({
  agent: {
    cwd: projectPath,
    model: {name: modelName, provider: 'openai'},
  },
})

const run = manager.startRun(thread.id, 'Inspect the failing test.')
const reply = await run.completion
```

`ThreadManager` retains user, assistant, tool-call, and tool-result messages in
the thread session. It submits only each new user message to the agent; the
agent projects the complete model context from that session. Snapshots and
events use plain `ThreadMessage` objects that can cross an Electron IPC
boundary.

Passing a `SessionRepository` persists each thread under
`~/.orbit/sessions/`. The snapshot's optional `file` property identifies the
JSONL file. Resume it in a new manager instance with:

```ts
if (previousSnapshot.file === undefined) throw new Error('Thread is not persistent.')
const resumed = manager.resumeThread(previousSnapshot.file)
```

Without `sessionRepository`, threads remain in memory only. Closing a persisted
thread closes its writer but does not delete the JSONL file. To permanently
remove a saved GUI session, use `OrbitApplicationService.deleteSession(id)`;
it rejects active/quarantined threads, records deletion intent, then removes
logs, transcript and journal/key. A minimal completed marker prevents ID reuse.
Partial deletion is retryable even after the transcript has gone.

Only one run can be active in a thread. Independent threads can run in parallel.
Call `closeThread()` when a window or project closes, and call `close()` during
application shutdown so MCP child processes are released.

## Events and cancellation

The event stream reports these lifecycle transitions:

- `run-started`
- `model-started`
- `message-completed`
- `tool-started`
- `tool-updated`
- `tool-completed`
- `run-completed`
- `run-cancelled`
- `run-failed`

`ThreadManager.startRun()` returns a handle with an `admitted` promise. Await
that promise before using its durable run ID; retries can resolve an earlier
run. ApplicationService already awaits this boundary. Query the run snapshot
to distinguish cancellation, failure, budget exhaustion and incomplete cleanup.
The run ID is accepted by `cancelRun()`:

```ts
manager.cancelRun(runId)
```

Register more event consumers with `subscribe()` and remove them with the
returned unsubscribe callback. A constructor-level `onEvent` handler remains
supported.

Cancellation propagates through `AbortSignal` to OpenAI and Anthropic requests,
and aborts the active Ollama client request. Tools also receive the signal in
their invocation options and should stop promptly when it is aborted.

Model responses are currently delivered as completed messages. The lifecycle
API is designed so token-delta events can be added without changing the IPC
boundary. Tools can emit `tool-updated` events before their final result; Bash
uses these updates for incremental stdout and stderr chunks.

See [Managed Execution](execution.md) for compatibility changes and ownership.

## Explicit Skill selection

Configure `skillCatalog` on the service for read-only listing and structured
`startRun(threadId, content, {requestId, skills})`. Reconnect snapshots expose
requested/resolved IDs and digests; only explicit `skillHistory(sessionId)`
requests return full bodies. See [Skills](skills.md).

## Project memory

The core Project service groups independent conversations; the GUI exposes
curated notes, source excerpts, selection and preview. Memory is captured once
per managed Run as journal-v3 evidence and inserted as a fixed user-role prefix.
It is not appended to canonical history or included in compaction source text.
The prepared-request budget still includes it. Library callers opt in explicitly;
GUI Project conversations default to curated mode and offer Off. CLI workflows
remain single-session. See [Projects and curated memory](projects.md) for API,
source validation, compatibility and retained-history behavior.

### Budget continuation requests

The message endpoint also accepts optional `limits` (validated partial Run limits)
and `continueFromRunId`. Use a fresh `requestId` for an intentional continuation;
reuse it only for uncertain delivery of the identical request. Changed limits or
continuation identity conflict with an existing request ID. `ThreadSnapshot` exposes
`executionLimits` when supported by its Agent and `run.limits` for recorded runs.
The application restores saved Run status when resuming a session; recovered status
is observational, while continuation verifies owned storage before model/tool work.
