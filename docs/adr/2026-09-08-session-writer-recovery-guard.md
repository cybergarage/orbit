---
status: accepted
proposed-date: 2026-09-08
decision-date: 2026-09-08
implementation-status: partial
implementation-completed-date: null
implementation-commits:
  - abac54535177c3d721e94567d25057a8b6f20441
  - 49c61e58adecc18c806b94701240a5753eed547c
  - 141ff61a6dd8f206d18702721adac58dc9371792
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

**Accepted on 2026-09-08 (implementation had not started at acceptance):** introduce one exclusive filesystem guard per stable
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
and `<session-root>/.coordination/<session-id>.owner`. These are coordination metadata, separate from journal event schema.
The implementation evidence below records their delivery after acceptance.
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

**Partial.** The implementation below delivers the selected protocol and local
regression fixes; remaining platform and product verification prevents completion.
The research at `06b61f31a9091592fed0095a8c4ddb5cf50a8f14` records the original
baseline and source comparison. The author accepted the reviewed contract on
2026-09-08. The subsequent explicit implementation request produced the commit below;
acceptance alone did not complete this or the existing three ADRs.

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

### Implementation evidence — 2026-09-08

Implementation commit: `abac54535177c3d721e94567d25057a8b6f20441` (recorded in this subsequent documentation commit).
Acceptance reasons and decision date remain unchanged. Status is accepted / partial,
with a null completion date; the three parent execution ADRs remain partial.

The current implementation uses `session/coordination.ts` for reciprocal root
registration, scope validation, guarded owner transitions and offline recovery;
`recorder.ts` for transcript ownership and serialized cleanup;
`writer-lease.ts` for single-consumer runtime capabilities; and the existing
Session, Agent, journal and deletion service for integration. `storage.ts` adds
explicit offline CLI initialization/recovery. [Migration documentation](../session-storage.md)
describes root/API compatibility and the external operator prerequisite.

| Confirmation                                   | Evidence and scope                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Same-session concurrent recovery and admission | Updated compiled `test/core/execution/fixtures/stale-lock-race.mjs` pauses one reclaimer inside its guard. A competing reclaimer returns guard-rejected; a later live-owner contender returns owner-rejected without changing the token. Recovery after the first process exits succeeds. macOS and Linux both exit 0; timeout is failure. The earlier two-owner / exit-1 evidence remains historical. |
| Acquisition/rejection/cleanup                  | `recovery-guard.test.ts` covers malformed owner rejection without guard leakage, failed-admission cleanup retained without a returned recorder, partial owner-write failure, owner-removed/guard-retained retry, concurrent close, no active-writer cleanup, replacement-owner preservation and lost unlink acknowledgement.                                                                           |
| Crash and maintenance                          | Five subprocess transition checkpoints cover guard creation, owner read, stale unlink, partial owner creation and guard release. Unknown partial owners halt automatic maintenance. Additional subprocess tests interrupt reciprocal initialization and owner/guard removal during maintenance; the fixture's external admission gate remains until repeat inspection.                                 |
| Identity and migration                         | Tests reject unregistered/incomplete/conflicting roots, ancestor overlap, invalid IDs, duplicate IDs and hard links; root symlink aliases converge. Same-binding `.runs` works. Legacy deletion refuses; explicit service uses the stable scope through delayed deletion and retries. Prior five deletion interruption checkpoints continue to pass.                                                   |
| Journal and run integration                    | Invalid callback-shaped capability, wrong session/root and consumed/released capability reject; a consumed lease cannot be released early. Journal I/O holds the recorder through close. Existing Agent startup/admission/approval, restart, MCP timeout, GUI and CLI tests use initialized repositories and actual writer leases. Public maintenance exports are checked.                             |
| Existing date-dependent log test               | The legacy record timestamp is now relative to the test clock, inside the existing 14-day retention window. The retention contract is unchanged; full suites no longer reproduce that separate cursor failure.                                                                                                                                                                                         |

