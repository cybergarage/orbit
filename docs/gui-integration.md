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

## Application service

`OrbitApplicationService` is the recommended boundary for a complete GUI. It
resolves settings and context sources, manages durable sessions and their log
partitions, returns runtime inspection data, owns the diagnostic event buffer,
and delegates thread runs.

```ts
import {OrbitApplicationService} from 'orbit'

const application = await OrbitApplicationService.create({cwd: workspacePath})
const thread = application.createThread()
const run = application.startRun(thread.id, 'Inspect the failing test.')

const unsubscribe = application.subscribe((event) => {
  sendToRenderer(event)
})
const unsubscribeLogs = application.subscribeLogs((record) => {
  sendLogToRenderer(record)
})

const backfill = await application.getSessionLogs(thread.id, {limit: 200})
const toolFailures = await application.getSessionLogs(thread.id, {
  categories: ['tool'],
  outcomes: ['failed'],
})
const logHealth = application.getLogHealth()

// Use run.runId for immediate cancellation.
application.cancelRun(run.runId)

unsubscribe()
unsubscribeLogs()
await application.close()
```

The application service intentionally returns a run ID without waiting for the
model. Completion, failure, and cancellation are projected through diagnostic
events so command responses and asynchronous notifications remain separate.
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
import {SessionRepository, ThreadManager} from 'orbit'

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
    model: {name: 'gpt-5.6', provider: 'openai'},
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
it closes any loaded thread, deletes the session log partition, and then deletes
the transcript.

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

`startRun()` returns the run ID immediately. The same ID is present on every
run event and is accepted by `cancelRun()`:

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
