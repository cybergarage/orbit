---
status: accepted
proposed-date: 2026-09-08
decision-date: 2026-09-08
implementation-status: not-started
implementation-completed-date: null
implementation-commits: []
superseded-by: []
---

# Session Writer Recovery Guard

## Purpose

Prevent two cooperating Orbit processes from obtaining writer authority for the
same persisted session during stale-owner recovery. Preserve the accepted
shared transcript/journal lease, operation authorization and unknown-outcome
semantics. This decision addresses the newly reproduced ownership defect; it
does not adopt those three contracts again.

## Decision

**Accepted on 2026-09-08; implementation not started:** introduce one exclusive filesystem guard per stable
session coordination scope. Acquire that guard before every writer-owner
transition, including ordinary admission, stale recovery and release. Never
reclaim a guard automatically. Refuse admission while a guard remains and
require exclusive offline maintenance if its creator cannot release it.

The author selected the reviewed Node filesystem guard, including its blocked
recovery and migration costs. OS-managed locks remain a researched alternative,
not the selected implementation. A future requirement for unattended recovery
would need a new recorded decision rather than a silent change to this contract.

### Acceptance record — 2026-09-08

The author explicitly accepted the recommendation including the review changes
in `d9e4bea8242502ac0c4e22b462bf1032ffdfd7d6`:

- Refuse admission for an abandoned guard and require exclusive offline
  maintenance that also disables old writers and their automatic restarters.
- Coordinate normal acquisition, rejection cleanup and staged release retry
  under a stable per-session scope without replaying unknown external effects.
- Validate writer/lease authority for the recorder and built-in persistent
  journal; retain the conservative read-only isOpen wrapper.
- Refuse legacy transcript-only deletion and migrate explicitly to the deletion
  service with its existing disclosed minimal marker.
- Register session/journal roots one-to-one, reject ambiguous/conflicting layouts,
  and accept the all-writer offline upgrade and maintenance cost.

At acceptance, the working tree was clean and the reviewed commit was still HEAD;
no later source, test or document differences were found. Public main remained
`80130cf194e477f136eefaa5b7cd2a2374dff198`. Review evidence and existing ADRs
revealed no new material contradiction preventing this record. The known race,
date-dependent log-test failure and unverified platform/product conditions are
implementation obligations, not evidence that they have been resolved.
This acceptance changes no runtime, test, product budget or journal event schema.
Implementation status remains not-started, completion date null, and
implementation-commits empty. The original proposal/review findings below retain
their dated context.

### Scope and stable identity

Use a canonical session repository identity plus validated Session ID as the
coordination key, independent of transcript creation date and deletion state.
The selected sidecars are `<session-root>/.coordination/<session-id>.guard`
and `<session-root>/.coordination/<session-id>.owner`. These are selected, unimplemented
coordination metadata, not current files or a change to journal event schema.
The owner contains a version, PID and unpredictable ownership token; guard
existence is authoritative even when its diagnostic contents are incomplete.
Neither file contains prompts, tool arguments or transcript paths.

A repository owns one validated binding between its canonical session root
and journal root. Persist/check this configuration binding before writable use;
a conflicting journal root or a journal root already bound to another session
repository must reject rather than create a second ownership domain. Bindings
are repository metadata outside per-session deletion and contain only storage
identity/configuration, not session content. Establish the reciprocal root bindings
under exclusive initialization/maintenance before admitting any writer; create
missing binding files exclusively, reject incomplete or conflicting bindings,
and never repair them online. A crash during registration leaves writable
admission disabled until that procedure completes. Existing public options with
arbitrary overlapping roots consequently need offline migration. The exact
versioned binding encoding and API type names are implementation details to
review before code lands; bypassing the binding is not an allowed fallback.

`SessionRepository` supplies the scope. Exported low-level SessionRecorder
create/open callers must supply validated repository scope, or obtain
it through the repository; a path alone cannot safely recover the scope after
deletion. This is an explicit accepted API compatibility change. Do not infer
a scope by walking guessed ancestor names or offer a silent legacy writer
mode. The existing isOpen(file) argument may remain in the selected read-only
conservative wrapper as specified below; it does not need a breaking scope argument. Read-only
inspection of old transcripts remains possible. Files outside
the bound repository require explicit import to a fresh ID before writable use.