macOS arm64 / Node 26.5.0: headers:check and build passed, npm test passed
**390 tests** (lint: 0 errors, 12 warnings). Compiled CLI smoke checks rejected
missing offline confirmations and completed explicit initialization and abandoned
guard recovery in isolated roots. Command documentation was regenerated with
prepack. Linux / Node **24.16.0**, using the local Bookworm container with the
repository mounted read-only: headers and all **390 tests** passed, as did the
compiled race fixture. Linux used the existing compiled portable artifact; a
native Linux packaging build was not run. No real user storage or network
provider was used. These results do not measure optimal product limits.

Remaining confirmation is explicit, not implied by the aggregate suite:

- Windows and other supported Node/filesystem combinations: reciprocal metadata
  synchronization, path case/alias behavior, guard/owner cleanup and child process
  shutdown. Resume on a configured Windows runner/VM and the supported matrix.
- Physical power loss, unsupported storage and production deployment control:
  fault injection and process death do not prove power-loss durability or that
  a service manager cannot restart an old writer. Validate the actual deployment's
  external exclusion and recovery procedure before claiming that operational scope.
- The additional local confirmation below covers copied capabilities, changed
  bindings, replacement guard tokens and transition write failures. Tested
  branches and process checkpoints are not proof of all OS/filesystem faults;
  repeat the matrix for the target deployment and storage environment.
- Updated real Ink/browser fixtures were migrated but not manually repeated in
  this implementation task. Their prior execution evidence remains dated; repeat
  them for the target environment along with long target suites, slow production
  MCP, real models and actual human approval/usability trials. No workload-based
  optimization of the existing time/call limits has been established.

### Additional local confirmation — 2026-09-08

Test commit `49c61e58adecc18c806b94701240a5753eed547c` closes the locally executable
follow-up cases: copied lease, changed binding before journal I/O, replaced
guard token, guard/transcript/close-guard write failures, and ancestor registration
around another binding. macOS / Node 26.5.0 npm test passed **396 tests** (0 lint
errors, 12 warnings). Linux / Node 24.16.0 passed the updated **24 recovery tests**
in addition to the preceding full 390-test run. Production code is unchanged
from `abac54535177c3d721e94567d25057a8b6f20441`; no new acceptance or optimal-limit
claim is made. Windows, other supported environments, physical durability,
external deployment control and representative/manual UI trials remain open.

### Resumed platform and UI confirmation — 2026-09-08

Resume baseline: `e504a0f701fbe2fecee8f541fdc02b14e238f6d3`, with a clean working
tree and no production changes since the implementation above. Public main was
still `80130cf194e477f136eefaa5b7cd2a2374dff198`; these local commits are not a
published release. Test commit `141ff61a6dd8f206d18702721adac58dc9371792` adds an
actual-filesystem case-identity check in `test/core/execution/recovery-guard.test.ts`.
This is a local verification addition, not a new architecture decision or a change
to scope identity. No production code or initial product limit changed.

The test checks the filesystem before choosing its assertion: a case alias must
resolve to the same registered roots and coordination paths, refuse a concurrent
writer, report locked, and allow reopen after close. Distinct case-sensitive
directories must register separately and keep their writer lifetimes independent.
The host temporary filesystem reported case aliases; the container's temporary
filesystem reported distinct paths. These observations do not establish Windows
path behavior, other volumes, Unicode normalization or power-loss durability.

