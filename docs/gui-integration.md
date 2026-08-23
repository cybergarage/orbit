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
resolves settings and context sources, manages durable sessions, returns runtime
inspection data, owns the diagnostic event buffer, and delegates thread runs.

```ts
import {OrbitApplicationService} from 'orbit'

const application = await OrbitApplicationService.create({cwd: workspacePath})
const thread = application.createThread()
const run = application.startRun(thread.id, 'Inspect the failing test.')

const unsubscribe = application.subscribe((event) => {
  sendToRenderer(event)
})

// Use run.runId for immediate cancellation.
application.cancelRun(run.runId)

unsubscribe()
await application.close()
```

The application service intentionally returns a run ID without waiting for the
model. Completion, failure, and cancellation are projected through diagnostic
events so command responses and asynchronous notifications remain separate.
Use `getPreferences()` and `updatePreferences()` to manage diagnostics pane
visibility independently from diagnostic capture.

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
thread closes its writer but does not delete the JSONL file.

Only one run can be active in a thread. Independent threads can run in parallel.
Call `closeThread()` when a window or project closes, and call `close()` during
application shutdown so MCP child processes are released.

## Events and cancellation

The event stream reports these lifecycle transitions:

- `run-started`
- `model-started`
- `message-completed`
- `tool-started`
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
boundary.
