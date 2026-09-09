---
status: accepted
proposed-date: 2026-08-22
decision-date: null
implementation-status: completed
implementation-completed-date: 2026-08-22
implementation-commits:
  - "14ee99f4d2b036fc6d8836f0c041a00bb576e1b2"
superseded-by: []
---

# Session Persistence Design

## Purpose

Orbit should persist each agent session as JSON Lines (JSONL) under
`~/.orbit/sessions/`. The persisted data must be sufficient to inspect a run,
resume the same conversation, and add future operations such as fork, archive,
and compaction without replacing the file format.

This document records Orbit's pre-implementation behavior, lessons from Pi's
`session.jsonl` and Codex's rollout files, the selected Orbit format, and the
work that was required to implement it. The detailed baseline and proposal are
retained as historical evidence for the implemented decision.

## Decision

Orbit will persist each session as a versioned append-only JSONL aggregate under
the application session root. Domain objects remain separate from the disk
codec, session and thread identities are aligned, runtime activity is recorded
as typed entries, and load and recovery behavior explicitly validates corrupt
or incomplete data.

## Related accepted extension (2026-09-07)

[Required Execution Journal](2026-09-07-required-execution-journal.md)
retains transcript formats/readability and adds managed-run recording, shared
writer authority, explicit synchronization, and coordinated deletion/recovery.
This ADR remains accepted for its original scope. At that acceptance, the extension was
not implemented; the historical rationale and implementation
evidence below do not establish completion of that extension. Its current
implementation status is partial, as recorded in the linked journal ADR.

## Accepted recovery refinement (2026-09-08)

[Session Writer Recovery Guard](2026-09-08-session-writer-recovery-guard.md)
now defines guarded reclamation, stable scope, verified persistent journal
leases and offline migration for the single-writer requirement. Mutating
low-level APIs and legacy deletion gain explicit migration conditions; the
read-only isOpen wrapper remains conservative. This refines the recovery policy
without replacing the original transcript/selection contracts, so this record
remains accepted and its historical implementation metadata is retained.
The new recovery implementation has not started. The previously reproduced
two-writer defect remains unresolved; the older completed evidence below must
not be used to claim completion of the new contract.

## Consequences

- Positive: sessions can be inspected and resumed across processes without
  flattening model-visible history or losing tool-call relationships.
- Negative: every session mutation now carries ordered asynchronous persistence,
  validation, recovery, sensitive-data, and cleanup responsibilities.
- Neutral: branching, archive, compaction, and indexing can extend the versioned
  envelope later without being part of the initial linear-session decision.

## Implementation and Confirmation

The initial persistence scope was implemented on 2026-08-22 by commit
`14ee99f4d2b036fc6d8836f0c041a00bb576e1b2`. Session codec, repository,
recorder, agent, interactive, and thread tests confirm recording, recovery,
listing, and resume behavior.

## Terminology

- **Session**: A durable conversation and its execution history. A session ID
  identifies the JSONL file's logical contents.
- **Thread**: The GUI-facing handle for a session. Orbit should use the same ID
  for a durable thread and its session instead of maintaining two unrelated
  histories.
- **Turn**: One user request and all model and tool activity needed to produce
  its final result. The existing `runId` is suitable as the turn ID.
- **Entry**: One JSON object on one line of a session file.
- **Message**: Model-visible user, assistant, system, or tool content. Messages
  have IDs distinct from the session ID.
- **Leaf**: The current last message on the active history path. This is mostly
  a future concern while Orbit supports only linear conversations.

## Reference implementation findings

### Pi

Pi stores sessions under a directory grouped by working directory. Its first
JSONL line is a versioned session header; later lines are typed entries. Each
entry has an `id` and `parentId`, which makes the append-only file a tree rather
than only a chronological transcript.

Important properties to retain are:

- the session ID is separate from entry IDs;
- the header contains a schema version, creation time, working directory, and
  optional parent session;
- message, model change, compaction, branch summary, label, and session
  information are different entry types;
