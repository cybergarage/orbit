# Session Persistence

Orbit records resumable agent sessions as append-only JSON Lines (JSONL). The
interactive CLI saves sessions automatically. Library users can create,
inspect, list, and resume sessions through `SessionRepository`, and GUI clients
can opt into the same storage through `ThreadManager`.

## Storage location

The default root is:

```text
~/.orbit/sessions/
```

Files are grouped by their UTC creation date:

```text
~/.orbit/sessions/YYYY/MM/DD/
  session-<ISO timestamp>-<session ID>.jsonl
```

For example:

```text
~/.orbit/sessions/2026/08/22/
  session-2026-08-22T01-02-03-004Z-019d....jsonl
```

Session IDs and newly created message IDs use UUIDv7 by default. The timestamp
and date directories support chronological listing; the first JSONL entry is
authoritative.

Applications and tests can use another root:

```ts
import {SessionRepository} from 'orbit'

const repository = new SessionRepository({rootDir: '/tmp/orbit-sessions'})
```

Orbit creates session directories with mode `0700` and files with mode `0600`
where the platform supports POSIX permissions.

## File format

The current format version is `1`. Every entry is one JSON object followed by
a newline. The entry's top-level `type` is its discriminator.

### Session header

The first entry must have `type: "session"`:

```json
{
  "type": "session",
  "version": 1,
  "id": "019d...",
  "rootMessageId": "019d...",
  "timestamp": "2026-08-22T01:02:03.004Z",
  "cwd": "/work/orbit",
  "originator": "orbit-interactive",
  "provider": "openai",
  "model": "gpt-5",
  "systemPrompt": "Effective project instructions"
}
```

Fields are:

- `version`: JSONL schema version;
- `id`: durable session ID;
- `rootMessageId`: ID of the in-memory compatibility header and parent of the
  first conversation message;
- `timestamp`: session creation time in ISO 8601 format;
- `cwd`: resolved working directory at creation;
- `originator`: optional creator name such as `orbit-interactive` or
  `orbit-thread-manager`;
- `provider` and `model`: optional initial model selection;
- `systemPrompt`: optional effective system-context snapshot.

The session ID and root message ID are intentionally different. The session ID
identifies the file; message IDs define the conversation chain.

### Turn context

An `Agent` records the effective execution context for every invocation:

```json
{
  "type": "turn_context",
  "timestamp": "2026-08-22T01:02:04.000Z",
  "turnId": "019d...",
  "cwd": "/work/orbit",
  "provider": "openai",
  "model": "gpt-5",
  "maxToolIterations": 5
}
```

The turn ID is generated as UUIDv7 unless the caller supplies
`AgentInvokeOptions.turnId`. `ThreadManager` uses its run ID as the turn ID, so
GUI lifecycle events and persisted records can be correlated.

### Turn event

Turn lifecycle entries have `type: "turn_event"` and one of four phases:

- `started`;
- `completed`;
- `cancelled`;
- `failed`.

```json
{
  "type": "turn_event",
  "timestamp": "2026-08-22T01:02:05.000Z",
  "turnId": "019d...",
  "phase": "failed",
  "error": {"name": "Error", "message": "Model request failed"}
}
```

Failed entries store `name`, `message`, and an optional stable Orbit error
`code`. Stack traces and arbitrary error properties are not persisted.

### Message

Model-visible messages use `type: "message"`:

```json
{
  "type": "message",
  "timestamp": "2026-08-22T01:02:04.100Z",
  "turnId": "019d...",
  "iteration": 0,
  "message": {
    "id": "019d...",
    "parentid": "019d...",
    "timestamp": "2026-08-22T01:02:04.099Z",
    "type": "assistant",
    "role": "assistant",
    "contents": ["Done"]
  }
}
```

The nested message preserves Orbit's public message representation:

- `id`: stable message ID;
- `parentid`: preceding message ID;
- `timestamp`: original message creation time;
- `type`: `session`, `user`, `assistant`, or `tool`;
- `role`: model role;
- `contents`: string content blocks;
- `payload`: optional provider-neutral structured data.

`turnId` is optional for messages appended outside an agent turn. `iteration`
is recorded for assistant and tool-loop output.