| Executed check                             | Result and exact scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| macOS arm64 / Node 26.5.0                  | After the test addition, `npm run headers:check`, `npm run build` and `npm test` passed: **397 tests**, lint 0 errors / 12 warnings.                                                                                                                                                                                                                                                                                                                                                                                                 |
| Native Linux dependency/build verification | A clean Git archive of the resume baseline was unpacked into a disposable `mcr.microsoft.com/devcontainers/typescript-node:4-24-bookworm` container, Linux arm64 / Node 24.16.0. `npm ci --no-audit --no-fund`, headers, build and npm test passed with **396 tests**, lint 0 errors / 12 warnings. This used Linux dependencies and a freshly built GUI bundle, rather than the prior host-built artifact.                                                                                                                          |
| Linux case-test follow-up                  | After adding the test, the read-only source mount with networking disabled passed all **25 recovery tests**, including the case-sensitive branch. This is additional to the clean native 396-test run, not a native 397-test run.                                                                                                                                                                                                                                                                                                    |
| Independent race probe                     | The native Linux build ran `node test/core/execution/fixtures/stale-lock-race.mjs`: exit 0, guard-rejected second process, owner-rejected third process, unchanged winning ownership, and successful recovery after exit. Timeout was not the success criterion.                                                                                                                                                                                                                                                                     |
| Full Ink / real PTY                        | Rebuilt `test/apps/cli/fixtures/managed-interactive.mjs`, three isolated sessions: approve returned 2 model calls, expected file content, completed / acknowledged; deny returned 2 model calls, no file, completed / acknowledged; Ctrl+C during confirmation returned 1 model call, no file, cancelled / acknowledged. Every result had quiescence true; `/exit` returned exit 0. The fixture explicitly requests file-sync.                                                                                                       |
| GUI / actual in-app browser                | Rebuilt `test/apps/gui/fixtures/transport-faults.mjs` with fake model and isolated registered roots: send edit, inspect the preview, approve once. Proxy logs confirmed SSE disconnect, a delayed stale HTTP snapshot, HTTP 503, and duplicate/reordered snapshots on reconnect. The browser recovered to completed / acknowledged, removed the approval and disconnected notices, and showed the final response. On SIGTERM the fixture returned exit 0, 2 model calls, expected file content and delayed/failed/replayed all true. |

The UI checks were agent-operated real terminal/browser interactions with injected
model responses, not human usability samples. File content and model counts are
observations; the fixture does not instrument every filesystem write. The separate
automated authorization tests retain dispatch-count and duplicate-response checks.
No live provider, production MCP service or real user session was accessed. The
previous migration-time statement that these UI fixtures had not been rerun is
historical; the local rerun above closes that specific gap.

Remaining work and restart conditions:

- **Windows and the rest of the supported matrix:** no configured Windows runner
  or VM was available to this task. Local virtualization command/application
  discovery did not expose one; no remote CI job was dispatched. Provide a runner
  or VM with supported Node, local storage and Bash, then run registration/sync,
  aliases, guard/owner cleanup, subprocess/deletion/maintenance tests and the UI
  checks. Linux success does not establish those results.
- **Actual deployment exclusion:** no target service manager, restart policy or
  maintenance deployment was supplied. Provide an isolated deployment configured
  like the target, enumerate all old writers and their automatic restarters,
  disable admission/restart externally, interrupt maintenance, and demonstrate
  that exclusion persists until inspection permits restart. Operator flags and
  the fixture's synthetic gate do not prove this condition.
- **Physical durability/storage failures:** provide the intended storage and an
  approved fault harness. Process death, injected I/O errors and successful sync
  acknowledgements do not prove persistence through physical power loss.
- **Representative product trials:** provide a disposable target project with a
  long test suite, the intended model/MCP configuration and an actual human
  reviewer. Measure successful/failed tests, slow MCP and confirmation waiting,
  outcomes, cleanup and acknowledgement timing against the unchanged initial
  limits. Synthetic waits and agent-operated confirmation remain distinct from
  workload distributions and optimality claims.

The four affected ADRs remain accepted / partial with null completion dates.
Acceptance reasons and prior failed-probe/log-test evidence remain intact.

### Additional Node matrix and registration interruption finding — 2026-09-08

The next verification started at `cd890aaeec20dfb339467d41f0b666cb9b37b467`, with
no intervening production/test changes and a clean Orbit tree. Public main was
still `80130cf194e477f136eefaa5b7cd2a2374dff198`. Diagnostic fixture commit
`5ee2265e239ef2f3135656ac6f520157af062e93` records the cases below; this later
ADR commit records its full hash. Production code, accepted reasons and initial
limits are unchanged. **A new registration defect prevents completion.**

