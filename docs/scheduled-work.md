# Durable scheduled work

Import DurableWorkStore from @cybergarage/orbit. Supply an app-owned local state filename. One writer owns the file until close(); another live writer is refused. Dead owners can be recovered; a leftover recovery guard requires manual inspection. Do not use network shares. Corrupt state is preserved and rejected.

Persist a schedule with a next timestamp, optional interval (at least 1000 ms), payload and effect read or opaque. materialize(now) coalesces missed fixed intervals to the latest due time and atomically queues the occurrence while advancing the cursor. One-shot schedules pause after materialization. Calendar/DST/timezone recurrence is not implemented.

Each queued occurrence owns one stable run/request ID. claim() records a distinct attempt before dispatch. finish() requires the current live attempt and commits one bounded result; cancellation prevents a stale finish. enqueue() binds an explicit retry ID to canonical payload, effect and approval preview and rejects conflicting retries. Persistent approval changes a run from approval to queued or cancelled.

On reopening, interrupted read runs return to queued; opaque runs become unknown. Read execution may happen more than once after a crash, while one result remains visible. Unknown effects never replay automatically. Reconciliation requires confirmation that external execution stopped; the minimal reconciliation API closes the run as failed with owner-supplied evidence. It does not prove external success. Existing RunSupervisor operation journals remain the authority for model/tool execution; this store's attempts describe host dispatch, not tool intents.

Only finish() of an approved successful run may atomically apply an app-data patch alongside its result. Hosts must validate that payload and patch before invoking it. setData() is a host storage API, not an operation permission grant. State is capped at 16 MiB and results at 100,000 characters; archival is not automated. Atomic rename/fsync covers tested process death; hardware power-loss behavior remains filesystem-dependent.

The host must stop dispatch when closed or storage is uncertain. This store supplies no daemon, login item or sleep/poweroff execution. Pause affects future materialization, and cancel affects one run.

Transport request IDs are stable SHA-256-derived UUID-shaped values, separate from occurrence identity and compatible with existing Orbit safeIdentity constraints. Windows does not provide directory fsync through this API; Windows verification covers atomic snapshot process recovery, not physical power-loss durability.