Resolve root aliases consistently and validate the transcript's header ID,
location and unique mapping under ownership. Reading the header beforehand is
only discovery; re-read it after acquisition before repair or append. Reject
duplicate IDs, conflicting root bindings, hard-linked transcripts and ambiguous
aliases; do not lowercase arbitrary paths to simulate Windows identity. Support
is initially limited to cooperating processes on one host and verified local
filesystems with a stable PID namespace. Shared network mounts, independent
PID namespaces and hostile filesystem writers require a different guarantee.
Root binding and identity validation must be demonstrated, not inferred from
path.resolve alone. Validate the exact supported root/year/month/day transcript
layout and reject cross-binding nested/overlapping roots during registration;
the same binding's default session-root/.runs pair remains allowed. Binding
registration cannot authorize a second repository to claim an existing one’s
transcript under a different relative layout. Invalid IDs must reject before
creating sidecar directories or names.

Stable identity is required; this one-to-one registered topology is the selected
simplification, not the only possible safe architecture. A multi-resource scheme
can instead claim both canonical transcript identity and journal-root/Session-ID
identity, preserving more custom layouts. It requires a fixed lock order,
rollback of partial acquisition, aliases and a durable deletion identity when
the transcript disappears. The simpler binding is recommended for this scope,
with its restrictions presented as author-owned compatibility costs.

### Admission and recovery protocol

1. Validate the scope and attempt exclusive guard creation (`wx`). On EEXIST,
   fail without mutation; other filesystem errors also deny admission. Do not
   spin or sleep synchronously on the event loop. Report contention separately
   from I/O failure; callers may retry a fresh attempt within their existing
   budgets. A missing, dead, malformed or old PID in the guard never authorizes
   stealing it. Its age is diagnostic only.
2. While owning the guard, inspect the current owner record and deletion marker.
   A live PID or indeterminate liveness rejects acquisition. A malformed owner
   also rejects and requires maintenance. Only a well-formed owner whose process
   is positively absent may be removed. No observation obtained before guard
   acquisition authorizes this removal. Every participating owner-file creation,
   replacement and unlink follows this guard rule.
3. Exclusively create a fresh owner record. Revalidate transcript identity,
   deletion state and any recovered-file preparation before returning writer
   authority. Normal admission rejects both deleting and completed markers.
   First creation checks marker/duplicate identity under the same protection,
   rather than relying on the current earlier assertNotDeleted call.
4. Release only the guard created by this attempt after its owner transition is
   complete. If guard cleanup fails, do not report successful new admission;
   preserve blocked ownership evidence and surface the failure. Partial owner
   writes or ambiguous I/O remain fail-closed. No model/tool starts from such an
   incomplete acquisition. Every path after successful guard creation has an
   explicit unwind: ordinary rejection leaves the pre-existing owner untouched
   and releases this attempt's own guard. If this attempt created a new owner
   but failed preparation, remove only that owner under the still-held guard
   after all started preparation I/O has settled, then release the guard. No
   cleanup runs for a guard this attempt failed to acquire. Capture both the
   original error and any cleanup failure; a retained guard is blocked recovery,
   not an ordinary busy rejection. Before returning that failure, transfer any
   retained cleanup capability to the core cleanup registry for this scope;
   do not lose it merely because no recorder was returned to the caller.
   The registry may finish only the known failed attempt, never resume admission.
5. Keep the owner record for the recorder lifetime, through queued transcript
   writes and all managed journal leases. A run does not hold the short guard
   while waiting for the model, MCP, a person or journal writes. A dead writer
   outside a guard transition may be recovered by a new guarded attempt.

Exclusion argument under the stated assumptions: only one process creates the
guard; other processes cannot mutate or obtain the owner while it exists.
That owner performs a complete inspection/removal/replacement before releasing
the guard. A subsequent contender sees the replacement live owner. A crash
inside that interval preserves the guard and therefore prevents admission.
This argument depends on all entry points and versions participating; token
comparison alone is not the exclusion primitive. Keep a local guard capability
from successful exclusive creation, including an unpredictable token and file
identity. Diagnostic PID text does not recreate that capability after restart.
No callback or arbitrary preparation code may dispatch operations inside an
acquisition transition; complete only the defined transcript preparation I/O.

### Inspection, close and deletion