Messages appended in one operation form a linear chain: the first points to
the current leaf and every later message points to the preceding new message.
Existing IDs and timestamps are preserved when a message is stored or loaded.

Assistant tool calls remain in `payload.toolCalls`. Tool results retain
`toolCallId`, `name`, `input`, `output`, and `isError`, allowing calls and
results to be correlated after resume.

## JSON safety

All persisted values must be representable without lossy JSON conversion.
Orbit rejects:

- `bigint`, functions, symbols, and `undefined` values;
- non-finite numbers;
- circular references;
- class instances and binary objects that are not plain JSON objects.

This validation applies to message payloads, including tool inputs and
outputs. In-memory sessions do not require a recorder and therefore do not
apply disk serialization until explicitly persisted.

Session files can contain prompts, workspace content, tool arguments, and tool
results. Orbit never writes provider settings, API keys, client objects,
callbacks, abort signals, or process environment variables as session
metadata, but applications must still treat the files as sensitive local data.

## Creating and closing a session

`SessionRepository.create()` creates the header synchronously and returns a
session with an ordered asynchronous recorder:

```ts
import {Message, MessageType, SessionRepository} from 'orbit'

const repository = new SessionRepository()
const session = repository.create({
  cwd: process.cwd(),
  model: 'gpt-5',
  originator: 'my-app',
  provider: 'openai',
  systemPrompt: 'Project instructions',
})

session.appendMessages([new Message(MessageType.User, {content: 'Hello'})])

await session.flush()
await session.close()
```

`flush()` waits for queued entries. `close()` waits for pending writes, releases
the in-process writer reservation, and is idempotent. Owners must close every
persistent session during normal shutdown and failure cleanup.

`new Session()` remains an in-memory session. This keeps the reusable library
usable without filesystem access.

## Agent recording

An `Agent` writes to the `Session` in its `State`. Every invocation records:

1. effective turn context;
2. a `started` turn event;
3. messages newly submitted for the turn;
4. every assistant response, including intermediate tool calls;
5. every completed tool result;
6. one terminal `completed`, `cancelled`, or `failed` event;
7. a recorder flush before the invocation resolves or rejects.

`Agent.run(session, newMessages)` records into the supplied session.
`Agent.invoke(newMessages)` records into the agent state's session. Both
methods expect only messages newly submitted for that invocation. Passing a
message that already belongs to the session is rejected as a duplicate.

Direct library callers resuming a session should open it through
`SessionRepository`, inject it through `State`, and pass only the next user
message. Interactive mode and `ThreadManager` follow this contract
automatically.

## Model context assembly

`Session` is the canonical source for model-visible conversation history.
After an agent records new input, `SessionContextBuilder` projects the current
session into a provider-neutral `SessionModelContext`. The initial linear
implementation returns copied user, assistant, and tool messages in their
persisted oldest-to-newest order.

Every model iteration is assembled as:

```text
Agent.messages
+ SessionContextBuilder.build(session).messages
```

`Agent.messages` is the stable prefix for system and workspace instructions.
It is kept outside ordinary session conversation so the same instructions are
not persisted and sent twice. On resume, `ThreadManager` restores the effective
system prompt from session metadata unless the caller explicitly overrides
agent messages.

The agent rebuilds session context before every model call. When an assistant
requests a tool, the assistant message and completed tool results are recorded
first; the next iteration therefore receives the same prior conversation plus
the new call and result records. Provider adapters remain responsible for
wire-specific serialization, such as moving system messages to Anthropic's
top-level `system` field.

`SessionContextBuilder` is exported and can be injected through
`AgentOptions.deps.sessionContextBuilder` for embedding and deterministic
tests. The version 1 builder does not compact, branch, filter by modality, or
enforce a token budget. Those policies can be added at this projection
boundary without changing callers back to complete-history submission.

## Interactive mode

`runInteractiveSession()` creates a persistent session automatically with the
default `SessionRepository`. It stores the effective initial provider, model,
working directory, and system prompt in the header. Each request reuses the
same session even when a new provider-specific `Agent` is constructed. The UI
submits only the new user message; the agent derives prior model context from
the session.

