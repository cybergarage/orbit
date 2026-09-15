# Session Logging

Orbit keeps the durable session transcript and operational logs as separate
artifacts. The transcript under `~/.orbit/sessions/` contains the conversation
state required for resume. Logs explain runtime behavior without duplicating
prompts, model responses, reasoning, tool arguments, or tool output by default.

Each session owns a JSON Lines partition under:

```text
~/.orbit/logs/<session-id>/
```

`events.jsonl` is the active segment. Older segments use
`events-<timestamp>-<sequence>.jsonl`. Set `ORBIT_LOG_DIR` to override the log
root for an isolated runtime or test; normal execution defaults to
`~/.orbit/logs`.

Direct `Agent` construction, interactive and resume commands, and GUI thread
creation bind the logger after the final session ID is known. `--debug` adds
debug-level records without changing the destination.

## Record format

New records use the version 2 schema:

```ts
interface LogRecord {
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
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
  }
  component?: string
  fields: LogFields
}
```

The file reader upgrades version 1 records in memory, so existing partitions
remain queryable. New writes always use version 2.

The default metadata event catalog includes session, turn, model-request,
tool-call, and MCP-connection lifecycle events. Successful runs therefore have
an `info`-level operational spine even when debug logging is disabled. Stable
`eventType`, `category`, `outcome`, duration, usage, and correlation fields
are intended for filtering; `message` remains a human-readable description.

Correlation is propagated through asynchronous turn and tool execution context,
so nested logger calls inherit the current session, turn, iteration, and tool
call IDs.

## Content capture and redaction

Diagnostic capture and log level are independent:

- **Metadata** is the default. It records event identity, correlation, timing,
  model/provider, usage, sizes, stop reasons, and bounded errors.
- **Full** temporarily includes request, response, context, and tool payloads.
  It automatically returns to Metadata after 15 minutes. Enabling it writes a
  warning containing the log destination.
- **Off** disables diagnostic-event capture. Direct operational logger calls
  continue to follow their configured level.

Full capture can contain source text, prompts, model output, commands, and tool
data. Use it only for local diagnosis and review files before sharing them.

Before a record reaches either a store or a live log subscriber, Orbit:

- redacts authorization, cookie, environment, API-key, password, secret, and
  token fields;
- recognizes common bearer/basic authorization and provider-token patterns
  embedded in strings;
- limits ordinary strings to 4 KiB and stacks to 16 KiB;
- limits object nesting and large arrays; and
- normalizes errors and non-JSON values.

Redaction is defense in depth, not a guarantee that arbitrary user-defined
payloads contain no sensitive information.

## Retention and rotation

`FileSessionLogStore` applies independent limits to each session and to the
application partition. Defaults are:

- 10 MiB per partition;
- 10,000 records per partition;
- 14 days maximum age;
- 1 MiB active segments before rotation; and
- 2,048 pending records before new records are dropped.

The newest record is retained even if one normalized record exceeds the byte
budget. Configure the limits with `maxBytesPerSession`,
`maxRecordsPerSession`, `maxAgeMs`, and `maxSegmentBytes`.
Use `maxPendingRecords` to change the bounded asynchronous write queue.

Queries return a bounded newest backfill when `after` is omitted. The `next`
value is an opaque cursor containing the segment position and record identity;
pass it as `after` for incremental reads. Legacy record IDs are accepted as
`after` values for compatibility.

Both GUI and CLI deletion remove every log segment before deleting the
transcript. If log cleanup fails, deletion fails and the transcript remains
available for retry.

## Library interfaces

`Logger` remains the producer-facing interface. Storage, queries, live
subscriptions, flushing, health, and deletion use `SessionLogStore`:

```ts
import {LogCategory, LogEventType, LogOutcome, MemorySessionLogStore, StoreSessionLoggerFactory} from '@cybergarage/orbit'

const logs = new MemorySessionLogStore({maxRecordsPerSession: 1000})
const loggers = new StoreSessionLoggerFactory(logs)
const logger = loggers.forSession(sessionId, {component: 'worker'})

logger.info(
  {
    eventType: LogEventType.ToolCallCompleted,
    outcome: LogOutcome.Succeeded,
    toolCallId,
  },
  'tool call completed',
)

const page = await logs.list(sessionId, {
  categories: [LogCategory.Tool],
  limit: 200,
  outcomes: [LogOutcome.Succeeded],
})
const health = logs.getHealth()
await logs.close()
```

`getHealth()` reports accepted, written, dropped, failed, redacted, and rotated
record counts. Store errors are reported outside the log sink and repeated
messages are rate-limited. A normal agent run does not fail because its
operational log could not be written; explicit flush and session deletion still
surface failures.

Use `MemorySessionLogStore` for tests and bounded ephemeral integrations. Use
`FileSessionLogStore` for durable segmented JSONL. File stores create
directories with mode `0700` and files with mode `0600` where POSIX
permissions are supported.

`ThreadManager` accepts a `loggerFactory` and supplies a session-bound logger
to its agent factory. `OrbitApplicationService` owns a file store by default
and exposes `getSessionLogs()`, `subscribeLogs()`, and `getLogHealth()` for
GUI integrations.

## Required execution evidence

Optional diagnostic/log writes do not authorize execution. Managed Agent runs
use a separate [execution journal](execution.md#recording-and-recovery) with
acknowledged admission, intent, result and terminal barriers. A failed observer
cannot turn required recording into success; `RunResult.recording` reports
required-store failure separately from known effects. Custom logger exceptions
are isolated and counted by `Agent.getObserverFailureCount()`. Borrowed log stores
remain caller-owned. Session deletion includes journal/key and a retained minimal
marker in addition to the transcript and optional log partition.