`isLocked` becomes read-only. For the legacy boolean isOpen shape, report true
for an in-process owner, any guard, any owner record (including stale or
malformed), or an inspection error. It is a conservative snapshot, not a lease
or a promise that a later open will fail. It never unlinks stale files. A richer
inspection result can explain live/possibly stale/blocked/error states, but
cannot grant authority. A path-only isOpen wrapper resolves only an existing,
validated scope using read-only metadata. If the scope is missing, conflicting
or cannot be determined, it reports unavailable/true rather than probing the
old adjacent lock and returning false. It never registers bindings or creates
or cleans sidecars. Use an actual guarded acquisition for mutation.

Close first settles queued writes and managed leases as already required, then
acquires the same guard, verifies its owner token and removes only that owner.
Do not clear the in-process ownership registry before successful release. If
the guard is busy or cleanup fails, retain exclusion, report close as incomplete
and allow bounded asynchronous retry or explicit maintenance. A retry must not
release a replacement owner's token. No new shutdown timeout value is adopted. Report later coordination cleanup
failure separately from any already immutable run result; do not rewrite a
known completed operation as unknown merely because a sidecar could not be removed.
Guard cleanup never recursively invokes recorder close or another acquisition.
Implement a serialized cleanup state owned by the recorder; the current cached
closePromise in SessionRecorder and Session is not itself a retry mechanism.
The state must distinguish these cases:

| Cleanup state                         | Retry authority and action                                                                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| I/O or managed lease unsettled        | Keep writer ownership; do not start owner removal.                                                                                             |
| Own owner present, guard not acquired | A bounded asynchronous attempt may acquire the guard; EEXIST never authorizes removal.                                                         |
| Own guard held, own owner present     | Continue the same cleanup capability; do not try to acquire its own guard again.                                                               |
| Owner removed, own guard remains      | Release only that retained guard; do not require the now-absent owner or create a new writer.                                                  |
| Removal acknowledgement uncertain     | Re-inspect matching local capability/identity; absence can settle that artifact, mismatch never authorizes unlink and blocks further mutation. |
| Owner and guard released              | Mark cleanup complete; repeated calls do not mutate replacement ownership.                                                                     |

Do not reopen append/synchronize or issue a fresh journal lease when a cleanup
attempt times out or fails. Repeated close/status/retry entry points join one
cleanup state, not parallel removers or a permanently cached rejected promise.
Clearing an in-memory cleanup registry after success must compare its generation
so that a newer owner of the same scope is not cleared. A process restart loses
local creator authority and therefore returns to offline recovery for any guard
left behind; it does not reconstruct a cleanup capability from PID/token text.

SessionDeletionService uses the same session owner and guard protocol.
The old SessionRepository.delete currently unlinks only the transcript without
a marker. The selected behavior is to refuse that mutation and direct callers to
SessionDeletionService, including sessions without a journal directory. This
avoids silently adding retained markers to the old API. A later compatibility
wrapper may delegate only with an explicit full deletion context (logs,
acknowledgement level and retained-marker semantics); no transcript-only fallback
is allowed. Read-only lookup and a no-op for an absent session may remain.
Deletion through the service obtains a writer capability that
allows continuation of an existing deleting/completed marker; ordinary admission
does not. After acquiring it, re-read the marker and artifact inventory, check
active/quarantined runtime state, then follow the already accepted marker-first
deletion order. Hold that writer capability through all asynchronous deletion
and marker acknowledgements. Release the short transition guard before the
asynchronous work; the live owner still rejects competing open/delete attempts.
A retry after transcript removal derives the same scope from repository and ID,
never from the marker filename. No second SessionRecorder is nested underneath
the deletion lease.

The stable coordination directory stays outside the removed journal/session
artifacts. Completed deletion releases its ephemeral owner and guard; it keeps
the existing minimal completed deletion marker, not an extra permanent
per-session path inventory. A crash can leave coordination artifacts requiring
recovery; report them explicitly and do not claim complete cleanup until the
required removal is confirmed. Global repository binding metadata is unaffected.
Lock recovery alone never clears quarantine, reconciles an unknown external
effect, restores approval, or replays an operation.

### Persistent journal authority

The built-in FileExecutionJournal must validate the same authority when used
directly, not only when Agent opens it. Replace its bare releaseLease callback
with a runtime-validated core-issued capability, or an equivalent scoped factory
that does not expose an unchecked persistent open. The selected capability binds
the repository identity, Session ID, canonical journal root, owner generation
and live lease state. Public types/serialized PID records or user callbacks
cannot manufacture it. Reject mismatched Session metadata/recorder identity as
well as foreign, released or already-consumed capabilities before opening or
creating journal/key files. One capability has at most one live journal consumer;
failure paths return or release that borrow exactly once after I/O settles.
A matching capability delegates existing recorder ownership and acquires no
second process lock. Its release is a journal-borrow release, not early recorder
writer release. Reconciliation writes use the same owned journal; read-only
inspection requires no live capability.

