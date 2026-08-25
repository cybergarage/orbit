---
status: accepted
proposed-date: 2026-08-25
decision-date: null
implementation-status: completed
implementation-completed-date: 2026-08-25
implementation-commits:
  - "98c358b6e4787759680cb1174abb03585cdfc9dc"
superseded-by: []
---

# Session-scoped logging architecture

## Purpose

This document investigates the current Orbit, Codex, and Pi implementations and
proposes how Orbit should add durable logs that are:

- grouped and queried by Orbit session ID;
- written to files by default under the Orbit application directory;
- available through both memory and file-backed implementations;
- attached automatically when an agent is created;
- displayed for the selected session in the GUI's right pane; and
- deleted when the corresponding session is deleted.

The repository evidence and external implementation findings are verified
against the source revisions listed in [Sources](#sources). The initial design
described here was implemented on 2026-08-25 with JSONL and memory stores,
automatic session binding, selected-session GUI logs, and unified deletion.
Retention rotation and optional alternative stores remain follow-up work.

## Decision

Orbit will separate log emission from storage through a session-aware logger and
store contract, provide memory and per-session JSONL implementations, bind logs
automatically at agent construction, expose only the selected session's logs in
the GUI, and delete logs through the same lifecycle service as transcripts.

## Consequences

- Positive: CLI, interactive, resume, and GUI paths share one correlation,
  storage, query, and deletion contract while tests can use a memory store.
- Negative: asynchronous writes, flush and deletion ordering, sink failures,
  privacy, permissions, and retention require explicit lifecycle handling.
- Neutral: alternative SQLite storage and externally exported telemetry remain
  optional follow-up work behind the same interface.

## Implementation and Confirmation

The initial storage, binding, GUI, and deletion scope was implemented on
2026-08-25 by commit `98c358b6e4787759680cb1174abb03585cdfc9dc`.
Store-contract, agent, thread, application, GUI, and deletion tests confirm the
shared lifecycle behavior.

## Requested behavior and assumptions

The log output root is `~/.orbit`, consistent with Orbit's existing conventions:
sessions default to `~/.orbit/sessions/`, workspace settings use
`.orbit/settings.json`, and `DOT_APP_DIR_NAME` is derived from the application
name `orbit`. This proposal places session logs under `~/.orbit/logs/`.

In Orbit's current API, a GUI thread ID and its durable session ID are the same
UUIDv7. This proposal continues that invariant and uses the term **session ID**
for persisted data and **thread ID** only at GUI or thread-lifecycle boundaries.

Logs are operational and diagnostic records. They are not the session
transcript. The transcript remains the source for resume and model-context
assembly; deleting a session removes both independent artifacts.

## Executive recommendation

Keep the existing `Logger` interface as the producer-facing API, but do not make
it responsible for storage queries or deletion. Introduce a separate
`SessionLogStore` interface that owns normalized log records, backfill queries,
live subscriptions, flushing, closing, and deletion. Implement it first as:

1. `MemorySessionLogStore`, for tests, embedded use, and bounded ephemeral
   operation.
2. `FileSessionLogStore`, the default, writing one JSONL stream per session
   under `~/.orbit/logs/<session-id>/events.jsonl`.

Add a `SessionLoggerFactory` adapter that returns a `Logger` bound to a session
ID and backed by a `SessionLogStore`. Agent code continues to call
`logger.debug()`, `logger.info()`, and child loggers; the store remains available
to application and GUI layers for `list`, `subscribe`, and `delete`.

Use the existing application service as the lifecycle owner. It should create
the default file store, supply session-bound loggers when threads are created or
resumed, expose selected-session log queries, and close the store at shutdown.
Both GUI and CLI deletion must go through one `SessionDeletionService` so a
command cannot remove only the transcript and leave logs behind.

The resulting dependency direction is:

```text
Agent / model / MCP / tools
          |
          | Logger calls and child bindings
          v
  SessionLoggerFactory
          |
          | normalized LogRecord
          v
   SessionLogStore interface
      |              |
      v              v
  Memory store    File JSONL store
      |              |
      +------+-------+
             |
             v
  OrbitApplicationService
      |              |
      v              v
 REST backfill      SSE live records
             |
             v
  selected-session GUI pane
```

## Pre-implementation Orbit baseline

This section records the repository state observed during the investigation;
it is retained as historical evidence for the implemented design.

### Logging is partly abstracted already

`src/core/logger/logger.ts` defines a public `Logger` interface with the six
standard levels, child bindings, and a shared runtime debug toggle. `createLogger`
adapts Pino to that interface, and `createNoopLogger` supplies a no-op
implementation. Agent code depends on `Logger`, not directly on Pino. This is a
sound producer boundary and should be preserved.

The abstraction is incomplete for the requested feature:

- `Logger` can write, but cannot list, subscribe to, flush, close, or delete
  records.
- `Logger.child()` can add `sessionId`, but a Pino child cannot change the
  destination, so child bindings alone cannot route sessions to separate files.
- there is no production memory-backed logger implementation; logger tests use
  a test-only destination stream.
- `Agent` defaults to `createNoopLogger()` when no logger is supplied.
- CLI, interactive, resume, and GUI entry points explicitly create a Pino logger
  whose destination is `process.stderr`, so files are not the current default.

The answer to “is it abstracted today?” is therefore **yes for emitting log
messages, no for session-scoped storage and lifecycle operations**.

### Diagnostics already contain most correlation data

`DiagnosticEventBus` is a separate bounded in-memory event mechanism. Its
records already support `sessionId`, `threadId`, `runId`, `iteration`, level,
timestamp, type, a monotonically increasing process-local sequence, and typed
data. It retains at most 1,000 events by default and supports replay after a
sequence plus live subscriptions.

`OrbitApplicationService` converts thread events into diagnostic events and
`attachDiagnosticLogger()` forwards each event through `Logger`. This gives
Orbit two related but distinct channels today:

- operational calls made directly through `Logger`; and
- structured diagnostics emitted through `DiagnosticEventBus`, then duplicated
  into `Logger` as a serialized `diagnosticEvent` field.

The GUI's right pane renders the in-memory diagnostic buffer received through
Server-Sent Events. It currently shows all events in the process; selecting a
session changes the conversation but does not backfill or filter the diagnostics
pane to that session. Reloading the process also loses the pane contents.

The new log feature should not create a third independent record model. A
normalized `LogRecord` should be the durable/readable form. Diagnostic events can
be adapted into it while the diagnostic bus remains the control-plane event
stream used to refresh threads and sessions.

### Session lifecycle is already centralized for the GUI, but not the CLI

`SessionRepository` creates dated JSONL transcript paths beneath
`~/.orbit/sessions/` and rejects deletion while a session recorder is open.
`OrbitApplicationService.deleteSession()` closes a loaded thread and then calls
the repository deletion method. This is the correct place to extend GUI
deletion with log cleanup.

The `delete` CLI command calls `SessionRepository.delete()` directly. Adding log
cleanup only to `OrbitApplicationService` would therefore make GUI deletion
correct while CLI deletion leaked logs. A shared higher-level deletion service
is required.

### Agent construction is the correlation boundary

An `Agent` has a session before its logger is used: `AgentOptions.state` contains
the `Session`, and `Agent` already reads that session ID for diagnostic context.
`ThreadManager` also knows the final ID before invoking its `ThreadAgentFactory`.
These are the two safe injection points for a session-bound logger.

The default must be applied at agent construction, not on the first log call.
Otherwise startup records such as model selection and MCP initialization can be
uncorrelated or lost.

## Codex findings

The current Codex implementation has two logging paths that must not be
confused.

### Optional plaintext TUI log

The official Codex configuration reference says `log_dir` defaults to
`$CODEX_HOME/log`; explicitly setting it also enables the plaintext
`codex-tui.log`. The TUI implementation opens that file in append mode, uses
mode `0600` on Unix, writes without ANSI escapes, applies an environment-driven
filter, and uses a non-blocking tracing writer with a guard retained for flush
on shutdown.

This is useful evidence for permissions, append semantics, filtering, and
reliable shutdown, but it is a single process log rather than the strongest
model for the requested GUI feature.

### Default structured log database

The more relevant Codex app-server implementation installs a tracing layer that
persists records in `$CODEX_HOME/logs_2.sqlite`. The schema stores timestamp,
level, target, rendered body, source location, `thread_id`, `process_uuid`, and
an estimated byte count. Indexes cover chronological reads and per-thread
reads.

Correlation is automatic. The tracing layer extracts `thread_id` from an event
field or its enclosing span, so nested components do not need to repeat the ID
on every log call. Records without a thread are kept as process-scoped records.

Writes use a bounded background channel with batching and an explicit flush
operation. At the inspected revision, the queue capacity is 2,048 records,
batches contain up to 512 records, and the periodic flush interval is 10
seconds. No recursive SQLite logging is allowed into the same sink, and noisy
targets are filtered or capped at lower verbosity.

Codex enforces retention in the same transaction as insertion:

- 10 MiB or 1,000 rows per thread partition, keeping the newest records;
- equivalent independent budgets for threadless records per process UUID; and
- deletion of records older than 10 days during startup maintenance.

The query object supports levels, timestamps, module and file substrings,
multiple thread IDs, free-text search, inclusion of threadless records, an
`after_id` cursor, a result limit, and ascending or descending order. The
included `codex-state-logs` client demonstrates the GUI-relevant read pattern:
load a newest-first bounded backfill, reverse it for display, and then poll for
records with IDs greater than the last seen ID.

### Thread deletion removes logs as dependent state

Codex's `thread/delete` request first resolves the spawned thread subtree and
prepares loaded threads for deletion. The state runtime deletes log rows for
each thread ID before deleting thread rows and spawn edges. Tests deliberately
close the log database to force cleanup failure and verify that the thread and
retry graph remain discoverable. This ordering treats logs as dependent state:
if log cleanup cannot complete, the primary session remains available for a
retry.

This is directly applicable to Orbit. A deletion failure must not report that a
session is gone while its log cleanup is unknown.

### What Orbit should borrow from Codex

Orbit should borrow:

- automatic session-ID propagation at the construction or context boundary;
- one normalized structured record schema;
- bounded non-blocking writes with explicit flush;
- indexed/cursor-style reads rather than returning the entire log;
- separate treatment for records that have no session;
- retention limits;
- dependent-state deletion before deletion of the primary session artifact;
  and
- tests for failure ordering and retryability.

Orbit should not initially copy Codex's SQLite implementation. The requested
Orbit contract explicitly calls for memory and file output, and Orbit already
uses JSONL for session persistence. A storage interface allows SQLite to be
added later if query volume makes file scanning inadequate.

## Pi findings

### Per-session JSONL is a strong lifecycle pattern

Pi automatically persists each coding-agent session as JSONL under
`~/.pi/agent/sessions/`, grouped by working directory. The filename combines a
timestamp with a UUIDv7 session ID. Entries are append-only and the header
contains the session identity. This makes one file the durable boundary for one
session even though the session itself can contain an in-file branch tree.

The interactive session selector deletes the selected session file. It prevents
deletion of the currently active session, asks for confirmation, tries the
recoverable `trash` command first, and falls back to `unlink`. After success it
updates both cached session lists and refreshes the UI.

These choices support the Orbit proposal to keep per-session file ownership,
close the active writer before deletion, and refresh all projections after a
successful lifecycle operation.

### Pi's debug log is not a session logging architecture

Pi's regular debug facility is a hidden `/debug` command. It takes a snapshot of
the rendered TUI and current agent messages and overwrites
`~/.pi/agent/pi-debug.log`. The path helper is global, the command is manual,
and the output is not keyed by session ID. Pi also uses direct `console` and
`stderr` calls in several components rather than a shared logger abstraction.

Therefore Pi does not provide a reusable logger/store interface for this Orbit
feature. Its value here is the session-file and deletion lifecycle, not its
debug-log implementation.

### What Orbit should borrow from Pi

Orbit should borrow:

- a session-owned JSONL artifact;
- UUIDv7 session identity in the storage path and record header;
- append-only writes;
- explicit protection against deleting an active writer;
- confirmation and recoverable deletion in interactive UI where appropriate;
  and
- immediate refresh of in-memory session projections after deletion.

Orbit should not borrow Pi's single global debug file, overwrite-on-command
behavior, or direct console logging.

## Proposed Orbit design

### Separate emission from storage

The `Logger` interface remains small and synchronous so it is inexpensive to
use throughout models, tools, MCP, and agent code:

```ts
export interface Logger {
  child(bindings: LoggerBindings): Logger
  debug: LogMethod
  error: LogMethod
  fatal: LogMethod
  info: LogMethod
  isDebugEnabled(): boolean
  setDebugEnabled(enabled: boolean): void
  trace: LogMethod
  warn: LogMethod
}
```

Add a storage-facing interface with lifecycle and query operations:

```ts
export interface SessionLogStore {
  append(record: LogRecord): void
  closeSession(sessionId: string): Promise<void>
  deleteSession(sessionId: string): Promise<boolean>
  flush(sessionId?: string): Promise<void>
  list(sessionId: string, query?: LogQuery): Promise<LogPage>
  subscribe(handler: LogRecordHandler): () => void
  close(): Promise<void>
}
```

`append()` intentionally returns `void`, matching the current logger methods.
The file implementation queues writes per session and reports sink failures
through an injected error handler that must not write back into the same store.
It must also retain the first pending sink failure so the next `flush()`,
`closeSession()`, or `deleteSession()` rejects. `flush()` provides the durability
barrier needed by close and delete paths.

The factory bridges the two interfaces:

```ts
export interface SessionLoggerFactory {
  forSession(sessionId: string, bindings?: LoggerBindings): Logger
  forApplication(bindings?: LoggerBindings): Logger
}
```

`forSession()` adds both `sessionId` and `threadId` bindings while routing to the
session partition. `forApplication()` produces records without a session ID for
startup failures and other process-wide activity. The GUI should show only the
selected session partition by default; a future “Application” filter may expose
threadless records.

### Canonical record schema

Persist a stable Orbit-owned schema rather than Pino's internal shape:

```ts
export interface LogRecord {
  version: 1
  id: string
  timestamp: string
  level: LogLevel
  message: string
  fields: LogFields
  sessionId?: string
  threadId?: string
  runId?: string
  iteration?: number
  component?: string
}
```

`id` should be UUIDv7 so records have a stable merge/deduplication identity and
rough time ordering across backfill and live delivery. `timestamp` remains
RFC3339 for human readability. Common correlation fields are promoted to the
top level; provider-specific and event-specific values stay under `fields`.

Errors must be converted to plain serializable objects. Undefined values should
be omitted. Circular objects, streams, request clients, and arbitrary class
instances must never be passed to JSON serialization without normalization.

Version the record independently from the session transcript. Log readers
should reject an unsupported major version with a per-file error while still
allowing other sessions to load.

### Default file layout

Use the existing application path helper pattern:

```text
~/.orbit/
  sessions/
    2026/08/25/session-<timestamp>-<session-id>.jsonl
  logs/
    <session-id>/
      events.jsonl
```

A session directory makes lookup and deletion independent of session creation
date and leaves room for bounded rotation later. It also avoids rewriting one
global file when a session is deleted. Orbit generates UUIDv7 IDs by default but
currently permits callers to supply an ID. The path layer must therefore reject
path separators and unsafe identifiers, or encode the opaque ID into a safe
directory key. Resolve the final path and verify that it remains inside the
configured log root to prevent path traversal.

Create directories with owner-only permissions where supported and create log
files with mode `0600` on Unix. Open `events.jsonl` in append mode. Each record
must be written as one JSON object followed by one newline.

The first implementation may keep one `events.jsonl` file, but it should ship
with a configured per-session byte/row bound rather than unbounded retention.
The preferred follow-up is rotated JSONL segments inside the same session
directory. Codex's current limits—10 MiB, 1,000 rows, and 10 days—are useful
starting values, not requirements; Orbit should select and document its own
defaults after testing realistic tool-output volume.

### Memory implementation

`MemorySessionLogStore` should keep a `Map<string, LogRecord[]>` plus a separate
bounded application partition. It should implement the same query ordering,
limit, filters, deletion, and subscription semantics as the file store.

Tests should use the memory store instead of constructing fake Pino destination
streams when they need to assert session routing or lifecycle behavior. A
configurable maximum per partition keeps embedded use bounded and makes
retention tests deterministic.

### File implementation

`FileSessionLogStore` should own a writer state per open session:

```ts
interface SessionWriterState {
  file: string
  pending: Promise<void>
  closed: boolean
}
```

Appending chains one write onto `pending`, preserving record order without
blocking agent execution. `flush(sessionId)` waits for that chain.
`closeSession(sessionId)` marks the writer closed, waits for pending writes, and
releases it; a later resume may open the same partition again. `deleteSession()`
must first tombstone the session ID inside the store, then flush, close, and
remove its files. New appends to a tombstoned partition must fail through the
sink error handler rather than silently recreating a file during deletion.

The reader should stream JSONL and return a bounded page. Do not use
`readFile()` for an unbounded file. `LogQuery` should initially support:

```ts
export interface LogQuery {
  after?: string
  levels?: LogLevel[]
  limit?: number
  search?: string
}

export interface LogPage {
  data: LogRecord[]
  next?: string
}
```

The cursor is opaque to callers. A file implementation may encode byte offset
plus file identity; a memory implementation may encode record position. API
tests, not clients, should depend on its representation. Cap both row count and
serialized response bytes to keep the GUI endpoint bounded.

### Agent and entry-point wiring

Add `logStore` and/or `loggerFactory` dependencies to the application and thread
construction boundaries. The recommended order is:

1. Resolve or create the `Session`.
2. Read its final session ID.
3. Obtain `loggerFactory.forSession(sessionId)`.
4. Construct the `Agent` with that logger.
5. Emit model, MCP, and run startup records.

`ThreadManager` should accept a `SessionLoggerFactory` so custom
`ThreadAgentFactory` implementations receive `AgentOptions.logger` already
bound to the resolved session. This avoids requiring every GUI integration to
rediscover the session ID from `AgentOptions.state`.

Direct `new Agent()` remains an important boundary. To satisfy “configured by
default when the agent starts,” an agent with no explicit logger must create an
owned default file-backed logging context for its generated session ID. Tests
and embedders can inject `MemorySessionLogStore` or `createNoopLogger()`.
`Agent.close()` must close only a logger/store it owns; shared application stores
are closed by `OrbitApplicationService`.

Update all first-party entry points:

| Entry point | Session source | Required logging behavior |
| --- | --- | --- |
| `exec` | Agent-created ephemeral session | Create a session-ID log file even though no resumable transcript exists. |
| interactive | `SessionRepository.create()` | Bind file logger before rendering and agent initialization. |
| `resume` | Opened durable session | Append to the existing session log partition. |
| GUI | `ThreadManager` create/resume | Bind per-thread logger and expose store to application APIs. |
| embedded `Agent` | Supplied or generated `State` session | Default to file unless caller supplies another logger/store. |

The current `--debug` flag should control the minimum persisted level, not force
stderr to remain the primary destination. A later explicit console option may
tee records to stderr. Standard output must remain reserved for command results
and machine-readable modes.

### Diagnostics integration

Keep `DiagnosticEventBus` because it drives GUI refresh and carries typed
lifecycle events. Replace the current “serialize the entire event into a Pino
field” adapter with a normalized adapter:

```text
DiagnosticEvent -> LogRecord
  type           -> message or fields.eventType
  level          -> level
  timestamp      -> timestamp
  sessionId      -> sessionId/threadId partition
  runId          -> runId
  iteration      -> iteration
  data           -> fields
```

Avoid double writes. A diagnostic event should be persisted once, while direct
logger calls continue to capture operational messages that have no diagnostic
counterpart.

Persist metadata by default. The current GUI Full capture can include prompts,
workspace context, model output, and tool input/output. Automatically writing
that data to disk materially increases privacy and disk-usage risk. Either make
metadata capture the default when durable logging is enabled or add a distinct
`persistFullDiagnostics` opt-in. API keys, authorization headers, provider
credentials, MCP environment values, and known secret fields must always be
redacted regardless of capture mode.

### GUI API and selected-session behavior

Add a bounded backfill endpoint:

```http
GET /api/sessions/:sessionId/logs?limit=200&after=<opaque>&level=debug
```

Validate the session ID and query with Zod. Return `404` for an unknown session,
not an empty result that hides an invalid selection. Return per-file parse errors
as an explicit error response while leaving the session list usable.

Extend the existing SSE transport with `event: log` records. On session
selection, the client should:

1. clear logs from the previously selected session;
2. request a bounded newest backfill for the new session;
3. subscribe or filter the existing SSE connection to records whose
   `sessionId` equals the selected session ID;
4. deduplicate backfill and live records by `LogRecord.id`; and
5. keep a bounded client-side list.

The right panel should not show logs from every session in the process. Its
title should identify the selected session, and the empty state should say that
no session is selected or no logs exist. Level and text filters can be evaluated
server-side for backfill and client-side for the bounded live buffer.

The diagnostics capture selector currently changes global collection. Do not
present that global setting as if it affects only the selected session. Rename
the pane to “Logs” and move capture configuration to a clearly global control,
or keep a separate “Diagnostics” tab with an explicit application-wide label.

### Deletion semantics

Introduce one high-level deletion service used by both
`OrbitApplicationService.deleteSession()` and the CLI delete command:

```ts
export class SessionDeletionService {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly logs: SessionLogStore,
    private readonly threads?: ThreadManager,
  ) {}

  async delete(sessionId: string): Promise<SessionSummary | undefined>
}
```

The operation should be idempotent and ordered as follows:

1. Validate and find the session.
2. Cancel any active run and close the loaded thread.
3. Call `logs.deleteSession(sessionId)`. Inside the store, atomically tombstone
   the partition against new appends, flush accepted records, close its writer,
   and delete its files.
4. Confirm that the log partition deletion succeeded.
5. Delete the transcript through `SessionRepository`.
6. Clear display caches and publish `session.deleted` only after both deletes
   succeed.

An absent log partition is a successful no-op so sessions created before this
feature, or sessions using a no-op logger, remain deletable. I/O, parse, flush,
and permission failures are errors.

This follows Codex's dependent-state-first rule. If step 4 fails, the transcript
still exists and the operation is retryable. If step 5 fails after logs were
removed, the transcript remains visible and retry is still safe, although its
prior logs are gone. If stronger all-or-nothing semantics become necessary,
stage both artifacts by renaming them into a trash area under `~/.orbit` before
physical deletion and roll back the first rename when the second fails.

Do not emit the successful `session.deleted` event into the partition after it
has been deleted; that would recreate the log file. Emit it as an application
record without `sessionId`, or notify GUI clients only through the diagnostic
control stream.

When deletion succeeds, the GUI must clear the selected conversation and log
panel, remove the session from Recent, and ignore any late SSE record carrying
the deleted session ID.

### Failure handling

Logging must not crash an otherwise successful model run, but failures must not
be completely silent. Inject a minimal sink-error reporter whose default writes
one concise message to stderr. Rate-limit repeated errors and never route the
reporter back through `SessionLogStore`.

Deletion is different: failure to flush, close, or delete logs is a lifecycle
failure and must fail the session deletion operation. The GUI and CLI should
show the error and keep the session visible for retry.

On startup, a malformed JSONL line should affect only that session's log query.
The file implementation may recover from an incomplete final line caused by a
crash, but it must not silently skip malformed complete lines in the middle of a
file.

## Proposed implementation locations

Keep reusable behavior in `src/core/`:

```text
src/core/
  app.ts                         add logsDir()
  logger/
    logger.ts                    preserve Logger; normalize Error fields
    session-logger.ts            SessionLoggerFactory adapter
  logs/
    index.ts                     public exports
    records.ts                   LogRecord and query types
    store.ts                     SessionLogStore interface
    memory-store.ts              MemorySessionLogStore
    file-store.ts                FileSessionLogStore
  session/
    deletion-service.ts          transcript + log lifecycle orchestration
  thread.ts                      inject logger factory after ID resolution
  application.ts                 own store, query logs, delete through service
```

Keep transport and rendering in application layers:

```text
src/apps/
  cli/
    exec.ts                      default file store wiring
    _interactive.ts              default file store wiring
    resume.ts                    resume same partition
    delete.ts                    use SessionDeletionService
  gui/
    server.ts                    bounded log endpoint and SSE log events
    client.tsx                   selected-session backfill and filtering
```

Export new public interfaces and concrete stores deliberately from
`src/core/index.ts` and `src/index.ts`, with export tests if the repository's
public export coverage requires them.

## Testing strategy

### Store contract tests

Run the same behavior suite against memory and file stores:

- append and read records in stable order;
- isolate records with different session IDs;
- preserve child bindings and correlation fields;
- filter by level and text;
- enforce result and retention bounds;
- resume appending after store restart;
- flush accepted records;
- notify subscribers once per record;
- delete one partition without changing another;
- reject path traversal and invalid session IDs;
- use owner-only permissions on Unix; and
- surface a malformed middle line while tolerating an incomplete final line if
  that recovery policy is adopted.

### Agent and thread tests

- an agent with no explicit logger receives a session-bound default logger;
- an injected memory or no-op logger overrides the default without filesystem
  writes;
- new and resumed threads use the same session ID partition;
- independent threads do not mix records;
- early model/MCP startup records include the session ID;
- debug toggling affects a session logger and its children consistently; and
- application shutdown flushes all pending writers.

### GUI tests

- selecting a session requests only that session's backfill;
- live records for other sessions do not appear;
- backfill/live races deduplicate by record ID;
- selecting another session clears the previous panel;
- deleting the selected session clears both panes;
- reconnect replays a bounded result without duplication; and
- unknown sessions and malformed logs return bounded, safe errors.

### Deletion tests

- GUI and CLI deletion both remove transcript and logs;
- an active run is cancelled and writers are closed before deletion;
- log deletion failure preserves the transcript and does not emit success;
- transcript deletion failure remains retryable;
- repeated deletion is idempotent at the service boundary;
- no late append recreates a deleted partition; and
- deleting session A never removes session B logs.

Use temporary roots for every filesystem test. No test should read or write the
developer's real `~/.orbit` directory.

## Rollout plan

### Phase 1: storage contract and implementations

Add `LogRecord`, `SessionLogStore`, memory/file implementations, path helpers,
permissions, bounded reads, flush/close behavior, and contract tests. Keep the
existing CLI logger wiring during this phase to avoid a half-migrated default.

### Phase 2: automatic agent wiring

Add `SessionLoggerFactory`, bind it at agent/thread construction, migrate direct
logger and diagnostic-event persistence to the normalized store, and make the
file store the first-party default. Update all entry points together so behavior
does not differ between exec, interactive, resume, and GUI.

### Phase 3: GUI selected-session logs

Add backfill and live transport, replace the all-process diagnostics list with a
selected-session log projection, retain bounded client state, and clarify global
capture settings.

### Phase 4: unified deletion

Add `SessionDeletionService`, route GUI and CLI deletion through it, and add
failure-order tests before documenting the cleanup guarantee.

### Phase 5: retention and operational hardening

Measure log volume, finalize rotation and age limits, add redaction tests,
rate-limit sink errors, and consider a SQLite store only if JSONL query cost or
multi-process access becomes a demonstrated problem.

## Decisions to confirm before implementation

1. Decide whether Full diagnostic payloads may ever be persisted, or must remain
   memory-only.
2. Decide whether `exec` sessions without resumable transcripts should retain
   log files and for how long.
3. Select initial per-session row, byte, and age limits.
4. Decide whether GUI deletion should be permanently destructive or use a
   recoverable trash staging area.

None of these decisions changes the recommended interface boundary. They affect
the default file policy and deletion implementation details.

## Sources

### Orbit repository evidence

- `src/core/logger/logger.ts`: current `Logger`, Pino adapter, no-op adapter, and
  debug-level controller.
- `src/core/diagnostics/diagnostics.ts`: bounded memory events, session/run
  correlation, replay, subscription, and logger forwarding.
- `src/core/agent.ts`: no-op logger default and existing session-aware diagnostic
  context.
- `src/core/thread.ts`: session/thread ID creation, agent factory boundary, run
  lifecycle, and resume behavior.
- `src/core/application.ts`: GUI application ownership, diagnostics, thread
  creation, and GUI session deletion.
- `src/core/session/repository.ts` and `src/core/session/paths.ts`: transcript
  layout, open-writer guard, and deletion.
- `src/apps/gui/server.ts` and `src/apps/gui/client.tsx`: current SSE transport and
  all-process diagnostics pane.
- `src/apps/cli/exec.ts`, `src/apps/cli/_interactive.ts`,
  `src/apps/cli/resume.ts`, and `src/apps/cli/gui.ts`: current stderr logger
  defaults.
- `src/apps/cli/delete.ts`: direct repository deletion that must be migrated to
  the shared lifecycle service.

### Codex

- [Official Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
  for `log_dir` and `history.persistence` behavior.
- [Codex source revision inspected](https://github.com/openai/codex/tree/a25e986323931ec54909b0cd936b612f30c8ce46),
  commit `a25e986323931ec54909b0cd936b612f30c8ce46` from 2026-08-24.
- [SQLite tracing layer](https://github.com/openai/codex/blob/a25e986323931ec54909b0cd936b612f30c8ce46/codex-rs/state/src/log_db.rs).
- [Log schema migration](https://github.com/openai/codex/blob/a25e986323931ec54909b0cd936b612f30c8ce46/codex-rs/state/logs_migrations/0002_logs_feedback_log_body.sql).
- [Retention and query implementation](https://github.com/openai/codex/blob/a25e986323931ec54909b0cd936b612f30c8ce46/codex-rs/state/src/runtime/logs.rs).
- [Thread state deletion](https://github.com/openai/codex/blob/a25e986323931ec54909b0cd936b612f30c8ce46/codex-rs/state/src/runtime/threads.rs).
- [App-server thread deletion](https://github.com/openai/codex/blob/a25e986323931ec54909b0cd936b612f30c8ce46/codex-rs/app-server/src/request_processors/thread_delete.rs).
- [Log tail/query client](https://github.com/openai/codex/blob/a25e986323931ec54909b0cd936b612f30c8ce46/codex-rs/cli/src/bin/logs_client.rs).
- [Optional plaintext TUI log setup](https://github.com/openai/codex/blob/a25e986323931ec54909b0cd936b612f30c8ce46/codex-rs/tui/src/startup_orchestration.rs).

### Pi

- [Pi source revision inspected](https://github.com/earendil-works/pi/tree/dcd461925db2edf69a43c8135db1180d418afd54),
  `@earendil-works/pi-coding-agent` 0.84.3, commit
  `dcd461925db2edf69a43c8135db1180d418afd54` from 2026-08-24.
- [Session manager](https://github.com/earendil-works/pi/blob/dcd461925db2edf69a43c8135db1180d418afd54/packages/coding-agent/src/core/session-manager.ts).
- [Session file format and deletion documentation](https://github.com/earendil-works/pi/blob/dcd461925db2edf69a43c8135db1180d418afd54/packages/coding-agent/docs/session-format.md).
- [Interactive session deletion](https://github.com/earendil-works/pi/blob/dcd461925db2edf69a43c8135db1180d418afd54/packages/coding-agent/src/modes/interactive/components/session-selector.ts).
- [Global debug-log path](https://github.com/earendil-works/pi/blob/dcd461925db2edf69a43c8135db1180d418afd54/packages/coding-agent/src/config.ts).
- [Manual debug snapshot](https://github.com/earendil-works/pi/blob/dcd461925db2edf69a43c8135db1180d418afd54/packages/coding-agent/src/modes/interactive/interactive-mode.ts).
