# Durable scheduled work

Import DurableWorkStore from @cybergarage/orbit. Supply an app-owned local state filename. One writer owns the file until close(); another live writer is refused. Dead owners can be recovered; a leftover recovery guard requires manual inspection. Do not use network shares. Corrupt state is preserved and rejected.

Persist a schedule with a next timestamp, optional interval (at least 1000 ms), payload and effect read or opaque. materialize(now) coalesces missed fixed intervals to the latest due time and uses two durable boundaries: accept the timer event together with its next cursor, then atomically queue its occurrence and acknowledge consumer delivery. Recovery between these boundaries admits the pending event once without advancing its cursor again. One-shot schedules pause when their timer event is accepted. Calendar/DST/timezone recurrence is not implemented.

Each queued occurrence owns one stable run/request ID. claim() records a distinct attempt before dispatch. finish() requires the current live attempt and commits one bounded result; cancellation prevents a stale finish. enqueue() binds an explicit retry ID to canonical payload, effect and approval preview and rejects conflicting retries. Persistent approval changes a run from approval to queued or cancelled.

On reopening, interrupted read runs return to queued; opaque runs become unknown. Read execution may happen more than once after a crash, while one result remains visible. Unknown effects never replay automatically. Reconciliation requires confirmation that external execution stopped; the minimal reconciliation API closes the run as failed with owner-supplied evidence. It does not prove external success. Existing RunSupervisor operation journals remain the authority for model/tool execution; this store's attempts describe host dispatch, not tool intents.

Only finish() of an approved successful run may atomically apply an app-data patch alongside its result. Hosts must validate that payload and patch before invoking it. setData() is a host storage API, not an operation permission grant. State is capped at 16 MiB and results at 100,000 characters; archival is not automated. Atomic rename/fsync covers tested process death; hardware power-loss behavior remains filesystem-dependent.

The host must stop dispatch when closed or storage is uncertain. This store supplies no daemon, login item or sleep/poweroff execution. pause(id, true) stops materialization and cancels unclaimed queued or approval occurrences for that schedule. Already running work may settle. pause(id, false, now) advances an expired recurring cursor to its first future interval while preserving its anchor; repeated enables do not move an active cursor. removeSchedule(id) idempotently removes only the schedule and cancels its unclaimed occurrences; run, occurrence, attempt and application data history are retained. cancel affects one run. These updated controls are available in this source checkout and require a future 0.9.x package publication for external consumers.

Transport request IDs are stable SHA-256-derived UUID-shaped values, separate from occurrence identity and compatible with existing Orbit safeIdentity constraints. Windows does not provide directory fsync through this API; Windows verification covers atomic snapshot process recovery, not physical power-loss durability.

The bundled GUI Tasks page offers Enable, Disable, and a confirmed Delete for the selected schedule. Deletion preserves chats and workspace files. Expired or consumed one-time schedules cannot be enabled; create a new task with a future time. Operation errors stay visible and may be retried.

Disabling or deleting does not revoke already admitted execution. Its existing recovery contract still applies: an interrupted read run can be retried on reopening with its stable request ID, even after its schedule is deleted. No new occurrences are created for a deleted schedule.

The internal snapshot format is version 2. Valid version-1 state is imported
under the existing owner lock on opening, preserving IDs, application data and
recovery status rules. No backup copies are created. `snapshot(): WorkState`
remains a detached version-1 compatibility projection with the same fields;
internal events and deliveries are not added to the public task snapshot. Older
binaries reject the version-2 file, which the user accepts; automatic downgrade
is not provided. A legacy-tagged record containing reserved event/delivery fields
is rejected unchanged instead of discarding event evidence. See
[Internal formats](internal-formats.md) for the fixed-contract policy.

Timer facts have a tuple-encoded event ID separate from arbitrary legacy
occurrence IDs. Duplicate delivery preserves the existing fact, consumer
acknowledgement and job identity. Payload, effect and source collisions are
rejected before advancing the cursor. Acknowledgement means durable job
admission, not job success. It creates no execution attempt. Pause, removal and
cancellation also cancel pending deliveries, including across reopening.

The task adapter uses the public, task-independent `EventStore` in
`execution/event-store.ts`. The store owns persistence, exclusive ownership,
validation, transactions and restart; `execution/event-inbox.ts` supplies its
queue reducers. Task-specific legacy decoding and interrupted-attempt recovery
remain in DurableWorkStore. Both layers use one physical file and transaction,
so job creation and delivery acknowledgement cannot split across stores. See
[Single-host durable event inbox](event-inbox.md) for direct usage without tasks,
consumer ordering, and the generic persistence contract. Messages,
approval-answer ingress and outgoing notifications remain later stages.

`enqueue()` and `schedule()` accept optional explicit job priority; missing means
normal. `claimNext()` atomically selects an eligible independent job, persists
fairness progress and claims one attempt. The bundled host uses it without
preempting active work. The existing explicit `claim(id)` API remains available.
See [Job priority](job-priority.md) for the per-key ordering, bounded aging,
metadata placement and backward compatibility contract.