- existing entries are not rewritten when a branch is created;
- loading validates and migrates older schema versions;
- resume reconstructs the in-memory tree and active history path;
- fork creates a new session ID and file while retaining provenance;
- the durable representation is not identical to the messages sent to a
  model; a context builder performs that conversion.

Pi demonstrates that message text alone is insufficient once a session can
change models, compact context, branch, or carry extension state.

### Codex

Codex stores date-sharded rollout files. Each line has a timestamp and a typed
payload. The first line contains session metadata, while later lines record
turn context, model-visible response items, selected UI events, compaction,
and other state needed for replay or inspection.

Important properties to retain are:

- the JSONL file is the human-readable, append-only primary record;
- persistence policy is centralized instead of being scattered across event
  producers;
- effective turn context such as model, approval policy, and working directory
  is recorded because configuration can change between turns;
- tool calls and results retain their correlation ID;
- writes are serialized through one recorder rather than performed by every
  producer independently;
- lightweight indexes are separate from the primary record;
- input history is separate because it has a different purpose from session
  reconstruction;
- resume and fork reconstruct runtime state from persisted records;
- a query-optimized database may coexist with JSONL later, but does not need to
  replace the primary record initially.

### Combined direction for Orbit

Orbit should adopt Pi's versioned, extensible session entries and distinct
session/message identities together with Codex's explicit turn context,
central persistence policy, and single-writer architecture. Tree navigation,
compaction, a global index, and SQLite are useful extensions but should not
block a reliable linear-session implementation.

## Current Orbit implementation

Orbit currently has three related but independent in-memory histories.

### `Session` and `State`

`src/core/session/session.ts` owns an array of messages and inserts a
`SessionHeader` when constructed. `State` owns one `Session`, and `Agent`
creates a new `State` when none is injected.

The current session layer provides only:

- an automatically generated header message;
- append operations;
- first and last message IDs;
- a copied message array for reading.

It does not provide a durable session ID, schema version, working directory,
model information, file path, load operation, validation, migration, list,
resume, fork, archive, or delete operation.

`Agent.invoke()` appends the request messages, each model response, and tool
results to the agent's internal session. However, callers normally pass the
complete conversation on each invocation. Reusing one agent therefore appends
old messages again. Conversely, the interactive UI constructs a new agent for
each request, so each agent's internal session is discarded after that request.
The existing `Session` is consequently not a reliable conversation record in
either usage pattern.

`Session.appendMessages()` also assigns the same previous leaf as the parent of
every message in one batch. This is explicitly covered by a current test, but
it does not create a linear message chain. The desired parent semantics must be
decided before persisted trees or forks are implemented.

### Interactive state

`src/core/interactive.tsx` stores user and final assistant messages in React
state. It rebuilds the full request from that array and creates a new `Agent`
for every user input.

This history:

- is lost when the process exits;
- does not use the agent's `Session` after invocation;
- does not retain intermediate assistant tool-call messages or tool results;
- mixes local slash-command output with model conversation messages;
- recreates the system message on every request with a new ID and timestamp;
- cannot be resumed or inspected after the UI closes.

### `ThreadManager`

`src/core/thread.ts` has a separate `ManagedThread.messages` array and emits
typed run, model, message, and tool events. It retains enough information for
multiple requests while the manager remains alive, but `closeThread()` removes
the thread permanently from memory.

The manager does not create, own, or load a core `Session`. Its user messages
and model messages are stored as their original `Message` objects, whose
`parentid` values are normally `null`. The agent simultaneously writes copies
to a different internal `Session`. A GUI snapshot and the agent session are
therefore separate representations with different IDs and parent links.

### Message representation

`Message` already has useful durable fields:

- UUIDv7 `id`;
- ISO 8601 `timestamp`;
- `type` and `role`;
- `contents`;
- `parentid`;
- an optional provider-neutral `payload`.