Slash-command notices such as `/help` and `/debug` are local UI messages and
are not persisted or sent as model-visible conversation. Submitted commands
are written to the structured application log. A `/model` change appears in
the next turn's `turn_context`. Use `/session` to print the active session ID,
status, timestamps, working directory, originator, current provider and model,
transcript file, and preview. The command uses the current runtime provider and
model when they differ from the persisted header.

The session recorder is closed when the Ink application exits. Callers can
inject `session` or `sessionRepository` through `InteractiveSessionOptions` for
embedding and tests. A caller-supplied session remains owned by the caller and
is not closed by `runInteractiveSession()`.

Plain `orbit` starts a new session. Resume an existing interactive CLI or GUI
session explicitly with the top-level CLI command:

```sh
orbit resume --last
orbit resume <SESSION_ID>
orbit resume --last --all
```

`--last` selects the most recently updated eligible session whose saved
working directory matches the launch directory. Recency uses `updatedAt`, not
the session creation time. `--all` removes the working-directory filter. An
exact session ID is resolved across the complete session store and does not
require `--all`.

Orbit resumes the session in its saved working directory. Workspace settings
are loaded from that directory. Explicit provider and model flags override
the persisted session values, which override workspace defaults. The saved
system prompt is retained; current system contexts are loaded only when an
older session has no stored system prompt. The TUI displays the persisted user
and assistant history before accepting another message.

Version 1 requires either an exact ID or `--last`. A bare `orbit resume`
reports the supported forms; an interactive session picker is not implemented
yet. Resume failures never create a new session implicitly.

Inspect a saved session without resuming it or obtaining its writer lock:

```sh
orbit session <SESSION_ID>
orbit session --last
orbit session --last --all
```

The selection rules match `orbit resume`: exact IDs are global, `--last` is
scoped to the launch working directory, and `--last --all` searches all saved
working directories. Bare `orbit session` reports the supported forms instead
of guessing.

Human-readable output is the default. Scripts can request the same
`SessionSummary` fields as JSON or print only the full ID:

```sh
orbit session <SESSION_ID> --json
orbit session --last --id-only
```

`--json` and `--id-only` are mutually exclusive. Inspection is read-only: it
does not send a model request, resume the conversation, change status or
recency, or modify the transcript. JSON and human output include local working
directory and transcript paths; review them before pasting output into a public
issue.

Saved sessions can be deleted with another top-level CLI command:

```sh
orbit delete <SESSION_ID>
orbit delete <SESSION_ID> --force
```

The first form asks for confirmation. Use `--force` for scripts and other
non-interactive environments.

## ThreadManager persistence

`ThreadManager` remains in-memory by default. Pass a repository to persist
threads:

```ts
import {SessionRepository, ThreadManager} from 'orbit'

const repository = new SessionRepository()
const manager = new ThreadManager({sessionRepository: repository})
const thread = manager.createThread({
  agent: {
    cwd: process.cwd(),
    model: {name: 'gpt-5', provider: 'openai'},
  },
})

await manager.sendMessage(thread.id, 'Inspect the project.')
const snapshot = manager.getThread(thread.id)
await manager.close()
```

A persistent `ThreadSnapshot` includes `file`. Resume it with a new manager
that uses a repository:

```ts
if (snapshot?.file === undefined) throw new Error('Thread is not persistent.')
const resumed = manager.resumeThread(snapshot.file)
```

The resumed thread keeps the original session and thread ID, message IDs,
timestamps, tool history, and parent chain. `closeThread()` and `close()` close
the agent and recorder but do not delete the JSONL file.

Delete a closed persisted session by ID through its repository:

```ts
const deleted = await repository.delete(snapshot.id)
```

`delete()` returns the deleted summary, or `undefined` when the session does
not exist. It obtains the same cross-process writer lock used by resume and
refuses to unlink a session that is open for writing in any Orbit process. GUI
integrations should close the corresponding thread first;
`OrbitApplicationService.deleteSession()` performs both operations in order.
Deletion is permanent and removes the JSONL transcript rather than archiving
or hiding it.

Only one run may be active per thread. Independent threads can run in
parallel, and each session has its own ordered recorder. `ThreadManager`
submits only the new user message to its agent. The agent records that message
and derives the complete model context from the thread's session.

## Listing sessions

`SessionRepository.list()` recursively scans the date directories and returns
newest-created sessions first:

```ts
const sessions = repository.list()
```

Each `SessionSummary` contains:

- `id`, `file`, `createdAt`, and `updatedAt`;
- `cwd`;
- optional `originator`, `provider`, and `model`;
- `status`: `new`, `interrupted`, `completed`, `cancelled`, or `failed`.

The summary is rebuilt from JSONL. No separate index or database is currently
maintained.

`SessionSummary` extends the shared `SessionInformation` read model. Library
integrations can derive the same fields from an active `Session` and format the
same human-readable output used by the CLI:

```ts
import {createSessionInformation, formatSessionInformation} from 'orbit'

const information = createSessionInformation(session, {
  model: currentModel,
  provider: currentProvider,
})
console.log(formatSessionInformation(information))
```

The optional overrides represent active runtime values; they do not mutate the
session header or transcript.

Use `findLatest()` when recency must be based on the last session activity:

```ts
const latest = await repository.findLatest({
  cwd: process.cwd(),
  originators: ['orbit-interactive', 'orbit-thread-manager'],
})
```

The optional `cwd` and `originators` filters are applied before returning the
greatest `updatedAt`. Omitting `cwd` searches all saved working directories.

## Resume and recovery

`SessionRepository.open(file)` validates every line before returning a writable
session. Loading preserves message IDs, timestamps, payloads, parents, turn
contexts, and lifecycle events.

Validation rejects:

- a missing or misplaced session header;
- unsupported schema versions or entry types;
- invalid fields and unsafe JSON values;
- duplicate message IDs;
- missing or forward parent references;
- malformed JSON in the middle of a file.

An interrupted append may leave one malformed, unterminated final line. Orbit
removes that incomplete tail when opening the session, rewrites the valid
entries with complete newlines, and then resumes appending. Other corruption is
reported with the file path and line number and is not modified.

Orbit creates a sidecar lock before creating, opening, repairing, resuming, or
deleting a session. The lock contains its owning process ID and a unique token.
An existing live owner excludes other Orbit processes. A session opened by the
GUI therefore rejects a concurrent CLI resume in that case. This does not yet
guarantee exclusion while multiple processes reclaim a dead owner.

Locks whose owner process no longer exists are removed automatically before
the next open. That check and removal are not atomic: simultaneous recovery can
remove a replacement lock and admit two writers. Serialize crash recovery
externally until the [known recovery defect](execution.md#current-stale-lock-recovery-limitation)
is resolved. Malformed locks fail closed because Orbit cannot safely prove
that their owner is gone. A recorder removes only a lock with its own token,
so it cannot release a replacement owner's lock.

## Current scope

Version 1 implements a linear, append-only conversation with resume,
inspection, and whole-session deletion. It does not yet implement:

- in-file branches or leaf selection;
- forked session creation;
- compaction and branch summaries;
- labels, titles, or archive;
- a session index or SQLite projection;
- cross-session shell input history;
- an interactive resume picker;
- cwd selection when the launch and saved directories differ.

These features can be added as new typed entries and repository operations.
Changes that alter existing fields require an explicit format migration and a
new `version`.

## Managed execution ownership and deletion

Session transcript version 1 remains readable. Its historical turn phases are
not the full managed `RunResult`: use the execution journal for quiescence,
recording, approvals and incomplete outcomes. Older turns have unknown approval
provenance. `Session.synchronize(level)` provides an explicit transcript barrier
and high-water value without redefining ordinary `flush()` as fsync.

A persistent Agent delegates the SessionRecorder writer lease until its journal
closes. A borrowed persistent Session without a writer cannot execute managed
runs. Close Agent first, then its Session; an incomplete close retains ownership
until pending work settles or is explicitly reconciled. Do not unlink lock files
because a timeout elapsed.

The default journal root is `~/.orbit/runs`. An explicit repository `rootDir`
uses `<rootDir>/.runs` unless `journalRoot` is supplied. Configure that root on
SessionRepository so resume, queries and deletion use the same partition.
Repository deletion rejects managed journals; use `SessionDeletionService` or
the application service. Deletion rejects active/quarantined sessions and retains
a minimal marker; retries can return only `{id}` after the transcript is gone.
See [Managed Execution](execution.md#recording-and-recovery).
