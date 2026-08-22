# GUI Integration

Orbit exposes a `ThreadManager` for desktop and other event-driven clients. Keep
the manager in a trusted process, such as the Electron main process, and expose
only application-specific operations through a preload bridge.

```text
Renderer -> preload bridge -> Electron main -> ThreadManager -> Agent
```

Do not import Orbit into an Electron renderer. Orbit can read workspace files,
load credentials, and start MCP processes, so renderer access would expand the
impact of a renderer compromise.

## Thread lifecycle

```ts
import {ThreadManager} from 'orbit'

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

const reply = await manager.sendMessage(thread.id, 'Inspect the failing test.')
```

`ThreadManager` retains user, assistant, tool-call, and tool-result messages so
subsequent requests receive the complete conversation. Snapshots and events use
plain `ThreadMessage` objects that can cross an Electron IPC boundary.

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

The `run-started` event contains the run ID used by `cancelRun()`:

```ts
manager.cancelRun(runId)
```

Cancellation propagates through `AbortSignal` to OpenAI and Anthropic requests,
and aborts the active Ollama client request. Tools also receive the signal in
their invocation options and should stop promptly when it is aborted.

Model responses are currently delivered as completed messages. The lifecycle
API is designed so token-delta events can be added without changing the IPC
boundary.