Assistant tool calls use `payload.toolCalls`, and tool result messages include
`toolCallId`, input, output, name, and error state. This is a reasonable base,
but `payload` is currently `unknown`, has no persistence validation, and may
contain values that `JSON.stringify()` cannot safely encode. Provider adapters
do not currently retain model usage, stop reason, provider response IDs, or
other metadata that could be useful for diagnostics.

The constructors always generate new IDs and timestamps. A loader cannot
hydrate an existing message without a new internal construction or codec API.

### Storage path

`src/core/app.ts` exports `sessionsDir()`, but no caller uses it. It currently
uses `env-paths`, which does not mean `~/.orbit/sessions/` on every platform. On
macOS it normally resolves inside `~/Library/Application Support`.

The requested storage contract is specifically `~/.orbit/sessions/`. The
implementation must therefore change or replace `sessionsDir()` rather than
assuming the current helper already satisfies the contract. The path should be
derived from the user's home directory and `DOT_APP_DIR_NAME`, with an explicit
override injected for tests and embedders.

## Required architecture

### One canonical session aggregate

There must be one authoritative in-memory session for all entry points:

- `State` owns the session aggregate;
- `Agent` records only new turn activity into that aggregate;
- the interactive UI renders a projection of the same session;
- `ThreadManager` uses a session ID as its thread ID and snapshots the same
  session;
- the recorder persists entries emitted by the aggregate;
- a context builder derives provider input from the active session path.

Interactive state, thread state, and agent state must not independently append
copies of the same messages.

### Separate domain objects from the disk codec

Do not persist class instances with a direct `JSON.stringify(message)` call.
Define versioned plain-data types and explicit encode/decode functions. The
decoder must preserve IDs and timestamps, validate every field, and return
actionable errors containing the file and line number.

A clean module split would be:

```text
src/core/session/
  entries.ts       Durable entry types
  codec.ts         JSON encoding, parsing, validation, and migration
  session.ts       In-memory aggregate and active history
  recorder.ts      Ordered append and flush/close behavior
  repository.ts    Create, open, list, resume, fork, and archive
  policy.ts        Central decision about which runtime events are durable
  paths.ts         Storage root and file naming
```

The exact filenames may change, but these responsibilities should remain
separate and dependency-injected for deterministic tests.

### File layout

Use date sharding so listing does not require one indefinitely growing
directory:

```text
~/.orbit/
  sessions/
    2026/
      08/
        21/
          session-2026-08-21T10-30-12-123Z-<session-id>.jsonl
    archived/
```

The session ID should be UUIDv7. The timestamp in the path and filename is an
indexing aid; the header remains authoritative. The working directory belongs
in the header, not in a sanitized directory name. This avoids path collisions
and permits sessions to survive a workspace move. Listing APIs can filter by
the header's `cwd` initially and use an index later if scanning becomes costly.

Create directories with user-only permissions where supported and session
files with mode `0600`. Tests must always inject a temporary storage root and
must not read or write the developer's real `~/.orbit` directory.

### JSONL envelope and version 1 entries

Every line must be one complete JSON object terminated by `\n`. Use a common
envelope:

```ts
interface SessionLine<TType extends string, TPayload> {
  timestamp: string
  type: TType
  payload: TPayload
}
```

The first line must be `session_meta`:

```json
{"timestamp":"2026-08-21T10:30:12.123Z","type":"session_meta","payload":{"version":1,"sessionId":"019c...","cwd":"/work/orbit","originator":"orbit-cli","orbitVersion":"0.1.0","provider":"openai","model":"gpt-5","systemPrompt":"effective prompt snapshot"}}
```

Required fields are:

- `version`: the disk schema version, initially `1`;
- `sessionId`: UUIDv7 for the session, distinct from all message IDs;
- `cwd`: the resolved working directory at creation;
- `originator`: for example `orbit-cli`, `orbit-interactive`, or an embedder
  supplied value;
- `orbitVersion`: the package version that created the file;
- initial `provider` and `model`;
- the effective system prompt or system-context snapshot actually used by the
  model, when one exists;
- optional `parentSessionId` and `parentSessionFile` for a future fork.