Agent's existing path supplies matching values, but FileExecutionJournal.open
currently trusts an arbitrary release callback and separately supplied root.
Existing storage tests use no-op callbacks; adoption requires ownership fixtures
and migration examples for direct library users. Custom ExecutionJournal /
journalFactory implementations remain trusted extensions responsible for their
own exclusion. Validate the built-in persistent boundary; do not claim this
protocol prevents arbitrary JavaScript/fs access in the same process.

### Abandoned guard and exclusive maintenance

Normal CLI, GUI and library entry points report blocked recovery and the
applicable repository/session identifier. They must not suggest that deleting
a lock while Orbit is running is safe. Already owned writers may finish known
work; they retain ownership if release is blocked. Other session scopes remain
usable unless the repository binding itself is invalid.

Maintenance is a separately invoked offline operation with these preconditions
and ordered checks, not a runtime force-unlock switch:

1. The operator disables all entry points and automatic restarters that can
   access the bound session/journal roots, including older installed binaries,
   and establishes exclusive administrator control over that storage. This
   external exclusion must persist even if the maintenance process crashes.
   A process list, dead PID or another automatically reclaimed file is not
   sufficient proof. Refuse recovery if external exclusivity is unavailable.
2. Inspect the canonical binding, owner/guard records, deletion marker and
   journal. Verify all prior writers have stopped and identify any surviving
   children or remote effects separately. Unexpected live owners, identity
   conflicts or unknown artifacts halt automatic cleanup. Preserve evidence
   for review without adding secrets to diagnostic output.
3. Under that external exclusion, remove only the explicitly identified stale
   owner, then its guard last. If any step fails, keep normal admission disabled.
   Missing files are tolerable on a repeated offline attempt; do not use wildcard
   deletion. Do not remove a completed deletion marker or edit journal outcomes.
4. Verify the remaining state and selected persistence acknowledgements, then
   end maintenance and re-enable compatible writers. A crash at any step restarts
   this inspection with admission still externally disabled. Recovered sessions
   continue the accepted journal/deletion recovery flow before new operations.

A future maintenance command can check filesystem and record conditions but
cannot prove an external orchestrator will not restart an old writer. The
operator retains that responsibility. If this cannot be made practical, prefer
the OS-lock option instead of weakening guard recovery.

### Compatibility and relation to accepted ADRs

No mixed-version writer deployment is supported: old binaries ignore the new
guard/binding and can reproduce the race. Require an offline all-participant
upgrade, classify existing adjacent .lock records, and remove/migrate them only
under exclusive maintenance. Unknown/live records block migration. Preserve
transcript and journal content, approvals as historical evidence, and minimal
deletion markers. Rollback likewise requires stopping every writer and checking
coordination state; the old format being readable is not a concurrency guarantee.

This decision refines the previously unspecified recovery policy and tightens
mutating API admission; it does not replace the retained parent contracts:

| Existing ADR                                        | Relationship and retained scope                                                                                                                                                                      |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session Persistence (2026-08-22)                    | Refines writer admission/recovery and direct mutation eligibility. Versioned JSONL, transcript readability and historical implementation evidence remain.                                            |
| Session Resume Behavior and CLI Design (2026-08-23) | Supplies the concrete guarded recovery/migration policy required by its explicit cross-process exclusion condition. Exact-ID/latest selection, cwd rules and history hydration remain.               |
| Required Execution Journal (2026-09-07)             | Specifies how its shared recorder authority is recovered and validated at the built-in journal boundary. Mandatory recording, acknowledgement, unknown outcomes and minimal deletion markers remain. |
| Managed Run Lifecycle (2026-09-07)                  | Refines resource release/cleanup conditions; preserves immutable results, run budgets, quiescence and quarantine responsibilities.                                                                   |
| Prepared Operation Authorization (2026-09-07)       | Closes an inherited authority failure without changing prepared operations, confirmation scope or permission policy.                                                                                 |

These are accepted refinements within the existing single-writer/ownership
requirements, not a reversal of their selected contracts; no parent ADR is
marked superseded. The two older records keep their dated completed evidence,
which does not demonstrate this new recovery implementation. The 2026-09-07
three remain accepted / partial with the same implementation hashes and null
completion dates. Current architecture and feature guides still describe
current code until a separately authorized implementation updates them.