Clean Linux arm64 Git archives passed npm ci, headers:check, native build,
**397 tests** and the existing independent stale-recovery probe on Node
**20.19.0** and **22.23.2**. Images were `node:20.19.0-bookworm`
(digest `sha256:a5fb035ac1dff34a4ecaea85f90f7321185695d3fd22c12ba12f4535a4647cc5`)
and `node:22-bookworm`
(digest `sha256:8a34c4ab3ea2c5cd194f07e317b2a8f09461d3c8b05c4e34c8ccd56d56024c4d`).
The minimum declared Node version and another supported major now have Linux
evidence. After adding the diagnostic fixtures, macOS arm64 / Node 26.5.0
headers, build and npm test passed **397 tests**, with 0 lint errors / 12 warnings.
This aggregate result excludes the independently failing registration probe.

`node test/core/execution/fixtures/registration-interruption.mjs` returns **exit 1**
on macOS / Node 26.5.0 and Linux / Node 22.23.2. Each isolated case writes the
second reciprocal binding, then either exits with the expected checkpoint code
73 before synchronization or raises a binding-sync failure and exits 74. A fresh
repository accepts a writer in both cases. Explicit offline reinitialization
later returns successfully. That is an API/admission observation, not proof of
restored durability: the source branch for existing matching bindings syncs
directories without explicitly resyncing those binding files. Offline repair
must address that ordering as well. Timeouts and unexpected child exit codes fail the fixture and
are not counted as exclusion. This is neither a physical-power-loss experiment
nor the earlier same-session stale-recovery race.

Source cause: `initializeSessionStorage` in `src/core/session/coordination.ts`
writes each binding before `fsyncSync`; `validateBinding` accepts two matching
JSON records without evidence that the initialization completed. The existing
`recovery-guard.test.ts` interruption stops after the first binding, so it verifies
the missing-counterpart case but not failure after both records become visible.
The accepted requirement says registration interruption must leave writable
admission disabled until offline initialization completes. The external operator
must still hold exclusion throughout failed maintenance; this defect does not
justify releasing that prerequisite or equate filesystem visibility with success.

Design input, **not a new adoption**:

| Option                                            | Consequence                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Persistent repository initialization guard/marker | Make pending initialization visible before changing bindings; normal scope/admission refuses while either root reports pending state. Only exclusive offline recovery may validate/resynchronize bindings and remove the marker. Fits the existing fail-closed maintenance direction, but adds repository-level metadata, compatibility and interruption rules beyond the current per-session guard. |
| Explicit committed registration manifest          | Separate prepared reciprocal identities from the commit point after required synchronization. Requires a precise authority/location and alias/conflict rules across both roots, plus version/migration handling. A second JSON write alone repeats the defect.                                                                                                                                       |
| Rely exclusively on the operator's external gate  | Avoids new metadata but fails the adopted programmatic admission condition and leaves copied/reopened roots ambiguous. Not recommended; it would weaken an accepted requirement.                                                                                                                                                                                                                     |

Recommend researching a persistent initialization guard, comparing it with a
committed manifest before accepting a storage protocol extension. Establish its
location and identity for both roots, durable ordering, initial and repeated
registration, interrupted recovery, legacy records, aliases/conflicts, read-only
inspection and normal admission. Check crashes and errors before/after each
binding write/sync and each marker transition; loss of a cleanup acknowledgement
must not grant authority or delete another registration's evidence. Keep the
external gate until verified completion. This task records the evidence/options;
it does not silently add a persistent format or claim the defect repaired.

### Official MCP reference-server trial — 2026-09-08

