# Session records versus runtime logs in Codex, Pi, and Orbit

## Purpose

This investigation compares what Codex and Pi persist as session records with
what they emit as ordinary runtime or debug logs. It then evaluates Orbit's
current implementation and recommends a clearer content boundary, schema, and
retention policy.

The central finding is that a session record and a runtime log are different
data products:

- A **session record** is durable semantic state used to reconstruct, resume,
  branch, or inspect an agent conversation. It contains model-visible content
  and therefore carries high privacy and storage risk.
- A **runtime log** is an operational observation used to explain behavior and
  failures. It should contain typed lifecycle facts, correlation identifiers,
  timings, outcomes, and bounded error details without duplicating the full
  conversation by default.

Codex maintains this distinction explicitly. Pi has a rich session record but
only an on-demand global debug snapshot rather than a general runtime logging
system. Orbit now has separate transcript and log stores, but its runtime log
content still needs a stronger event contract and operational policy.

The external findings below were verified against the pinned source revisions
listed in [Sources](#sources) on 2026-08-25. Proposed Orbit changes are clearly
marked and are not descriptions of current behavior.

## Comparison summary

| Artifact                        | Primary purpose                           | Information stored                                                                                                                            | Session correlation                                              | Replay or resume          | Default sensitivity                                     |
| ------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------- | ------------------------------------------------------- |
| Codex rollout JSONL             | Canonical thread history                  | Session and turn context, user and assistant items, reasoning, tool calls and outputs, compaction, durable lifecycle markers                  | Intrinsic; one rollout belongs to a thread/session               | Yes                       | Very high                                               |
| Codex `history.jsonl`           | Prompt recall in the input UI             | `session_id`, Unix timestamp, and raw submitted text                                                                                          | Per entry                                                        | No; it is not the rollout | High                                                    |
| Codex structured/plaintext logs | Runtime diagnosis and feedback collection | Time, severity, target, rendered event body, source location, thread/process identity                                                         | Optional `thread_id`; otherwise process-scoped                   | No                        | Medium; can become high at verbose levels               |
| Codex OpenTelemetry events      | Aggregated operational telemetry          | Named events, common session/model metadata, durations, outcomes, usage, tool and sandbox decisions                                           | Conversation metadata                                            | No                        | Metadata by default; raw prompts are opt-in             |
| Pi session JSONL                | Conversation state and branching          | Full messages, thinking and model changes, tool results, token/cost usage, compaction and branch summaries, extension state, labels and names | Intrinsic; one file is one session tree                          | Yes                       | Very high                                               |
| Pi `pi-debug.log`               | Manual TUI diagnosis                      | Rendered terminal lines and current agent messages                                                                                            | No path partition; content happens to reflect the active session | No                        | Very high                                               |
| Orbit session transcript        | Conversation and turn reconstruction      | Session header, messages and payloads, turn context, turn lifecycle and errors                                                                | Intrinsic; one transcript is one session                         | Yes                       | Very high                                               |
| Orbit session log               | Operational and diagnostic display        | Level, message, fields, component, session/thread/run/iteration correlation                                                                   | Intrinsic file partition plus record fields                      | No                        | Metadata by default, but `Full` diagnostics can be high |

The repeated lesson is that session artifacts answer **what state must be
reconstructed**, while runtime logs answer **what happened operationally and
why**. A GUI log panel should display the second product and link to the first;
it should not render the transcript under a different name.

## Codex findings

### Session rollout content

Codex writes canonical session rollouts as JSONL under
`$CODEX_HOME/sessions/YYYY/MM/DD/`. The recorder states that rollouts are for
replay and later inspection. Each line carries a timestamp, an optional ordinal,
and a typed rollout item.

The persisted item union includes:

- session metadata such as session and thread IDs, ancestry, timestamp, working
  directory, originator, CLI version, model provider, base instructions,
  dynamic tools, capabilities, and history mode;
- model response items including user/assistant messages, agent messages,
  reasoning, local shell and function calls, tool-search calls and outputs,
  custom-tool calls and outputs, web-search calls, image generation, and
  compaction records;
- turn context including the turn ID, working directory, date and timezone,
  workspace roots, model and reasoning settings, sandbox and approval policies,
  permissions, network policy, and collaboration mode;
- compaction replacement history, world-state checkpoints, security risk scores,
  and inter-agent communication; and
- selected durable events such as turn start/completion/abort, token counts,
  goal updates, rollback, settings application, and completed turn items.

The persistence policy deliberately excludes transient events and redundant
representations. For example, raw response streaming events, warnings, several
tool completion notifications, environment connection events, and other
ephemeral UI/runtime messages are not always written to the rollout. This is
evidence that the rollout is a curated reconstruction format, not a dump of
every internal event.

Codex also has a separate global `$CODEX_HOME/history.jsonl`. Its entry schema is
only `session_id`, Unix timestamp, and submitted text. Its purpose is input
history, not session replay. The official configuration reference exposes
`history.persistence` and `history.max_bytes`. Calling this file a session log
would conflate a prompt-recall index with the canonical rollout.

### Runtime log content

Codex's structured local log database stores a different shape:

- timestamp seconds and nanoseconds;
- severity level and tracing target;
- a rendered feedback log body;
- module path, source file, and line;
- optional `thread_id`; and
- `process_uuid` for records that cannot be associated with a thread.

The tracing layer derives `thread_id` from an event or an enclosing span, so
deep components can inherit correlation instead of manually repeating it. The
store supports filtering by severity, time, module, file, thread IDs, text, and
cursor, and can include threadless process records.

This data is implementation-facing: transport failures, retries, subsystem
state, queue behavior, and source locations are useful here, while replayable
message bodies and turn-context snapshots belong in the rollout. The default
filter retains broad tracing coverage but reduces noisy transport and streaming
targets. Writes use a bounded queue, batches, and an explicit flush path.

The SQLite sink applies independent budgets to each thread and each threadless
process partition: 10 MiB or 1,000 rows, keeping the newest records, plus an
age-based cleanup policy of 10 days. This is an important difference from
session history: diagnostic value decays and should be bounded independently of
the conversation lifetime.

Codex can additionally write a human-readable `codex-tui.log` in the configured
`log_dir`. This is another rendering of runtime tracing, not a replay artifact.
The official configuration reference documents the log directory and the
plaintext-file behavior.

### Telemetry content is a third concern

Codex's OpenTelemetry path emits named operational events such as conversation
start, API request, SSE event, user prompt, tool decision/result, and sandbox
outcome. Common metadata includes conversation, model, originator, application,
terminal, and authentication-mode information; event-specific fields add
duration, result, usage, and failure classifications.

Raw prompt export is disabled unless `otel.log_user_prompt` is explicitly
enabled. This reinforces a useful policy boundary for Orbit: operational
metadata can be enabled by default, while raw user/model/tool content needs a
separate, conspicuous opt-in.

## Pi findings

### Session JSONL content

Pi stores each session under
`~/.pi/agent/sessions/--<encoded-working-directory>--/<timestamp>_<uuid>.jsonl`.
The first line identifies the session; subsequent entries form an append-only
tree through `id` and `parentId`, allowing branches to coexist in one file.

The session format stores substantially more than human-readable chat text:

- user content, assistant text and thinking, tool calls, tool results, image
  data, bash command/output records, and custom messages;
- provider, model, stop reason, errors, token usage, and cost on assistant
  messages;
- model and thinking-level changes;
- compaction summaries, branch summaries, and their usage;
- extension-owned durable state and extension-injected model context; and
- labels and session display-name changes.

Pi rebuilds the active LLM context by walking the selected branch and applying
compaction checkpoints. The file is therefore application state and model
context, not an operational log. Pi can also run with an in-memory session
manager, which is analogous to Orbit's separation between memory and file
implementations.

### Debug and console output

Pi does not currently expose a general structured runtime logger/store
comparable to Codex or Orbit. Its hidden `/debug` command overwrites the global
`~/.pi/agent/pi-debug.log` with:

- the current terminal dimensions;
- every rendered TUI line with visible width and ANSI content; and
- the current agent messages serialized as JSON Lines within the snapshot.

The file is created on demand, is not partitioned by session ID, has no severity
or stable event schema, and duplicates sensitive message content. Elsewhere Pi
uses direct `console.warn`, `console.error`, and stderr output for warnings,
fatal failures, timing diagnostics, and extension errors.

This facility is useful for reproducing rendering problems, but it cannot answer
questions such as "which model request failed in this session?" or "how long did
this tool call take?" without other evidence. Orbit should borrow Pi's
session-owned append-only persistence pattern, not its global overwrite-on-debug
logging behavior.

## Orbit's current content boundary

### Implemented foundation

Orbit now has two durable artifacts with distinct interfaces:

- `SessionRepository` persists the transcript under `~/.orbit/sessions/`.
  Version 1 entries contain the session header, messages, turn context, and turn
  lifecycle events.
- `SessionLogStore` persists normalized `LogRecord` values. The default
  `FileSessionLogStore` writes
  `~/.orbit/logs/<session-id>/events.jsonl`; `MemorySessionLogStore` supplies a
  bounded in-memory implementation.

A `LogRecord` contains a version, UUIDv7 ID, timestamp, level, message, arbitrary
structured fields, and optional component/session/thread/run/iteration
correlation. Agent and thread construction bind the final session ID. The GUI
queries and tails logs for the selected session. Shared deletion removes the log
partition before the transcript, preserving the transcript when log cleanup
fails.

Diagnostics are also separated into metadata and full data. Metadata capture is
the default, and the diagnostic adapter writes typed diagnostic events through
the session logger. Common credential-shaped field names are redacted before
storage, and file permissions are owner-only on POSIX systems.

These choices already improve on Pi's debug file and establish the storage and
lifecycle boundary recommended by the earlier session-scoped logging analysis.

### Remaining content problems

The current implementation still has five important gaps.

1. **The event contract is implicit.** `LogRecord.message` and `fields` can
   represent anything. Diagnostic event type is nested in fields rather than a
   first-class, queryable property. There is no documented stable catalog for
   lifecycle, model, tool, MCP, storage, or runtime events.
2. **Successful direct-agent runs are under-described at the default level.**
   Many agent iteration and tool observations are `debug`. GUI/application
   lifecycle events provide useful `info` records, but non-application-service
   flows can produce little or no successful-path log content unless debug is
   enabled.
3. **Correlation stops at the run/iteration level.** The schema lacks explicit
   turn, message, tool-call, provider-request, and parent-operation identifiers.
   Arbitrary fields can carry them, but consumers cannot rely on their names.
4. **Privacy control is incomplete.** Metadata capture is a sound default and
   common secret keys are redacted, but `Full` capture can persist prompts,
   workspace context, model output, and tool input/output. Key-name redaction
   cannot detect secrets embedded in strings, command lines, paths, or nested
   extension-defined values.
5. **File storage is unbounded and query cost grows linearly.** JSONL listing
   scans the partition, and there is no size, row, age, or rotation policy. A
   long-running session can therefore create an indefinitely growing file.

## Recommended Orbit target

### 1. Define three explicit products

Orbit should name and document these separately:

| Product                 | Owner                                   | Content rule                                                               | Retention rule                                |
| ----------------------- | --------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------- |
| Session transcript      | `SessionRepository`                     | Everything required to resume and reconstruct the conversation             | Session lifetime; deleted with the session    |
| Session diagnostics     | `SessionLogStore` session partition     | Curated operational metadata correlated to one session                     | Bounded independently by bytes, rows, and age |
| Application diagnostics | `SessionLogStore` application partition | Startup, configuration, discovery, storage, and failures without a session | Short, process/application-level retention    |

Telemetry should remain an optional exporter of selected diagnostic events, not
a fourth local source of truth. The transcript must never be reconstructed from
diagnostics, and the default diagnostic stream must not duplicate full
transcript content.

### 2. Make event identity and category first-class

Evolve `LogRecord` in a backward-compatible versioned schema with required
`eventType` and `category` fields:

```ts
interface LogRecordV2 {
  version: 2
  id: string
  timestamp: string
  level: LogLevel
  eventType: string
  category: 'lifecycle' | 'model' | 'tool' | 'mcp' | 'storage' | 'runtime' | 'security'
  message: string
  correlation: {
    sessionId?: string
    threadId?: string
    turnId?: string
    runId?: string
    iteration?: number
    messageId?: string
    toolCallId?: string
    requestId?: string
    parentOperationId?: string
  }
  outcome?: 'started' | 'succeeded' | 'failed' | 'cancelled' | 'denied'
  durationMs?: number
  usage?: {inputTokens?: number; outputTokens?: number; totalTokens?: number}
  component?: string
  fields: LogFields
}
```

Keep a human-readable message for terminals, but make filtering and GUI
rendering depend on stable fields rather than parsing prose. A migration reader
should continue accepting version 1 records.

### 3. Publish a minimum metadata-only event catalog

At `info`, every run should emit a small successful-path spine:

- `session.started`, `session.resumed`, and `session.closed`;
- `turn.started`, `turn.completed`, `turn.failed`, and `turn.cancelled`;
- `model.request.started`, `model.request.completed`, and
  `model.request.failed`, with provider/model, duration, outcome, retry count,
  response/request IDs when available, and token usage;
- `tool.call.started`, `tool.call.completed`, and `tool.call.failed`, with tool
  name, call ID, duration, and result size, but not arguments or output; and
- `mcp.connection.*` and `storage.*` events for failures and meaningful state
  transitions.

Per-chunk streaming, serialized requests/responses, tool arguments/results, and
internal iteration details belong at `debug` or `trace` and still require the
content-capture policy below. This provides useful default logs without Codex's
high-volume tracing breadth.

### 4. Separate verbosity from content capture

`LogLevel` answers how detailed an event is. `DiagnosticCapture` answers whether
sensitive payloads may be included. They must remain independent controls.

Recommended defaults:

- level `info`;
- capture `metadata`;
- no raw prompt, model response, reasoning, tool arguments/output, environment,
  or workspace context in session diagnostics; and
- explicit, time-bounded opt-in for full capture with a warning showing the
  destination and deletion procedure.

Add value-aware redaction for authorization schemes and known token patterns,
path-aware sanitization for provider/MCP structures, maximum string and stack
lengths, and allowlists for event-specific metadata. Redaction must run before
both memory and file stores so subscribers cannot observe unredacted values.

### 5. Add bounded storage and scalable cursors

Apply per-session and application-partition limits. A practical first policy is
10 MiB, 10,000 records, or 14 days per session, configurable at store
construction. Rotate JSONL segments and delete the oldest segments after a
successful append. The exact defaults are an open product decision; the
requirement is independent bounded retention rather than the particular Codex
numbers.

Replace record-ID scanning with an opaque cursor containing segment and byte
offset. Preserve newest-first bounded backfill for the GUI, then continue from
the returned cursor for live or incremental reads. If filtering and concurrent
session volume later exceed JSONL's useful range, add a SQLite store behind the
existing interface rather than changing producers.

### 6. Propagate correlation through execution context

Use a scoped context mechanism, such as `AsyncLocalStorage`, at thread/run,
model-request, and tool-call boundaries. Logger calls should inherit correlation
automatically while explicit child bindings remain available for library users.
This follows the useful Codex span behavior and prevents low-level adapters from
forgetting session or operation identifiers.

### 7. Make sink health observable

The bounded writer should track accepted, written, dropped, redacted, rotated,
and failed records. Emit one rate-limited stderr warning outside the store on
sink failure, expose counters through application diagnostics, and flush on
normal shutdown. Logging failure must not fail an agent run, while session
deletion must continue to fail if its log partition cannot be flushed or
removed.

## Suggested implementation order

1. Add an event catalog and a backward-compatible `LogRecordV2`; update GUI
   filters to use `eventType`, category, outcome, and correlation.
2. Emit the metadata-only `info` lifecycle spine from direct `Agent`, model,
   tool, and MCP boundaries. Add tests proving that every successful execution
   yields useful records with no raw content.
3. Centralize capture policy and value-aware redaction before the store and live
   subscribers.
4. Add file rotation, retention, opaque cursors, and sink-health counters.
5. Add optional telemetry export or a SQLite store only after the local contract
   and privacy boundary are stable.

## Required tests

- Transcript-only fields such as prompt text, reasoning, tool arguments, tool
  output, and workspace context are absent from metadata logs.
- Every successful CLI, interactive, resumed, and GUI run emits the same minimum
  lifecycle sequence with session, run/turn, request, and tool-call correlation.
- `Full` capture requires explicit opt-in, applies redaction, truncates oversized
  values, and never records provider or MCP credentials.
- Session and application partitions have independent retention budgets;
  rotation preserves cursor order and never affects another session.
- Restart, partial final lines, malformed records, queue saturation, and sink
  failures are deterministic and observable.
- Deleting a session removes both transcript and all rotated log segments; a log
  deletion failure preserves the transcript for retry.
- GUI backfill and live delivery deduplicate by record ID and never display
  records from an unselected session.

## Open decisions

- Choose default byte, row, and age limits based on measured Orbit workloads.
- Decide whether full-content diagnostics should be supported in production or
  only through a temporary support bundle.
- Decide whether application diagnostics need a separate GUI view or remain
  available only to CLI/support tooling.
- Define which usage and cost fields are provider-neutral and safe for the
  version 2 schema.

## Implementation status

As of 2026-08-25, Orbit implements the local recommendations in this document:
version 2 typed records with a version 1 reader, the metadata-only lifecycle
catalog, asynchronous correlation, value-aware redaction and size limits,
temporary Full capture, segmented retention and rotation, opaque cursors,
selected-session GUI filtering, sink-health counters, owner-only permissions,
and unified session/log deletion. Optional external telemetry export and an
alternative SQLite store remain future work.

## Sources

### Codex

- [Official Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference),
  including `log_dir`, `history.persistence`, `history.max_bytes`, and
  `otel.log_user_prompt`.
- [Codex revision inspected](https://github.com/openai/codex/tree/0d9bb6c34c2742ee8bcddfccb6404a447926ff9f).
- [Rollout recorder and location](https://github.com/openai/codex/blob/0d9bb6c34c2742ee8bcddfccb6404a447926ff9f/codex-rs/rollout/src/recorder.rs).
- [Rollout item types](https://github.com/openai/codex/blob/0d9bb6c34c2742ee8bcddfccb6404a447926ff9f/codex-rs/history/src/lib.rs).
- [Rollout persistence policy](https://github.com/openai/codex/blob/0d9bb6c34c2742ee8bcddfccb6404a447926ff9f/codex-rs/rollout/src/policy.rs).
- [Session metadata and turn context](https://github.com/openai/codex/blob/0d9bb6c34c2742ee8bcddfccb6404a447926ff9f/codex-rs/protocol/src/protocol.rs).
- [Global message-history schema](https://github.com/openai/codex/blob/0d9bb6c34c2742ee8bcddfccb6404a447926ff9f/codex-rs/message-history/src/lib.rs).
- [Structured log schema](https://github.com/openai/codex/blob/0d9bb6c34c2742ee8bcddfccb6404a447926ff9f/codex-rs/state/logs_migrations/0002_logs_feedback_log_body.sql).
- [Tracing-to-SQLite layer](https://github.com/openai/codex/blob/0d9bb6c34c2742ee8bcddfccb6404a447926ff9f/codex-rs/state/src/log_db.rs).
- [Log retention and queries](https://github.com/openai/codex/blob/0d9bb6c34c2742ee8bcddfccb6404a447926ff9f/codex-rs/state/src/runtime/logs.rs).
- [Session telemetry events](https://github.com/openai/codex/blob/0d9bb6c34c2742ee8bcddfccb6404a447926ff9f/codex-rs/otel/src/events/session_telemetry.rs).

### Pi

- [Pi revision inspected](https://github.com/earendil-works/pi/tree/dcd461925db2edf69a43c8135db1180d418afd54).
- [Session manager and entry types](https://github.com/earendil-works/pi/blob/dcd461925db2edf69a43c8135db1180d418afd54/packages/coding-agent/src/core/session-manager.ts).
- [Session file format](https://github.com/earendil-works/pi/blob/dcd461925db2edf69a43c8135db1180d418afd54/packages/coding-agent/docs/session-format.md).
- [Debug log path](https://github.com/earendil-works/pi/blob/dcd461925db2edf69a43c8135db1180d418afd54/packages/coding-agent/src/config.ts).
- [Debug command and snapshot content](https://github.com/earendil-works/pi/blob/dcd461925db2edf69a43c8135db1180d418afd54/packages/coding-agent/src/modes/interactive/interactive-mode.ts).
- [Development documentation for `/debug`](https://github.com/earendil-works/pi/blob/dcd461925db2edf69a43c8135db1180d418afd54/packages/coding-agent/docs/development.md).

### Orbit

- `src/core/session/entries.ts` and `src/core/session/repository.ts` for the
  current transcript format and lifecycle.
- `src/core/logs/` for the current record, store, memory, file, and logger
  implementations.
- `src/core/diagnostics/diagnostics.ts` and `src/core/models/diagnostics.ts` for
  capture policy and model-event metadata.
- `src/core/application.ts` and `src/apps/gui/` for session correlation, query,
  streaming, and selected-session display.
- `docs/analysis/2026-08-25-session-scoped-logging.md` for the prior architecture
  investigation and implemented foundation.
