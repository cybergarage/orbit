---
status: proposed
proposed-date: 2026-09-08
decision-date: null
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
semantics. This proposal addresses the newly reproduced ownership defect; it
does not adopt those three contracts again.

## Decision

**Proposed, not accepted:** introduce one exclusive filesystem guard per stable
session coordination scope. Acquire that guard before every writer-owner
transition, including ordinary admission, stale recovery and release. Never
reclaim a guard automatically. Refuse admission while a guard remains and
require exclusive offline maintenance if its creator cannot release it.

The recommendation favors a Node filesystem implementation without a native
lock dependency, conditional on author acceptance of blocked-session recovery
and compatibility costs. An OS-backed alternative is viable and preferable
if automatic recovery after guard-owner death is required. No option is
selected by the existence of this document.

### Scope and stable identity

Use a canonical session repository identity plus validated Session ID as the
coordination key, independent of transcript creation date and deletion state.
The proposed sidecars are `<session-root>/.coordination/<session-id>.guard`
and `<session-root>/.coordination/<session-id>.owner`. These are proposed
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
create/open/isOpen callers must supply validated repository scope, or obtain
it through the repository; a path alone cannot safely recover the scope after
deletion. This is an explicit proposed API compatibility change. Do not infer
a scope by walking guessed ancestor names or offer a silent legacy writer
mode. Read-only inspection of old transcripts remains possible. Files outside
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
path.resolve alone.

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
   incomplete acquisition.
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
comparison alone is not the exclusion primitive.

### Inspection, close and deletion

`isLocked` becomes read-only. For the legacy boolean isOpen shape, report true
for an in-process owner, any guard, any owner record (including stale or
malformed), or an inspection error. It is a conservative snapshot, not a lease
or a promise that a later open will fail. It never unlinks stale files. A richer
inspection result can explain live/possibly stale/blocked/error states, but
cannot grant authority. Use an actual guarded acquisition for mutation.

Close first settles queued writes and managed leases as already required, then
acquires the same guard, verifies its owner token and removes only that owner.
Do not clear the in-process ownership registry before successful release. If
the guard is busy or cleanup fails, retain exclusion, report close as incomplete
and allow bounded asynchronous retry or explicit maintenance. A retry must not
release a replacement owner's token. No new shutdown timeout value is adopted.
Guard cleanup never recursively invokes recorder close or another acquisition.

Both SessionDeletionService and legacy SessionRepository.delete use the same
session owner and guard protocol. Deletion obtains a writer capability that
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

This would refine the writer-recovery mechanism assumed by Required Execution
Journal and Session Persistence. It does not supersede the three accepted
2026-09-07 reasons for common ownership, authorization or mandatory recording.
Those records stay accepted / partial. No supersession or acceptance metadata
is changed by this proposal. The older session ADR's historical implementation
record remains intact, while this document records the subsequently found defect.
Current architecture and feature guides continue to describe current code until
an accepted implementation changes them.

## Consequences

- Positive: a complete transition has one exclusive owner, including concurrent
  stale reclamation, release and deletion retry; native lock packaging is avoided.
- Negative: abrupt death during a short guard interval can require operator
  intervention; public recorder context, storage binding and offline migration
  add compatibility and maintenance costs. Close can remain incomplete even
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
| Short exclusive filesystem guard plus current PID/token owner concept                           | No native dependency; serializes all owner transitions; preserves lease delegation    | Orphan guard blocks the session; stable scope/API migration required. Recommended for author review, not accepted.                         |
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
ambiguity or unsupported fsync. The proposed guard is not claimed universally
safer than this alternative.

## Implementation and Confirmation

**Not started.** Neither new protocol code nor regression fixes are included.
The research at `06b61f31a9091592fed0095a8c4ddb5cf50a8f14` records the unchanged
baseline and source comparison. Before any implementation, obtain an explicit
author decision on this proposed record; acceptance does not itself complete
the existing three ADRs.

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

Current checks: headers and build passed; full tests twice returned 371 passing /
1 failing (date-dependent legacy log cursor), and isolated log tests returned
6 passing / 1 failing. The separate race probe returned exit 1. Formatting,
metadata, references and lifecycle checks validate this proposal document only.
The date-dependent test needs a later narrowly scoped correction; no failed
check is relabeled successful here.

## Follow-up Work

Review three author-owned trade-offs: orphan-guard refusal/offline recovery;
stable scope and public API/configuration migration; or the extra native
integration work to obtain OS-managed recovery instead. If the binding or
maintenance requirements are impractical, revise this proposal before adoption.
Do not implement a partial guard around acquireLock alone.

After explicit adoption, implement the selected protocol and maintenance/migration
support, run the confirmation matrix, update current architecture/concepts and
session/execution guides, and commit implementation separately from later ADR
implementation evidence. Correct the separately reproduced date-dependent log
test in an authorized implementation task. Windows, other supported Node
versions, storage/power-loss limits and representative utilization remain open;
no existing ADR can be completed from this proposal or the older passing suite.

## References

- [Research and pinned source ledger](../research/2026-09-08-session-writer-lock-recovery.md).
- [Required Execution Journal](2026-09-07-required-execution-journal.md), [Managed Run Lifecycle](2026-09-07-managed-run-lifecycle.md), [Prepared Operation Authorization](2026-09-07-prepared-operation-authorization.md).
- [Session Persistence](2026-08-22-session-persistence.md).
- [Recorder](../../src/core/session/recorder.ts), [repository](../../src/core/session/repository.ts), [deletion service](../../src/core/session/deletion-service.ts), [race probe](../../test/core/execution/fixtures/stale-lock-race.mjs).
- [Linux flock](https://man7.org/linux/man-pages/man2/flock.2.html), [Windows LockFileEx](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-lockfileex), [Node exclusive flags](https://nodejs.org/download/release/v26.5.0/docs/api/fs.html#file-system-flags).