At the author's request to use a generic test server, an isolated npm installation
of [Everything MCP Server](https://github.com/modelcontextprotocol/servers/tree/main/src/everything)
**2026.8.31** was used. npm distribution integrity was
`sha512-5U3OZh8Xq0Li4nA26l6uNvV9/1suMDuWSn+NjLZIhzinhMY6N3A4DCrxVecBGPf2PsNFKTEv5krxGPRwzxc7jQ==`.
No Orbit dependency, user MCP configuration or provider credential was changed.
The inspected distribution files were `dist/index.js`, `dist/transports/stdio.js`,
`dist/server/index.js`, and the echo/long-running-operation tool handlers.

Reproduce with `node test/core/execution/fixtures/everything-server.mjs
<isolated-install>/node_modules/@modelcontextprotocol/server-everything/dist/index.js`
after building Orbit. The fixture checks the installed package version and never
installs software itself. It uses actual stdio transport and a registered isolated
Session with file-and-directory-sync journal acknowledgement.

Managed discovery confirms process startup once, then refuses the catalog at
`Unsupported managed MCP schema keyword: $schema` in `src/core/mcp.ts`.
Observed: 0 model calls, 1 approval, incomplete / unknown-operation, acknowledged
journal, quiescence false and the child PID absent. After confirming that discovery
failed before any tool/model call and the only child had exited, explicit
reconciliation records failed startup and permits close. The original result is
not rewritten. An initial trial also observed close refusal before reconciliation;
that was not a successful echo run.

The same server's direct-client control discovers **13 tools**, returns the expected
echo and completes `trigger-long-running-operation` with duration 3 / steps 3 in
**3004.7 ms**. The committed fixture exits 0 for its expected refusal and control
assertions; it does not claim successful managed tool execution. It does not
instrument every server effect. This is a real reference-server connection,
not a production MCP or live-model/human workload, and a 3-second controlled wait
is not representative latency or proof of optimal limits.

Keep the accepted schema refusal for now. The first unsupported keyword is
identified; the rest of the full catalog is not thereby verified. Supporting this
server under managed execution would require an explicit dialect/vocabulary
compatibility review and tests, rather than stripping arbitrary schema metadata
or bypassing managed admission. That extension is separate from the registration
repair and is not adopted here.

No Windows runner/VM or actual deployment/restarter configuration was supplied.
The author authorized a generic MCP test server, but did not supply a long target
suite, live model or human trial conditions. Those, physical durability and the
remaining supported environments retain the prior restart conditions. Updated
macOS UI and Linux Node 24 checks were not repeated without a relevant change.

## Follow-up Work

The author accepted orphan-guard refusal/offline recovery, scoped mutating APIs,
one-to-one storage registration and explicit legacy deletion migration. Do not
repeat those decisions or implement a partial guard around acquireLock alone.
If new evidence requires a material change, record the evidence, alternatives
and recommendation without replacing the accepted rationale.

First resolve the registration interruption finding through the recorded design
review and implementation, keeping the failing probe as evidence. Then continue
the remaining confirmation matrix against the implementation above and
record any local fixes with new implementation hashes in later evidence commits.
Keep completion null while required platform, deployment or product checks remain.
Do not replay unknown effects or weaken storage/maintenance prerequisites to make
a test pass. Preserve prior failures as historical evidence and distinguish them
from the new passing guard and log tests.

## References

- [Review research](../research/2026-09-08-session-writer-recovery-review.md), [original research and pinned source ledger](../research/2026-09-08-session-writer-lock-recovery.md).
- [Required Execution Journal](2026-09-07-required-execution-journal.md), [Managed Run Lifecycle](2026-09-07-managed-run-lifecycle.md), [Prepared Operation Authorization](2026-09-07-prepared-operation-authorization.md).
- [Session Persistence](2026-08-22-session-persistence.md), [Session Resume](2026-08-23-session-resume-cli.md).
- [Recorder](../../src/core/session/recorder.ts), [repository](../../src/core/session/repository.ts), [deletion service](../../src/core/session/deletion-service.ts), [race probe](../../test/core/execution/fixtures/stale-lock-race.mjs).
- [Linux flock](https://man7.org/linux/man-pages/man2/flock.2.html), [Windows LockFileEx](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-lockfileex), [Node exclusive flags](https://nodejs.org/download/release/v26.5.0/docs/api/fs.html#file-system-flags).

### Registration protocol proposal — 2026-09-08

The [follow-up research](../research/2026-09-08-session-storage-registration.md)
and [proposed registration ADR](2026-09-08-session-storage-registration-guard.md)
address the reproduced two-visible-binding defect. The candidate adds two-root
persistent guards, explicit v1 conversion and existing-file resynchronization.
Its distinction between logical completion and final acknowledgement requires
author review; it does not silently alter this record's accepted completion
condition. This ADR remains accepted / partial with its original rationale,
implementation evidence and remaining environment/workload obligations intact.
The new record is proposed / not-started and supersedes no decision.