Operational switching also requires handling repository registration as one
maintenance operation: incomplete reciprocal records block _both_ roots, and
no participant independently repairs one half. Explicitly test interruption
between each binding write, moving/restoring a registered root and old-version
rollback. The proposal does not claim OS locks solve mixed-version migration:
old binaries must still stop when changing the ownership primitive.

## Consequences

- Positive: a complete transition has one exclusive owner, including concurrent
  stale reclamation, release and deletion retry; native lock packaging is avoided.
- Negative: abrupt death during a short guard interval can require operator
  intervention; public recorder context, storage binding and offline migration
  and direct journal capability validation add compatibility and maintenance costs.
  The legacy transcript-only delete entry point no longer mutates. Close can remain incomplete even
  when data writes have finished.
- Neutral: journal schema, permission semantics, initial execution budgets and
  the minimal deletion record keep their accepted roles. Exclusion does not
  imply power-loss durability or exactly-once external effects.

## Context and Problem Statement

At local Orbit `49d68e842a05b5c5e08cdac2b748d2fb4b692f87`, acquireLock reads
an owner whose PID is dead and later unlinks its path. The committed probe
pauses A and B after that read, lets A replace the owner, then lets B remove A's
replacement. Both report owned while alive. On 2026-09-08, an unchanged build
reproduced exit 1 on macOS arm64 / Node v26.5.0. The prior evidence records the
same failure on Linux. This is an observed exclusion failure, not an observed
journal-byte corruption.

isLocked also unlinks; release checks token before unlink; deletion retries
switch recorder paths after transcript removal. Repair-on-open, public direct
recorder calls, legacy deletion and managed leases therefore belong to the
same correction scope. Re-reading a token immediately before unlink leaves
the same non-atomic gap.

## Decision Drivers

- One writer over both transcript and mandatory journal, through late persistence.
- Fail closed on ambiguity without automatically replaying an unknown effect.
- Consistent identity and exclusion across all entry points and deletion stages.
- Explicit crash, compatibility and operator costs instead of a hidden fallback.
- Proportionate implementation for Node on supported desktop/server platforms.

## External Implementation Research

On 2026-09-08, inspected Codex
`5adb68a49933ae446bf11935662c83dba55a0804` and Pi
`b79e4cc834970cca69daebffab7df1da7d1e52c4`.
Codex `codex-rs/thread-store/src/local/writer_lock.rs` takes an OS coordination
lock around writer acquisition, stale-path cleanup and Drop; its stable
coordination file is not removed. `codex-rs/rollout/src/maintenance.rs` uses
a separate nonblocking native maintenance lock. These support explicit scope,
handle lifetime and coordinated removal, but do not supply a Node dependency
or validate Orbit's proposed filesystem guard.
Pi `packages/coding-agent/src/core/session-manager.ts` uses wx on first
materialization, synchronous append and whole-file rewrite. These paths do not
establish exclusive resume ownership; do not adopt first-create exclusion as
a substitute for a writer lease. The research lists the additional Codex
recorder/materialization/ordinal files, source links and comparison limits.

## Considered Options

| Option                                                                                          | Benefits                                                                              | Costs and recommendation                                                                                                                   |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Short exclusive filesystem guard plus current PID/token owner concept                           | No native dependency; serializes all owner transitions; preserves lease delegation    | Orphan guard blocks the session; stable scope/API migration required. Selected on 2026-09-08; not implemented.                             |
| OS-backed writer locks, with stable retained sidecars or an OS coordination lock around removal | OS releases ownership on handle closure/death, avoiding guard-file orphan reclamation | Requires supported native binding/package tests and non-inherited handle ownership. Strong alternative if unattended recovery is required. |
| OS lock held by a separate helper only                                                          | Can call native OS APIs without a Node addon                                          | Helper can die while its client continues writing; insufficient without a separately designed lifetime/fencing mechanism. Not recommended. |
| Token recheck, timeout stealing or rename-as-claim alone                                        | Small change                                                                          | Does not condition removal on the observed owner; not a sufficient correction.                                                             |
| Continue old code with external serialization                                                   | Immediate operational restriction                                                     | Not a product guarantee or completion basis.                                                                                               |