Do not make the current `SessionHeader` message the durable session ID. Keep a
compatibility facade if the public API requires it, but session metadata is not
a model conversation node.

Version 1 should support these later lines.

#### `turn_context`

Write one entry before invoking the model for each user turn:

```json
{"timestamp":"2026-08-21T10:30:20.000Z","type":"turn_context","payload":{"turnId":"019c...","cwd":"/work/orbit","provider":"openai","model":"gpt-5","maxToolIterations":5}}
```

This entry captures the effective values, not only user configuration. It is
required because `/model`, workspace settings, and future execution policy may
change during a session. Add future context fields in a backwards-compatible
way rather than copying credentials or full settings objects.

#### `message`

Write each model-visible message once:

```json
{"timestamp":"2026-08-21T10:30:20.010Z","type":"message","payload":{"turnId":"019c...","iteration":0,"message":{"id":"019c...","parentid":null,"timestamp":"2026-08-21T10:30:20.009Z","type":"user","role":"user","contents":["Inspect the failing test."]}}}
```

The stored message shape should initially preserve Orbit's public `parentid`
spelling to avoid an undocumented wire-format change. A future public API
cleanup may migrate it to `parentId`, but the codec must handle that as a schema
migration rather than accepting both spellings indefinitely.

For assistant tool-call messages and tool result messages, retain the existing
correlation ID. Record the exact content made visible to the next model call.
Do not record provider client instances or other runtime-only objects.

`iteration` is optional for user and system messages and required for model and
tool-loop messages. `turnId` associates all messages with a user turn without
making turn boundaries depend on array position.

#### `turn_event`

Persist terminal turn state and failures:

```json
{"timestamp":"2026-08-21T10:30:25.000Z","type":"turn_event","payload":{"turnId":"019c...","phase":"completed"}}
```

Supported phase values in version 1 are `started`, `completed`, `cancelled`,
and `failed`. A failed event includes a serialized error with `name`, `message`,
and optional stable Orbit `code`. Do not serialize arbitrary error objects or
stacks by default because they can contain machine-specific or sensitive data.

`model-started` and `tool-started` UI notifications do not need separate
durable entries in version 1 when the corresponding assistant tool call and
tool result are present. The persistence policy may retain them later for
fine-grained diagnostics. UI events must never be persisted merely because
they were emitted.

#### Reserved future entries

Reserve, but do not require in the first implementation:

- `session_info` for a user-visible title and other mutable metadata;
- `model_change` if model changes need an explicit event in addition to the
  next `turn_context`;
- `compaction` for a summary and the first retained message ID;
- `branch_summary` for context imported from an abandoned branch;
- `label` for an entry bookmark;
- `custom` for namespaced extension state;
- `world_state` for a controlled environment snapshot.

Unknown entry types must not be silently converted into messages. The loader
should either preserve safely skippable namespaced entries or reject an entry
that is required to reconstruct the active schema.

### Example file

