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
{"type":"session","version":1,"id":"019d...","rootMessageId":"019d...","timestamp":"2026-08-22T01:02:03.004Z","cwd":"/work/orbit","originator":"orbit-interactive","provider":"openai","model":"gpt-5","systemPrompt":"Effective project instructions"}
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
{"type":"turn_context","timestamp":"2026-08-22T01:02:04.000Z","turnId":"019d...","cwd":"/work/orbit","provider":"openai","model":"gpt-5","maxToolIterations":5}
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
{"type":"turn_event","timestamp":"2026-08-22T01:02:05.000Z","turnId":"019d...","phase":"failed","error":{"name":"Error","message":"Model request failed"}}
```

Failed entries store `name`, `message`, and an optional stable Orbit error
`code`. Stack traces and arbitrary error properties are not persisted.

### Message

Model-visible messages use `type: "message"`:

```json
{"type":"message","timestamp":"2026-08-22T01:02:04.100Z","turnId":"019d...","iteration":0,"message":{"id":"019d...","parentid":"019d...","timestamp":"2026-08-22T01:02:04.099Z","type":"assistant","role":"assistant","contents":["Done"]}}
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

session.appendMessages([
  new Message(MessageType.User, {content: 'Hello'}),
])

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
3. request messages whose IDs are not already present;
4. every assistant response, including intermediate tool calls;
5. every completed tool result;
6. one terminal `completed`, `cancelled`, or `failed` event;
7. a recorder flush before the invocation resolves or rejects.

This ID-based append policy permits callers to pass the complete conversation
on each invocation without duplicating earlier messages in the session.
`Agent.run(session, messages)` records into the supplied session;
`Agent.invoke(messages)` records into the agent state's session.

The `Agent` API still accepts the model conversation as `messages`. Direct
library callers resuming a session should pass
`session.getConversationMessages()` plus the new user message. Interactive mode
and `ThreadManager` do this automatically.

## Interactive mode

`runInteractiveSession()` creates a persistent session automatically with the
default `SessionRepository`. It stores the effective initial provider, model,
working directory, and system prompt in the header. Each request reuses the
same session even when a new provider-specific `Agent` is constructed.

Slash-command notices such as `/help` and `/debug` are local UI messages and
are not persisted or sent as model-visible conversation. Submitted commands
are written to the structured application log. A `/model` change appears in
the next turn's `turn_context`.

The session recorder is closed when the Ink application exits. Callers can
inject `session` or `sessionRepository` through `InteractiveSessionOptions` for
embedding and tests. A caller-supplied session remains owned by the caller and
is not closed by `runInteractiveSession()`.

Interactive session selection and a `/resume` command are not currently
implemented. Resume is available through the library API.

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
the agent and recorder but do not delete the JSONL file. There is no delete API
in the current release.

Only one run may be active per thread. Independent threads can run in
parallel, and each session has its own ordered recorder.

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

Orbit prevents two writers from opening the same resolved file in one process.
Cross-process file locking is not currently implemented; applications must not
resume the same session concurrently in separate processes.

## Current scope

Version 1 implements a linear, append-only conversation with resume and
inspection. It does not yet implement:

- in-file branches or leaf selection;
- forked session creation;
- compaction and branch summaries;
- labels, titles, archive, or deletion;
- a session index or SQLite projection;
- cross-session shell input history;
- cross-process writer locks;
- interactive session selection commands.

These features can be added as new typed entries and repository operations.
Changes that alter existing fields require an explicit format migration and a
new `version`.
