# Single-host durable event inbox

`EventStore` is a public, task-independent persistence API. Import it from
`@cybergarage/orbit` and supply an application-owned local JSON filename. It
requires no schedules, task runtime, model, provider, or broker.

```typescript
import {EventStore} from '@cybergarage/orbit'

const store = new EventStore('/absolute/application/events.json')
try {
  store.accept(
    {id: 'input-42', key: 'entity-7', source: 'application', type: 'input', payload: {value: 42}},
    'processor',
    (state) => {
      state.data.inputCursor = 42
    },
  )
  store.admit('processor', (event, state) => {
    const jobId = `job:${event.id}`
    state.data[jobId] = {eventId: event.id, status: 'queued'}
    return jobId
  })
} finally {
  store.close()
}
```

The callbacks only update transaction drafts. Execute jobs after admission has
returned, using application-owned business state and the existing RunSupervisor
when model/tool execution is involved. An inbox is not an operation permission.

## State and acknowledgement boundaries

An `InboxEvent` is an immutable fact with stable ID, source, type, payload, key
and key-local sequence. An `EventDelivery` is one consumer's pending,
acknowledged or cancelled admission state. A `JobReceipt` binds an event to the
application-owned job admitted by a consumer. None of these records represents
execution completion or outgoing delivery.

`accept()` persists a fact and consumer delivery atomically with its optional
application-state update. That update runs only for a new fact, not for duplicate
acceptance or registering another consumer. Duplicate IDs must have identical
contents. Multiple consumers retain independent delivery state.

`admit()` atomically writes admitted job/application state and acknowledges its
deliveries. A thrown callback discards the complete draft, including earlier
admissions in the same batch. Acknowledged and cancelled deliveries cannot be
reset by redelivery. `cancel()` affects only a pending consumer delivery.

Ordering applies within a consumer and event key, not across all events. Pending
deliveries are admitted in key-local sequence. Registering an older event after
that consumer has acknowledged a newer sequence for that key is rejected. To
backfill history, register the historical deliveries before calling `admit()`.
Earlier facts are not automatically subscribed to a late consumer.

`snapshot()` returns a detached view. `transact()` supports atomic application
updates and queue reducers in one file. All callbacks are synchronous and must
not dispatch effects, retain authority, or open nested writes. Retained draft
references cannot mutate committed state. Asynchronous callback returns, nested writes and closing during a
transaction are rejected. The standalone default state has `version: 1`,
`events`, `deliveries`, and application `data`; it contains no task records.

Applications needing a custom state shape pass `EventStoreOptions` with their
initial state, a validating `decode` callback and, when needed, a synchronous
state-only `recover` callback. The common store validates event/delivery
identity, monotone consumer progress and immutable retained history. The owner
must validate its own business state and explicitly support format migrations.

## Persistence and recovery

One owner holds an exclusive lock until `close()`. A failed release keeps the
store closed to writes; retry `close()` to finish cleanup. A retry never removes
a replacement owner's lock. Live owners are refused;
dead owners use the existing guarded PID-recovery protocol. A leftover recovery
guard or ambiguous owner requires manual inspection. Use local files, not
network shares or multiple machines.

Transactions clone state, validate, serialize canonical JSON, enforce a 16 MiB
bound, synchronize a same-directory temporary file, rename it atomically and
synchronize the directory where supported. A rename or subsequent synchronization
failure poisons the owner: no later writes are permitted until reopening and
inspecting persisted state. Corrupt files are rejected without recovery writes.
These are process-death guarantees on tested filesystems, not universal physical
power-loss guarantees. Windows directory synchronization remains unavailable.

Pending deliveries survive restart. Admission acknowledgement survives separately
from job execution. If an external operation happens and the process dies before
its result is recorded, the event store does not infer success, redispatch the
operation, or choose a retry policy. The business owner must retain uncertainty,
use RunSupervisor journal evidence where applicable, and require reconciliation
before repeating ambiguous mutating effects. A `recover` callback can mark
application-owned in-flight jobs unknown; it must never execute those jobs.

The store provides no worker concurrency, distributed leases, replicated broker,
workflow replay, outgoing delivery, or exactly-once external effects. History
archival and automatic downgrade are not implemented.

## Task compatibility

`DurableWorkStore` uses this same EventStore implementation with its task-format
decoder and recovery policy. Timer intake, schedule cursors, task admission and
consumer acknowledgement share one physical state file and transaction owner.
There is no second queue file or cross-store transaction. See
[Durable scheduled work](scheduled-work.md) for v1 migration, public snapshot
compatibility and task controls, and the
[ADR](adr/2026-11-14-durable-timer-inbox.md) for research and decisions.

Fixed format identifiers do not replace semantic validation. Required event
payloads, consumer progress and the default application-data structure validate
on writes and reopening. Independent unknown fields are preserved. See
[Internal formats](internal-formats.md) for alignment with the separate metadata
and historical-log compatibility work.

Application-owned jobs can use the public `selectReadyJob` helper inside an
EventStore transaction to claim a job and persist `JobSchedulingState` together.
This does not reorder event admission or reinterpret event payload fields as
execution priority. See [Job priority](job-priority.md) for the complete unfinished
candidate set, same-key blocking and fairness requirements.