```jsonl
{"timestamp":"2026-08-21T10:30:12.123Z","type":"session_meta","payload":{"version":1,"sessionId":"019c-session","cwd":"/work/orbit","originator":"orbit-interactive","orbitVersion":"0.1.0","provider":"openai","model":"gpt-5","systemPrompt":"Project instructions"}}
{"timestamp":"2026-08-21T10:30:20.000Z","type":"turn_context","payload":{"turnId":"019c-turn","cwd":"/work/orbit","provider":"openai","model":"gpt-5","maxToolIterations":5}}
{"timestamp":"2026-08-21T10:30:20.010Z","type":"turn_event","payload":{"turnId":"019c-turn","phase":"started"}}
{"timestamp":"2026-08-21T10:30:20.020Z","type":"message","payload":{"turnId":"019c-turn","message":{"id":"019c-user","parentid":null,"timestamp":"2026-08-21T10:30:20.019Z","type":"user","role":"user","contents":["Inspect the failing test."]}}}
{"timestamp":"2026-08-21T10:30:21.000Z","type":"message","payload":{"turnId":"019c-turn","iteration":0,"message":{"id":"019c-assistant","parentid":"019c-user","timestamp":"2026-08-21T10:30:20.999Z","type":"assistant","role":"assistant","contents":[],"payload":{"toolCalls":[{"id":"call-1","name":"read_file","input":{"path":"test.ts"}}]}}}}
{"timestamp":"2026-08-21T10:30:21.100Z","type":"message","payload":{"turnId":"019c-turn","iteration":0,"message":{"id":"019c-tool","parentid":"019c-assistant","timestamp":"2026-08-21T10:30:21.099Z","type":"tool","role":"assistant","contents":[],"payload":{"toolCallId":"call-1","name":"read_file","input":{"path":"test.ts"},"output":"...","isError":false}}}}
{"timestamp":"2026-08-21T10:30:25.000Z","type":"message","payload":{"turnId":"019c-turn","iteration":1,"message":{"id":"019c-final","parentid":"019c-tool","timestamp":"2026-08-21T10:30:24.999Z","type":"assistant","role":"assistant","contents":["The failure is caused by ..."]}}}
{"timestamp":"2026-08-21T10:30:25.010Z","type":"turn_event","payload":{"turnId":"019c-turn","phase":"completed"}}
```

This example is intentionally linear. Parent IDs should still be correct from
version 1 so adding branch selection does not require rewriting old files.

## Persistence policy

Define one policy function that decides which domain events become durable
entries. Version 1 should persist:

- session metadata;
- the effective context for every turn;
- system context actually passed to the model;
- user messages;
- every assistant message, including tool calls;
- every tool result made visible to the model, including errors;
- final turn completion, cancellation, or failure;
- future compaction records whenever compaction is introduced.

Version 1 should not persist:

- loading indicators, token deltas, and other replaceable UI state;
- logger objects, MCP clients, model clients, abort signals, or callbacks;
- API keys, authorization headers, provider settings containing secrets, or
  process environment variables;
- duplicate event and message representations of the same content;
- transient retry bookkeeping unless it changes model-visible history.

Tool inputs and results may themselves contain secrets. Persisting the exact
model-visible result is necessary for faithful resume, so Orbit must document
that local session files can contain sensitive workspace data. Add a
centralized redaction hook before general-purpose logging or export is added.
Directory and file permissions are required but are not a substitute for that
policy.

All durable values must pass a JSON-safe encoder. The encoder must reject or
explicitly transform `bigint`, circular objects, non-finite numbers, binary
data, and unsupported class instances. It must not silently convert a value to
`"[object Object]"`.

## Recorder behavior

Use one recorder per open session. Producers submit typed entries to the
recorder; they do not call `appendFile()` directly.

Required behavior is:

1. Create a new file exclusively so an existing session is never overwritten.
2. Write `session_meta` before accepting other entries.
3. Serialize appends through a promise queue or dedicated writer.
4. Preserve submission order across model and tool events.
5. append exactly one JSON object and one newline per entry.
6. surface write failures to the owning turn and stop accepting entries after
   a fatal recorder error;
7. flush at turn completion, cancellation, and failure;
8. flush and close during session or application shutdown;
9. make `close()` idempotent;
10. never allow asynchronous writes to continue after `close()` resolves.

The first implementation may use ordered asynchronous file appends rather than
a worker thread. Correct ordering, error propagation, and shutdown guarantees
matter more than background-write complexity at Orbit's current scale.

Within one process, opening the same session for writing twice must fail. For
multiple processes, use an explicit lock strategy or document that only one
writer may resume a session. Do not rely on `ThreadManager`'s one-active-run
rule because it does not cover separate Orbit processes.

## Load, validation, and recovery

Opening a session must:

1. read and validate the first non-empty line as `session_meta`;
2. reject unsupported future schema versions with a clear error;
3. parse subsequent lines with file and line-number diagnostics;
4. validate entry discriminators and payloads;
5. preserve original message IDs and timestamps;
6. reject duplicate message IDs;
7. validate parent references and tool call/result correlation where possible;
8. rebuild turn boundaries and the active linear history;
9. recognize an unfinished last turn and expose its state;
10. run explicit migrations for supported older versions before constructing
    the current domain model.

