---
status: accepted
proposed-date: 2026-11-14
decision-date: 2026-11-14
implementation-status: completed
implementation-completed-date: 2026-11-15
implementation-commits:
  - bf65eec840574049c8c8436fa36e3deb08ca61ec
superseded-by: []
---

# Single-host event admission and timer task compatibility

## Purpose

Move single-host timer delivery onto durable events while preserving task IDs,
public snapshots, conservative recovery, and the existing execution authority.

## Decision

Extract the existing single-owner atomic snapshot persistence into a public,
task-independent EventStore. It owns the file lock, durable event and consumer
delivery state, atomic transactions, validation, failure poisoning and restart.
DurableWorkStore becomes an adapter over this store, with its legacy decoder
and task-specific recovery callback. The adapter shares the same physical file
and transaction for task admission and delivery acknowledgement; no second
store or cross-file commit is introduced.
Define reusable data-only core contracts in execution/event-inbox.ts before
adapting timers: InboxEvent is an immutable fact, EventDelivery tracks one
consumer's pending/acknowledged/cancelled admission, JobReceipt identifies the
durable task admitted, and existing RunSupervisor execution stays independent.
The single-owner implementation supplies deliverEvent and admitEvents transaction
reducers; they deliberately have no I/O or effect dispatcher. EventStore supplies
the atomic cloned-state transaction and persistence boundary. Both APIs are exported
through the package entry point. The task adapter internally persists version 2
with events and consumer deliveries; the standalone store defaults to its own
version-1 event/data format. Intake atomically records each
event and advances the schedule cursor. Consumption atomically creates the
occurrence and queued run and acknowledges the event. Acknowledgement means
accepted into durable work, never execution completion or outgoing delivery.
Ordering is sequence-based within an event key (the schedule ID for timers),
not a global FIFO promise. Consumer registration of an older fact after that
consumer has acknowledged a newer sequence for the same key is rejected.
Register historical deliveries before admission if backfill is required; the
store does not silently subscribe a consumer to unrequested earlier facts. A delivery identity is the tuple (event ID, consumer).
Redelivery validates immutable input, reuses the fact and delivery, and cannot
reset terminal delivery state. Only claim creates an attempt; RunSupervisor and its operation journal retain
model/tool execution authority. The existing AgentEvent observation union is
not a durable ingress transaction and must not be used as one.

Timer identity is a typed tuple of schedule ID and due timestamp, encoded with
JSON rather than a delimiter. Occurrence and request IDs keep their existing
values. Validate payload, effect, due and source when an occurrence ID already
exists; a public enqueue ID cannot silently capture a timer occurrence.

Import validated version-1 records in the first successful atomic write without
changing any historical IDs or application data. Existing occurrences need no
new pending events. Project snapshot() to exactly WorkState version 1. Older
binaries reject the version-2 file; rollback requires a deliberate offline
format conversion, which this stage does not provide.
The user explicitly accepts that older code cannot read newly saved data.
Identifiers remain fixed evidence contracts, not counters for optional fields;
this follows the [internal format policy](../internal-formats.md). A legacy-tagged
record containing reserved event fields is rejected as ambiguous, and recognized
current tags never substitute for required payload, delivery or identity checks.

Pending deliveries become cancelled on pause, schedule removal, or occurrence
cancellation, and cannot resurrect work. Read-only interrupted attempts retain
the existing retry policy; opaque work becomes unknown. No event grants
permissions, adds concurrency, or authorizes external effects.

## Consequences

The two durable boundaries allow recovery between timer delivery and task
admission. Duplicate consumption creates no extra attempt. Event history adds
snapshot space/write costs within the existing 16 MiB bound. One owner, fixed
interval coalescing, one-time enable restrictions, and ambiguous-persistence
poisoning remain. This does not provide exactly-once external execution.

## Context and Problem Statement