For the OS alternative, Linux flock and Windows LockFileEx provide different
handle/platform behavior; Windows unlock after death need not be immediate.
Prevent inherited lock handles from keeping stale ownership alive. The kernel
lock, not PID text, is authoritative. Hold it for the full recorder/journal
lease and deletion capability. Never unlink a sidecar that another opener can
still lock: retain it, or coordinate all open/removal paths with a second
retained OS lock as Codex does. If retained per-session sidecars are chosen,
disclose the additional retained identity metadata and review its deletion
cost before adoption. OS locks also need stable session identity, offline old
writer migration, and local-filesystem validation. They do not solve outcome
ambiguity or unsupported fsync. The selected guard is not claimed universally
safer than this alternative.

### Identity and API alternatives

| Choice                                                              | Compatibility benefit                                                | Cost / disposition                                                                                                                                |
| ------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| One-to-one registered roots, scoped recorder and journal capability | One Session-ID owner protects transcript, journal and deletion retry | Restricts custom/overlapping roots and direct mutating API use. Selected on 2026-09-08, not logically required for every possible locking design. |
| Ordered claims on transcript and journal identities                 | Can retain more arbitrary file/root layouts                          | Multiple locks, partial rollback and transcript-free deletion mapping; defer unless that compatibility is a product requirement.                  |
| Path-only read-only isOpen wrapper                                  | Retains the existing argument without granting authority             | Missing/unresolvable scope returns conservatively unavailable; selected on 2026-09-08.                                                            |
| Keep unchecked callback-based persistent journal open               | No library migration                                                 | Cannot establish matching live ownership; not recommended.                                                                                        |
| Extend old delete automatically with permanent marker semantics     | Preserves a method call                                              | Silently changes retained metadata behavior; prefer explicit service migration.                                                                   |

## Implementation and Confirmation

**Not started.** Neither new protocol code nor regression fixes are included.
The research at `06b61f31a9091592fed0095a8c4ddb5cf50a8f14` records the original
baseline and source comparison. The author accepted the reviewed contract on
2026-09-08. Implementation requires a subsequent implementation request; this
acceptance record does not itself complete this or the existing three ADRs.

| Required confirmation after acceptance                                                               | Observable result                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two or more stale reclaimers; new admission during reclamation                                       | At most one live writer; losing attempts do not alter the winner's token or transcript/journal. Adapt barriers to the new transition without requiring two readers to enter an exclusive region. Preserve the original failing baseline evidence. |
| Normal create/open/repair, direct exported recorder API, CLI/GUI/library                             | Every mutation uses validated scope; no legacy path-only bypass; header/marker checks occur under ownership.                                                                                                                                      |
| Concurrent isOpen/isLocked with acquire/release/delete                                               | Inspector changes no filesystem bytes or names and never grants authority; conservative true is permitted.                                                                                                                                        |
| Death after guard creation, owner read, stale unlink, new owner creation, before/after guard release | Every in-guard crash denies new admission until offline recovery; post-release death permits exactly one guarded reclaimer. Include empty/malformed guard and partial owner records.                                                              |
| Guard contention or unlink failure during close                                                      | No early registry/lease release, replacement token removal or false completed cleanup; bounded retries do not block the event loop.                                                                                                               |
| Delete/open/create with reused ID and concurrent deletion retries                                    | Same scope before and after transcript removal; marker rechecked, single deleter, no reuse of completed IDs; accepted minimal-marker content preserved.                                                                                           |
| Death at each deletion and maintenance stage                                                         | Existing five deletion checkpoints plus owner/guard transitions; external maintenance exclusion persists, retries are safe, no journal replay or invented outcome.                                                                                |
| Scope aliases and migration                                                                          | Symlink root aliases converge, case behavior is tested on actual filesystems, duplicate IDs/hardlinks/conflicting roots reject; mixed old writers fail the deployment precondition rather than being called compatible.                           |
| OS alternative if selected                                                                           | Native binding on supported Node/OS matrix; contention, abrupt death, descriptor inheritance, delayed release, sidecar replacement and unsupported filesystems; helper death must not expose an active writer.                                    |
| Storage and product trials                                                                           | Windows/local-filesystem acknowledgement and child cleanup; realistic long target tests, slow production MCP and human approval; no silent weaker-level fallback or optimality claim.                                                             |

Initial proposal checks (before this review): headers and build passed; full tests twice returned 371 passing /
1 failing (date-dependent legacy log cursor), and isolated log tests returned
6 passing / 1 failing. The separate race probe returned exit 1. Formatting,
metadata, references and lifecycle checks validate this proposal document only.
The date-dependent test needs a later narrowly scoped correction; no failed
check is relabeled successful here.