A process can be interrupted in the middle of the last append. The loader may
ignore one malformed, unterminated final line and report a recovery warning. A
malformed line in the middle of the file is corruption and must not be silently
skipped. The original file should remain untouched during recovery; an explicit
repair operation can copy valid entries to a new file later.

Constructors or factories must support hydration. Loading must never create new
message IDs or timestamps because doing so breaks parent links, tool
correlation, and stable GUI identity.

## Resume, fork, and listing

### Resume

Resume opens the same file and keeps the same session ID. It reconstructs the
active history and effective context, creates an agent bound to that session,
then appends new entries to the same recorder.

The context builder should use persisted model-visible messages, not UI event
text. If the last turn was cancelled or failed, its user message and any
completed tool activity remain inspectable. A product-level decision is needed
on whether a retry continues from that partial history or starts from the last
completed turn; the default should be the last consistent model-visible
history, with the choice made explicitly in code.

### Fork

Fork is a later feature but the format must support it. A fork creates a new
session ID and file, records its parent session, and copies or references one
selected history path. It must never append a new branch into the source file
unless Orbit separately implements Pi-style in-place branching.

### Listing and index

Initially, list date-sharded filenames newest first and read only their header
and minimal metadata. Return paginated summaries containing at least:

- session ID and file path;
- creation and update timestamps;
- working directory;
- provider and model;
- optional title;
- completion or interrupted status.

If scanning becomes expensive, add an append-only
`~/.orbit/session_index.jsonl` whose latest record wins for each session ID.
Treat it as a rebuildable cache, never as the only copy of session metadata.
Do not put shell input history in this index or in session files; use a separate
file if interactive input history is implemented.

## Integration changes

### `Message`

- Add a plain persisted-message type.
- Add explicit `toPersistedMessage()` and `fromPersistedMessage()` codecs.
- Permit trusted hydration with an existing ID and timestamp without exposing
  an unsafe general constructor.
- Decide and enforce linear parent assignment for messages appended in one
  batch.
- Validate payload variants for assistant tool calls and tool results.
- Add optional provider, model, usage, stop reason, and provider response ID
  metadata only when adapters can populate them consistently.

### `Session`

- Give the aggregate an explicit session ID and metadata independent of a
  message header.
- Store typed entries or enough state to generate them.
- append new messages exactly once and return the canonical stored objects.
- support hydration and active-history reconstruction.
- expose new-entry notifications to the recorder.
- keep persistence optional and injected so the reusable library can run
  entirely in memory.

### `Agent`

- Bind the agent to the caller's session instead of maintaining a hidden copy.
- Change invocation semantics so only new turn input is appended; the context
  builder should obtain prior history from the session.
- emit or append canonical assistant and tool messages before notifying UI
  listeners.
- record effective model context at the start of every turn.
- ensure recorder flush and owned MCP cleanup happen in `finally` paths.

### Interactive mode

- Create or resume one session when interactive mode starts.
- Keep one session-bound agent for the session when model switching permits,
  or explicitly recreate the agent while retaining the same session.
- derive rendered messages from the session projection.
- distinguish local command notices from model-visible messages; persist a
  command event only if it changes durable state.
- flush and close on `/exit`, Ctrl+C, normal unmount, and fatal error.
- later add `/new`, `/resume`, and session selection commands.

### `ThreadManager`

- replace `ManagedThread.messages` with a canonical session reference;
- use the thread ID as the session ID;
- add create and resume options that accept a repository and storage policy;
- return snapshots derived from persisted session messages;
- make `closeThread()` close resources without deleting persisted history;
- add a separate, explicit delete operation if deletion is required;
- keep one active turn per thread and one recorder writer per session;
- ensure emitted event message IDs are the same IDs written to disk.

### Application paths

