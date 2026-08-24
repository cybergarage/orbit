# Session Logging

Orbit writes operational and diagnostic records to files by default. Each
session owns an append-only JSON Lines partition:

```text
~/.orbit/logs/<session-id>/events.jsonl
```

Files contain normalized versioned records with a UUIDv7 record ID, timestamp,
level, message, structured fields, and session correlation. Direct `Agent`
construction, interactive and resume commands, and GUI thread creation bind the
logger after the final session ID is known. `--debug` enables debug-level
records without changing the destination. Fields with common credential names,
including authorization, API key, password, secret, cookie, and access-token
keys, are replaced with `[REDACTED]` before storage.

The transcript under `~/.orbit/sessions/` and the log partition are independent
artifacts. Both GUI and CLI deletion remove logs before deleting the transcript.
If log cleanup fails, deletion fails and the transcript remains available for a
retry.

## Library interfaces

`Logger` remains the producer-facing interface. Storage, queries, live
subscriptions, flushing, and deletion use `SessionLogStore`:

```ts
import {MemorySessionLogStore, StoreSessionLoggerFactory} from 'orbit'

const logs = new MemorySessionLogStore({maxRecordsPerSession: 1000})
const loggers = new StoreSessionLoggerFactory(logs)
const logger = loggers.forSession(sessionId, {component: 'worker'})

logger.info({jobId}, 'job started')
const page = await logs.list(sessionId, {limit: 200, search: 'job'})
await logs.close()
```

Use `MemorySessionLogStore` for tests and bounded ephemeral integrations. Use
`FileSessionLogStore` for durable JSONL storage; its `rootDir` option overrides
the default location. A file store creates directories with mode `0700` and log
files with mode `0600` on platforms that support POSIX permissions.

`ThreadManager` accepts a `loggerFactory` and supplies a session-bound logger to
its agent factory. `OrbitApplicationService` owns a file store by default and
exposes `getSessionLogs()` and `subscribeLogs()` for GUI integrations.