### Acceptance validation — 2026-09-08

On the unchanged macOS / Node v26.5.0 implementation, headers:check and build
passed. npm test returned 371 passing / 1 failing, reproducing the same legacy
log cursor failure described above; lint reported 10 warnings and no errors.
No source or test file changed. The diagnostic race probe was not rerun during
acceptance; its prior failing evidence remains unresolved. Metadata, local
references and diff checks validate the adoption record separately from that
runtime failure. No platform or representative product trial was added.

### Proposal review — 2026-09-08

Reviewed at `b6391c8d895e37a58bff4dc39b29610e230fc7ad`; source/test diff after
the proposal was empty. Headers/build passed again and the unchanged macOS
probe returned exit 1 / two owners. The full test suite was not repeated; the
separate date-dependent log failure remains unresolved.
[Review research](../research/2026-09-08-session-writer-recovery-review.md),
commit `9c2e0bb43bc61d988ef2d74d64b7d65eb85f5ccd`, records source evidence and
supersedes the original investigation as the current decision input without
erasing the original failed-probe history.

The review corrected rejection cleanup, staged release retries, direct journal
authority, legacy deletion migration, and the overstatement of layout/API
restrictions as unavoidable. At that review, the guard recommendation remained
conditional: review was not approval. The subsequent acceptance above retains
implementation metadata as not-started/null/empty.

Additional confirmation required by these corrections:

- Rejection after each acquisition checkpoint leaves the prior owner untouched
  and normally removes only the rejecting attempt's guard; inject cleanup failure
  separately from the primary error.
- Kill or fail I/O before/after owner unlink and guard unlink, including a lost
  acknowledgement and a replacement token. Concurrent retries never clear a
  newer in-memory owner, reacquire their own guard, reopen writes or strand a
  removable guard merely because its owner was already removed.
- Direct built-in journal open rejects fake/no-op, mismatched, expired, copied
  and second-use capabilities before any journal/key I/O; valid Agent/direct
  usage and reconciliation share one recorder lease through delayed close.
- Legacy delete of a real transcript refuses with migration guidance and removes
  nothing; explicit service deletion retains only the accepted marker content.
- Registered root aliases and cross-binding nesting cannot create two scopes
  for one artifact. The same binding's default .runs layout remains usable.
  Partial reciprocal registration blocks both roots until exclusive maintenance.
- The read-only path wrapper has no registration/cleanup side effects; scope
  ambiguity never returns a grant of writer authority.

## Follow-up Work

The author accepted orphan-guard refusal/offline recovery, scoped mutating APIs,
one-to-one storage registration and explicit legacy deletion migration. Do not
repeat those decisions or implement a partial guard around acquireLock alone.
If new evidence requires a material change, record the evidence, alternatives
and recommendation without replacing the accepted rationale.

In a subsequent authorized implementation task, implement the protocol and maintenance/migration
support, run the confirmation matrix, update current architecture/concepts and
session/execution guides, and commit implementation separately from later ADR
implementation evidence. Correct the separately reproduced date-dependent log
test in an authorized implementation task. Windows, other supported Node
versions, storage/power-loss limits and representative utilization remain open;
no existing ADR can be completed from this acceptance record or the older passing suite.

## References

- [Review research](../research/2026-09-08-session-writer-recovery-review.md), [original research and pinned source ledger](../research/2026-09-08-session-writer-lock-recovery.md).
- [Required Execution Journal](2026-09-07-required-execution-journal.md), [Managed Run Lifecycle](2026-09-07-managed-run-lifecycle.md), [Prepared Operation Authorization](2026-09-07-prepared-operation-authorization.md).
- [Session Persistence](2026-08-22-session-persistence.md), [Session Resume](2026-08-23-session-resume-cli.md).
- [Recorder](../../src/core/session/recorder.ts), [repository](../../src/core/session/repository.ts), [deletion service](../../src/core/session/deletion-service.ts), [race probe](../../test/core/execution/fixtures/stale-lock-race.mjs).
- [Linux flock](https://man7.org/linux/man-pages/man2/flock.2.html), [Windows LockFileEx](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-lockfileex), [Node exclusive flags](https://nodejs.org/download/release/v26.5.0/docs/api/fs.html#file-system-flags).
