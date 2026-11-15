# Job priority and fairness

Priority selects among independent eligible Jobs. It does not interrupt active
work, change operation permissions, reorder inbox facts or acknowledge execution
success. The single-host owner and RunSupervisor safety boundaries remain intact.

## Explicit metadata

`JobPriority` is `high`, `normal` or `low`; omission means normal. Trusted hosts
can use high for urgent user work or approval processing and low for background
work. Those input integrations are not added here. A `priority` property inside
arbitrary payloads is ordinary application data and has no scheduling meaning.

```typescript
import {DurableWorkStore} from '@cybergarage/orbit'

const store = new DurableWorkStore('/absolute/application/jobs.json')
try {
  store.enqueue('background-1', {operation: 'synthetic'}, 'read', undefined, {priority: 'low'})
  store.enqueue('urgent-1', {operation: 'synthetic'}, 'read', undefined, {priority: 'high'})
  const claim = store.claimNext()
  if (claim) {
    // This example performs no operation. A real host supplies scoped execution.
    store.finish(claim.run.id, claim.attempt.id, 'succeeded', 'Synthetic result')
  }
} finally {
  store.close()
}
```

`enqueue()` retains its existing ID, payload, effect and optional approval
arguments and adds an optional fifth `WorkEnqueueOptions` argument. A replay must
match normalized priority as well as payload, effect and approval preview.
Missing and explicit normal priority are equivalent. Priority cannot be changed
by replaying an existing request ID.

`schedule()` accepts an optional top-level priority and captures it on each timer
fact and queued run. Priority remains separate from the task payload. Existing
schedules and callers remain normal when the field is absent. GUI priority
controls and HTTP creation fields are not introduced; the bundled host uses the
selector for schedules created through trusted core APIs.

## Eligibility and same-key order

The public `selectReadyJob(candidates, schedulingState)` helper takes a complete
set of unfinished candidates, including blocked heads. Each has an ID, key,
unique positive arrival sequence, readiness and optional priority. Supply stable
job admission order, rather than the inbox's key-local event sequence; do not derive sequence from current priority or omit blocking
predecessors. Only the earliest unfinished candidate for a key can compete.
An unready head blocks its queued successors, even if they have high priority.
Cancelled and completed jobs are omitted by the owner; they never become ready
because of age.

The task adapter derives keys from schedule identity; independent explicit
`enqueue()` requests have their own keys. It uses persisted run insertion order
as arrival sequence. The bundled LocalScheduler and `claimNext()` allow only
one active execution and stop all automatic selection while any run is unknown.
Explicit `claim(id)` remains the trusted host's manual selection API; its caller
chooses its own policy rather than receiving the selector's fairness guarantee.

## Deterministic aging

Selection first compares effective priority, then the number of eligible
bypasses, then arrival sequence. Base ranks are low 0, normal 1 and high 2.
`JOB_AGING_INTERVAL` is four: every four credited higher-priority bypasses promote a job one rank,
with effective rank capped at high. Bypass counters saturate at eight. A selected
job loses its counter. An eligible losing head gains a credit only when the
selected job has a higher base priority. Waiting behind a FIFO peer does not
grant credits, preserving old default ordering when an older blocked job becomes
ready. Blocked work does
not gain credit; an already accumulated credit is retained while blocked.

A lone eligible low job competing with newly arriving high jobs runs on the
ninth choice, after eight credited higher-priority bypasses. Normal work in that example runs on the fifth
choice. Once promoted, a waiting job's age prevents newly arriving high jobs from
continually taking its slot. Equally aged older jobs can precede it, so a finite
earlier backlog still has to drain. Entirely normal/default histories retain FIFO order, including after approval.
Credits already earned in a mixed-priority history remain effective after urgent
work drains.

This guarantee is measured in selection opportunities, not seconds. A hung
execution, stopped owner, unresolved unknown outcome or blocked key may stop
progress. Priority neither cancels those conditions nor grants a wall-clock
service deadline. No worker pool, preemption, retry/backoff or distributed owner
is added.

## Atomic persistence and recovery

Generic EventStore owners call the selector inside `transact()`, storing
`JobSchedulingState` with their application jobs and changing the selected job's
claim state in that same transaction. The helper mutates only a transaction
draft and returns the selected ID; it never executes work or writes files.
Discarding the draft must discard the fairness update and claim together.

`DurableWorkStore.claimNext()` performs selection, fairness update and creation
of one attempt in one existing atomic snapshot transaction. Its `WorkClaim`
contains the run and attempt. The GUI host passes this attempt into execution
without claiming again. The earlier event admission/job creation/delivery ack
transaction is unchanged and still completes before an execution attempt starts.

Internal task state remains format 2. Optional priority and scheduling metadata
are additive; absence means normal priority and empty counters. Public
`WorkState` snapshots retain their v1 field set with optional priority on runs
and schedules. Present invalid priorities, counters or counter identities reject
before dispatch. Arbitrary legacy request IDs and application data remain intact.
Fairness survives process death and reopen; it is not reset by host restart.

Pause, removal and cancellation still cancel unclaimed work and pending timer
deliveries. Stale completion is rejected. Interrupted read attempts retain their
existing recovery policy, while opaque attempts become unknown; neither urgency
nor accumulated bypasses authorizes an uncertain external effect to run again.

See [Event inbox](event-inbox.md), [Scheduled work](scheduled-work.md), and the
[priority decision](adr/2026-11-15-job-priority.md) for ownership and rationale.