- change `sessionsDir()` to satisfy `~/.orbit/sessions/` explicitly;
- allow an injected storage root for tests and embedding;
- keep workspace `.orbit/settings.json` discovery separate from the user data
  directory contract;
- add tests for `configureApp()` if custom app names should use
  `~/.<appName>/sessions/`.

## Implementation sequence

### Phase 1: Schema and codec

1. Define version 1 entry unions and persisted message types.
2. Implement strict encode/decode and JSON-safety checks.
3. Add hydration factories that preserve identity.
4. Fix and test message parent semantics.

### Phase 2: Repository and recorder

1. Implement storage paths, UUIDv7 naming, permissions, and date sharding.
2. Implement exclusive create, ordered append, flush, and idempotent close.
3. Implement open, validation, final-line recovery, and in-memory
   reconstruction.
4. Implement paginated listing by filename and header.

### Phase 3: Runtime integration

1. Make `Session` the canonical history used by `Agent`.
2. Connect agent and tool events to the persistence policy.
3. Integrate interactive mode and reliable shutdown.
4. Integrate `ThreadManager` create, resume, snapshot, and close behavior.
5. Remove duplicated history arrays and duplicated append paths.

### Phase 4: User operations

1. Add session list and resume APIs and CLI entry points.
2. Add new-session and explicit deletion/archive operations.
3. Add titles and a rebuildable lightweight index if listing performance
   requires it.
4. Add fork after linear resume is stable.

### Phase 5: Advanced history

1. Add compaction entries and context reconstruction.
2. Add in-place tree navigation only if the product needs it.
3. Add branch summaries, labels, and namespaced extension data.
4. Consider SQLite only for query/index performance, while retaining JSONL as
   a portable primary or exportable record.

## Test requirements

Use temporary directories, fake clocks, deterministic UUID providers, stub
models, and stub tools. At minimum, test:

- exact version 1 JSONL output for a message-only turn;
- assistant tool call and correlated successful/error tool result output;
- two turns without duplicated prior messages;
- strict ordering when tool completions occur concurrently;
- model switch reflected in the next `turn_context`;
- cancellation and model/tool failure terminal events;
- recorder failure propagation;
- close while writes are queued and repeated `close()` calls;
- resume preserving IDs, timestamps, payloads, and effective context;
- rejection of an invalid header, unsupported version, duplicate IDs, broken
  parent links, and malformed middle lines;
- recovery from one malformed final line;
- two writers attempting to open the same session;
- session listing order and pagination across date directories;
- interactive `/exit` and Ctrl+C flush behavior;
- `ThreadManager.closeThread()` retaining the JSONL file;
- no access to the real user storage directory in tests;
- no credential fields in representative persisted entries;
- public exports for every supported persistence API and type.

Run the full project validation after implementation:

```sh
npm run headers:check
npm run build
npm test
```

## Completion criteria

The initial persistence feature is complete when:

- interactive and GUI threads use one canonical session representation;
- every completed, cancelled, or failed turn produces a valid ordered JSONL
  record under the configured `~/.orbit/sessions/` root;
- a new process can resume that file without changing message identity and can
  send the same effective history to the selected model;
- tool calls and tool results remain correlated after resume;
- model changes and effective turn configuration are reconstructable;
- shutdown waits for pending writes and reports persistence failures;
- corrupted input produces explicit diagnostics and a truncated final line is
  recoverable;
- the format contains no credentials and has a documented sensitive-data
  policy;
- the tests above pass on supported Node.js versions and platforms.

Until these conditions hold, Orbit's existing `Session`, interactive history,
and `ThreadManager` should be described as in-memory runtime state, not as a
persisted or resumable session implementation.

### Implemented extension — 2026-09-09

[Budgeted Session Compaction](2026-09-08-budgeted-session-compaction.md) adds
optional managed input budgeting and transcript v2 checkpoints in
`2a33ed20e27a5a526d1923cad20890cc46185135`. Its separate implementation record
owns validation and open confirmation. This extension preserves this record's
original rationale and completed scope; it does not adopt all historical
future phases or replace canonical Session ownership.