Inspected Orbit 4a36fd5606a9d3a0a07d18a1d746d1a41ee44ed3:
execution/scheduled-work.ts combines cursor advancement and task insertion;
apps/gui/local-scheduler.ts serializes execution and preserves cancellation
receipts; execution/run.ts binds request IDs to journal admission. No durable
message inbox exists in this checkout. The separate durable-nest worktree at
230e08849f503ec6a87476f8d16750d408cd7be1 contains the original scheduler lineage, not this event stage.

Integration on 2026-11-15 uses origin/main
`464adc14ff2dec9679dd4941f3d58d446b3e8892`, including merged PR #35
(additive session metadata) and PR #36 (structural log compatibility). Those
changes are base history, not part of this event patch. The standalone inbox and
task adapter keep their explicit evidence validation; neither imports operational
logs as commands nor infers successful execution from log extensions.

## Decision Drivers

Preserve interruption safety, stable identities, public API compatibility,
single ownership, cancellation semantics, and bounded local persistence.

## External Implementation Research

Inspected on 2026-11-14 at the same pinned revisions as the original scheduling
ADR, to compare persistence boundaries rather than changing provider behavior:

- [Codex recorder](https://github.com/openai/codex/blob/b741e480e203f037ca726bc2a76d99a8e8668e66/codex-rs/rollout/src/recorder.rs):
  writer commands distinguish recording from flush acknowledgement. Adopt an
  explicit persistence acknowledgement boundary. Rollout recording does not
  provide Orbit's cursor/task transaction; do not substitute it for the store.
- [Pi session manager](https://github.com/badlogic/pi-mono/blob/4c6fb7cfe8c538a668726f6f8b3554098c39faee/packages/coding-agent/src/core/session-manager.ts):
  entries have stable identity and separate custom state from model context.
  Adopt identity separation; conversation appends do not establish an atomic
  timer admission boundary and must not authorize replay of external effects.

### Distributed-system lessons, investigated 2026-11-14

| Official source                                                                                                            | Adopted property                                                                              | Single-host boundary / rejected implication                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Temporal task queues](https://docs.temporal.io/task-queue) and [Activities](https://docs.temporal.io/activity-definition) | Separate durable work admission from execution; stable identity survives worker interruption. | No workflow interpreter, deterministic history replay, distributed workers, lease or automatic opaque-effect replay.                                 |
| [RabbitMQ 4.4 confirms](https://www.rabbitmq.com/docs/confirms)                                                            | Intake confirmation and consumer acknowledgement are independent boundaries.                  | Orbit acknowledgement records durable job admission, not task success or external delivery. No broker is introduced.                                 |
| [NATS JetStream delivery](https://docs.nats.io/learn/jetstream/delivery-and-acknowledgment)                                | Retain consumer-specific progress; expect redelivery and deduplicate stable identity.         | Local restart redelivery only; no acknowledgement timeout, network redelivery or replicated consumer guarantee.                                      |
| [River transactional enqueueing](https://riverqueue.com/docs/transactional-enqueueing)                                     | Commit application state and admitted jobs together.                                          | The existing cloned snapshot is Orbit's transaction boundary; no River or database dependency is introduced, and external effects remain outside it. |
| [Kafka 4.1 design](https://kafka.apache.org/41/design/design/)                                                             | Key-local order and atomic consumer progress plus stored output.                              | Atomicity ends at the local snapshot. External writes cannot join that transaction; no distributed exactly-once claim.                               |

[Temporal Workflow replay](https://docs.temporal.io/workflows) reconstructs
workflow state using recorded results. This motivates separating facts and
execution outcomes, but Orbit does not implement deterministic workflow replay.
An opaque operation can complete externally and crash before recording its
result: it must remain unknown, never be blindly dispatched again. Admission
callbacks may not perform that operation; delivery acknowledgement must already
be durably bound to a queued job before execution begins. Thus no external
operation can legally occur in the gap before the inbox acknowledgement.

These official documentation pages describe the named versions where available;
Temporal, NATS and River pages are dated observations, not pinned implementation
inspections. The Codex/Pi source comparisons above are commit-pinned.

## Considered Options

A reducer-only API leaves persistence owned by the task runtime and does not
provide a directly usable durable foundation. Extracting the existing store
preserves one persistence authority. A second execution engine duplicates recovery and authorization. Transcript
append cannot atomically advance the timer cursor and admit work. SQLite would
change deployment dependencies; retain the bounded snapshot for this stage.

## Implementation and Confirmation

Proposal created before implementation. The user authorized the timer stage and
its compatibility layer in the delegated request; review accepted this bounded design on 2026-11-14
before source changes. The original implementation scope excluded commits;
publication was authorized on 2026-11-15. Record implementation completion and
its full commit hash in a later documentation commit. Tests must cover duplicate delivery,
interruption between boundaries, migration, collisions, cancellation and
persistence failure, in addition to existing journal and recovery coverage.

Working-tree confirmation on 2026-11-14: header verification and build passed;
52 focused event-store/scheduling/GUI-executor tests passed; the complete suite
passed 1,343 tests on macOS with Node.js 26.10.0 and loopback permission. The
initial sandboxed full run had 15 listen-EPERM failures; permitted reruns resolved
them. Lint passed with warnings. The standalone store tests import the public
package API without using task APIs and cover persistence, independent
consumers, atomic job/application-state updates, dead-owner recovery, ambiguous
successful rename, late historical registration, immutable history, rejected
asynchronous/nested transactions and retained-draft isolation. Process-death
coverage includes accepted but unadmitted events and an opaque external effect
before result recording; the latter remains unknown without redispatch.
Existing timer migration, cancellation and interrupted-attempt tests continue
to pass over the extracted store. No live provider calls were used. Windows,
physical power loss and distributed behavior are not qualified by these local
checks. Formal completion is recorded below after the authorized implementation commit.

Integrated confirmation on 2026-11-15 at base
`464adc14ff2dec9679dd4941f3d58d446b3e8892`: headers and build passed;
72 focused event/task/GUI-executor plus metadata/log compatibility tests passed;
the full suite passed 1,363 tests with loopback permission. Format/lint finished
with no errors, and git diff whitespace validation passed. The isolated npm
package consumer passed for 512 packaged files, including compiled public event
exports, declarations, durable reopen/deduplication and the task snapshot API.
No task or provider inference was executed by the event consumer probe.

Additional regressions reject missing payloads despite a recognized identifier,
refuse a legacy tag containing event evidence without altering saved bytes,
preserve independent extensions, and reject invalid default application state
before publication. Failed owner release remains closed to writes and can be
retried without removing a replacement owner's lock. The implementation of PRs
#35 and #36 remains unchanged in the patch; only the event-specific inventory
entry and policy links were added. All state tests use isolated temporary data.
Pre-publication validation used no backup or stash and made no commits, pushes,
PR merges, deployments or CI-budget changes.

### Implementation completion — 2026-11-15

Implementation commit `bf65eec840574049c8c8436fa36e3deb08ca61ec` completes the
defined single-host event-store, task compatibility and timer intake stage.
The accepted decision was committed separately before the implementation commit.
This later documentation commit records that implementation hash, the local
validation evidence above and the remaining excluded phases. Publication is
authorized; merge and deployment remain outside the request. Existing push CI
runs under its unchanged configuration; current-head results are reported in the
pull request rather than inferred from local checks. Windows, physical power
loss and distributed guarantees remain unqualified.

The first-stage completion boundary is the independently usable local EventStore,
its shared-transaction task adapter and timer intake. Application execution still
belongs to the existing RunSupervisor/host. General internal-format policy work,
messages, approvals, notification delivery and distributed execution are excluded.

## Follow-up Work

Message ingress, approval-answer ingress, notifications/outgoing delivery,
offline downgrade, larger-history storage and multi-host ownership remain
separate phases. They are not implemented or authorized by this timer inbox.

## References

- [Task-independent event inbox guide](../event-inbox.md)

- [Original scheduling decision](2026-10-03-durable-scheduled-work.md)
- [Scheduled work guide](../scheduled-work.md)
- [Current architecture](../architecture.md)
