---
status: proposed
proposed-date: 2026-09-08
decision-date: null
implementation-status: not-started
implementation-completed-date: null
implementation-commits: []
superseded-by: []
---

# Session Storage Registration Guard

## Purpose

Prevent writable Session/journal admission when reciprocal storage bindings are
visible but their required synchronization has not completed. Define offline
conversion and repair without changing the already accepted Session ownership,
run lifecycle, operation authorization or required journal decisions.

## Decision

**Proposed, not accepted or implemented:** introduce persistent registration
guards in both roots and version-2 reciprocal bindings. An Orbit writer requires
two matching v2 bindings and absence of both roots' registration guards.
Version-1 storage requires explicit offline conversion; matching old JSON alone
is insufficient readiness evidence.

Make both guards durable before changing registration data. Sync both binding
files, including existing files, and all affected directories before removing
guards. Remove the journal guard and sync its root first, then remove the Session
guard and sync its root. Registration becomes logically ready at the last guard
removal, after data prerequisites have been synced. The API acknowledges success
only after the final directory sync. Once either guard exists, every interruption
before logical completion refuses admission; an uncertain acknowledgement after
it requires continued external shutdown and offline verification, even if
internal inspection says ready.

This completion-point distinction is an **author decision required by this
proposal**, not a reinterpretation already approved in the parent ADR. The parent
requires rejection until registration completes. If “completes” instead requires
a successful response received by the caller, ordinary guard removal or manifest
publication cannot establish that property; resolve this before acceptance.

The review recommends the narrower data-safety interpretation, subject to explicit
acceptance: no logical readiness before both binding files and required directory
entries are synchronized. It does **not** satisfy a stronger interpretation that
all unsuccessful initializer invocations must leave internal admission blocked,
including failures after the last unlink. If that stronger condition is required,
revise this proposal to define a separately controlled admission authority and
handoff; neither a second marker nor the manifest option establishes it by itself.
Do not call this an already accepted clarification or change the parent's reasons
before the author decides.

The existing external prerequisites remain mandatory: stop all old/new writers
and admission sources, disable every automatic restarter, and retain exclusive
storage control across initializer death. Marker files neither establish that
operational exclusion nor make online registration supported.

### Proposed storage identity and placement

- Keep `.orbit-session-binding.json` in each root. V2 contains `version: 2`,
  `pairId` (a newly generated UUID on initial conversion), and canonical absolute
  `sessionRoot` / `journalRoot` paths. Both copies must agree exactly on these
  fields. Keep the pair ID across retries and repeated registration of that pair.
- Put `.orbit-registration.guard` directly in each root, never in a dated Session
  directory, `.coordination/<sessionId>` or a deletable journal run. It records a
  format version, pair ID, attempt ID and both role-labelled paths. Presence,
  including empty or malformed content, always blocks writable admission. The
  attempt identifies maintenance evidence, not the stable Session scope.
- The Session root is S and the journal root is J. Preserve one-to-one registration:
  S != J, S inside J is rejected, and J inside S is supported only as S/.runs.
  Disjoint roots may be on different filesystems; no cross-root rename is used.
  Ancestor/descendant conflict checks must recognize v1, v2, pending and partial
  registrations. Unknown metadata is a refusal, not an unused directory.
- Resolve existing directories using realpath and actual filesystem identity;
  create missing directories only offline, then resolve again. Check opened
  objects against their paths before writes/unlinks. Reject binding/guard
  symlinks, hard links and non-regular files. Handle filesystem case aliases by
  actual resolution, without universal lowercasing. Reject ambiguous aliases,
  swapped roots, divergent partners and replacements observable during the attempt.
- Canonical paths and the pair ID identify this registered relationship; they do
  not authenticate a copied filesystem, resist arbitrary raw writes, or prove a
  storage device persisted acknowledgements. Root device/inode observations are
  checked within a maintenance attempt, not imposed as portable persistent inode
  numbers. A requested move/restore or change of partner is not same-pair re-registration;
  refuse that operation and require a separately reviewed import/migration procedure.

A complete pair copied/restored to the same canonical paths between stopped
processes can retain valid v2 metadata. This format does not automatically detect
that physical replacement. Keep such restore/move operations under external
exclusion pending a separately reviewed migration procedure. Stronger automatic
volume identity or an independently retained registry is an alternative requiring
additional design; it is not an implicit property of pairId. The recommended
identity scope remains logical one-to-one storage plus observable alias/conflict
and within-attempt replacement checks.

### Proposed offline sequence

1. Establish external exclusion independently of this process. Use a non-authorizing
   offline inspection path taking configured S/J roots and operator conditions;
   it must not require a writable SessionScope or call scope-based Session recovery
   to repair registration first. Inspect identities,
   conflicts, old locks, live/unknown owners and pending cleanup. Refuse live or
   unexplained ownership. Preserve transcript, journal and deletion evidence.
2. Create missing root directories top-down, syncing each created directory and
   the directory containing its name; recursive mkdir plus a single immediate
   parent sync is insufficient for several new ancestors. Verify both roots.
3. Create the S guard exclusively, write its full metadata, fsync its file, close
   and sync S. Do the same for J. Check matching pair/attempt evidence. Do not
   mutate or upgrade bindings until both guards and their directory entries are
   durable. A failed attempt retains guards; a generic finally must not remove them.
4. Under those guards, read and validate existing bindings. Explicitly fsync each
   existing binding file using an identity-checked descriptor without truncation;
   sync its containing directory. Refuse unsupported sync or close failures.
   For absent bindings, create v2 exclusively, write/fsync/close, and sync the root.
   For v1 conversion, stage a v2 file in the same directory, fsync/close it, verify
   the original identity and rename over that binding, then sync the root. Repeat
   for the other root. Never claim two renames form one atomic transaction.
5. Reopen, compare and fsync **both final v2 binding files**, sync S and J and every
   changed parent directory, and recheck canonical pair identity. Repeating this
   on already matching v2 files is required, not an optional fast path. Complete
   any permitted positively classified legacy-lock cleanup and sync its directory
   before registration is ready; do not remove unknown owner or deletion evidence.
6. Verify that both current guards belong to the inspected attempt and pair.
   Unlink J's guard and sync J. Only after that succeeds, unlink S's guard.
   S's last unlink is the logical completion point; all binding data syncs precede
   it. Sync S, verify the ready state without repairing it, and return success.
   An I/O failure or process death after the last unlink means acknowledgement is
   uncertain. Do not release the external gate based on this method throwing,
   process exit, elapsed time or an isLocked boolean.

Single-root staging files have no admission authority. A retry validates their
identity and ownership before reuse or removal; unknown leftovers require evidence
review. This sequence proposes no persistent completion manifest in addition to
guards. All ordered filesystem steps require actual capability checks under the
adopted storage contract; file-sync-only journal selection does not waive root
registration's required directory synchronization.

### Initial registration, repetition and repair

A fresh pair and every v1 pair are unregistered for v2 writers until conversion
finishes. A valid v2 pair remains logically ready before the first guard is
created during a no-data-change repeat; external exclusion already prevents
service use. Once either guard exists, both roots reject admission. This avoids
claiming that a crash before the first mutation invalidates already durable data.

A repeated `initializeStorage` is offline even if both JSON files already match.
It must create guards and resync contents. It cannot remove a partner, change
pair ID, waive external exclusion, or imply a new registration generation.
V2 has no separate epoch field.
New initializer invocations encountering existing guards must enter an explicit
offline resume procedure, not infer ownership from PID or age. Ordinary
initialization refuses pending/unknown artifacts; the non-authorizing offline
inspection may examine them and record the evidence needed for an explicit resume.
This distinction avoids both silent repair and a circular requirement for a
writable scope before unready registration can be repaired.

Resume first re-establishes the external conditions and inspects both roots and
all retained evidence. A valid partial guard identifies its expected counterpart;
create a missing counterpart exclusively and sync both before touching bindings.
Reuse the inspected attempt/pair identity for this recovery. If one guard was
already removed, restore both durable guards and repeat the binding resync before
another removal attempt. If neither guard remains after uncertain completion,
repeat the entire guarded resync on the valid pair before permitting external
restart. Never treat earlier API success as a substitute for the new syncs.

An empty/torn guard is still a refusal. Its offline replacement requires explicit
evidence review of the configured pair, surviving bindings/guard, stopped owners
and artifact identities. Preserve the anomalous evidence before replacement; do
not guess a partner or automatically overwrite conflicting metadata. A conflicting
pair, unknown owner, malformed binding without sufficient reconstruction evidence,
unsupported sync or inaccessible counterpart remains blocked. The resumption
condition is supplied evidence and a supported destination, not another timeout.
This proposal authorizes no automatic general-purpose data repair.

If registration unexpectedly becomes pending while a local writer or retained
cleanup still exists, do not initialize around it or bypass scope validation in
release. Keep resources quarantined and stop the affected application under the
external gate; verify termination, then use a separate maintenance process to
inspect the pending registration and dead-owner evidence. Unknown ownership still
blocks automated recovery. This is an operational violation recovery condition,
not a supported race between online writers and maintenance. Resuming registration
alone neither reconciles incomplete runs nor erases their Session guard, owner,
journal or deletion evidence.

A scope holds identity, not a writer lease. Validate the current v2 pair and both
guards again at writer acquisition and live lease checks; never cache readiness.
Different-version or different-pair scopes fail. An unchanged-pair resync does
not promise permanent revocation of every pre-existing scope. Do not introduce
a generation or epoch solely to satisfy an imprecise cache-invalidation phrase;
owner-token and single-consumer lease checks remain independently mandatory.

### Admission, inspection, cleanup and Session maintenance

| Path                                                | Proposed registration behavior                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository create/open/scope, Recorder create/open  | Validate both roots, v2 identity and absence of guards before granting a writer. Recheck when claiming per-Session ownership. No lazy initialization.                                                                                                                                                               |
| Persistent journal / managed lease                  | Validate registration through the live core-issued scope at lease consumption; arbitrary callbacks or matching path strings remain insufficient authority.                                                                                                                                                          |
| isLocked / reference-only isOpen                    | Return conservatively locked/unavailable on pending, v1, missing, conflicting or unreadable registration; never sync, initialize or reclaim during inspection.                                                                                                                                                      |
| Transcript list/read/export                         | May inspect legacy/unready data as read-only content; do not issue writable scope or advertise availability. Expose unavailable/unknown distinctly where structured status exists.                                                                                                                                  |
| Normal release, failed acquisition and retryCleanup | Keep token/identity checks and retained cleanup. A registration that unexpectedly becomes pending/invalid blocks mutation and preserves owned resources for explicit reconciliation; it must not be bypassed to erase another attempt's evidence. Initialization must not begin with live writers or local cleanup. |
| Session deletion                                    | Validate registration before acquiring the stable Session claim. Delete only Session data and preserve the minimal deletion record; never remove root bindings or registration guards.                                                                                                                              |
| recoverSessionWriter and offline Session repair     | First resume root registration to a verified ready state under the same external gate, then apply existing Session evidence checks. No use of a fabricated scope to bypass root refusal.                                                                                                                            |

The new registration state is shared by Agent, CLI, GUI and library through core,
not independent per-application marker implementations. A maintenance process
must never race a compliant active writer; adversarial raw storage mutation and
operator violations are not newly guaranteed safe. Integration tests must verify
that unexpected pending state fails closed without claiming quiescence or losing
retained cleanup authority.

### Interruption and restart matrix

Each row requires tests immediately **before and after** every listed write,
file sync, close, directory sync, rename and unlink, for both roots. Death,
injected I/O failure and lost acknowledgement are distinct cases.

| Interrupted stage                                                         | Internal writable admission                                                                                                            | Required resumption under continued external exclusion                                                        |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Preflight / new ancestor creation, before first guard                     | Fresh/v1/missing data refuses; unchanged valid v2 may remain ready                                                                     | Validate roots and sync new directory ancestry; restart initialization                                        |
| S guard open/write/file-sync/root-sync, before J guard                    | Any visible S guard refuses; fresh/v1 also refuses if it disappears after power loss; unchanged old v2 is safe if no mutation occurred | Inspect retained/partial guard, establish both durable guards before binding mutation                         |
| J guard open/write/file-sync/root-sync                                    | Either guard refuses                                                                                                                   | Same; no binding mutation until both are durable                                                              |
| Existing binding open/read/file-sync/close or directory-sync              | Guards refuse, including an error on an otherwise matching old file                                                                    | Inspect and repeat both file syncs; never substitute directory sync only                                      |
| Either new/staged binding write/file-sync/close, v1 rename and root-sync  | Guards refuse even when both JSON files are visible                                                                                    | Inspect partial metadata/staging; resume conversion only with sufficient evidence; resync both final files    |
| Final binding reread/file-sync, root/parent sync, legacy cleanup          | Guards refuse                                                                                                                          | Repeat validation/sync and evidence checks; retain unknown artifacts                                          |
| J guard unlink or following J sync, before S unlink                       | S guard refuses, whether J guard remains or not                                                                                        | Restore missing J guard durably, resync both bindings and retry ordered removal                               |
| Immediately before S guard unlink                                         | S guard refuses                                                                                                                        | Resume as above                                                                                               |
| Immediately after S unlink, before/during S sync or lost success response | Matching v2 pair may be logically ready because prerequisites were synced; reappearing guard after storage recovery refuses            | Outcome is uncertain to the operator; keep external shutdown, establish guards anew and resync before restart |
| After final S sync / normal return                                        | Ready, subject to existing per-Session owner/guard/deletion checks                                                                     | External restart only after explicit verification and completion of remaining maintenance                     |
| Crash during any offline resumption stage                                 | Apply the same row; no automatic marker reclamation                                                                                    | External exclusion survives process death; review retained evidence and repeat safe stages                    |

## Consequences

The two-visible-binding failure cannot admit a compliant v2 writer while durable
guards remain. A guard can make the **whole registered pair** unavailable until
maintenance; this is broader than a per-Session recovery guard and is a new cost
for author review. The proposal adds metadata, v1 conversion, extra file and
directory syncs and explicit uncertain-outcome handling, but no OS-lock dependency.

Old transcripts, journals, minimal deletion records, Session IDs and accepted
ownership reasons are preserved. Current API and feature documentation must not
claim v2 exists yet. If accepted, implementation must update storage commands,
error/inspection contracts, architecture, concepts and migration examples, and
revalidate scope identity and current registration at ownership boundaries.
Compatibility is not achieved by permitting v1 writes or running old binaries concurrently.

## Context and Problem Statement

At Orbit `f20d919bdbedb3e900156787856e3e4ea1644e60`, coordination.ts validates only
equal reciprocal v1 JSON. `initializeSessionStorage` writes then fsyncs each
binding, leaving a visible interval after the second write. It also skips file
fsync for existing matching bindings. The unchanged registration-interruption.mjs
from `5ee2265e239ef2f3135656ac6f520157af062e93` demonstrated both death (child 73)
and fsync error (child 74) admitting a writer on macOS Node 26.5.0 and Linux
Node 22.23.2. Both probes exited 1, with no timeouts. Headers/build and all
397 ordinary macOS tests passed; that aggregate excludes the diagnostic.

The [research](../research/2026-09-08-session-storage-registration.md), initially
committed as `99318209f56a0711a14e272eb6b2a566df75a49b`, records source, external
comparisons and limits. Public main remained
`80130cf194e477f136eefaa5b7cd2a2374dff198`; no new source differences were present.

The [recovery ADR](2026-09-08-session-writer-recovery-guard.md) is accepted / partial
and already requires registration interruption to refuse writers until completion.
This proposal supplies missing persistence/migration mechanics and an explicit
completion interpretation; it neither re-accepts nor supersedes that ADR now.
If accepted with this interpretation, append the narrow completion clarification
to the parent while preserving its original wording and history. If the author
requires a stronger acknowledgement gate, revise this proposed ADR before acceptance.
The other three accepted / partial ADRs retain their run, authorization and journal
rationale and implementation records unchanged.

## Decision Drivers

- Reject incomplete registration programmatically, including both-visible JSON.
- Preserve strong storage acknowledgement and identity-checked ownership.
- Make failures recoverable without online guessing or automatic stale removal.
- Cover two physical roots, supported aliases and old data without inventing distributed atomic rename.
- Separate proven local diagnostics from unverified deployment and physical durability.

## External Implementation Research

On 2026-09-08, re-read Codex `5adb68a49933ae446bf11935662c83dba55a0804`:
`codex-rs/rollout/src/compression.rs` syncs temporary data before publication;
its scheduling marker's age-based recovery is unsuitable for Orbit registration.
`codex-rs/rollout/src/maintenance.rs` separates an OS maintenance lock from durable
scheduling evidence. Neither implements Orbit's two-root registration contract.

Pi `b79e4cc834970cca69daebffab7df1da7d1e52c4`,
`packages/coding-agent/src/core/session-manager.ts`, uses wx on first persistence
and append/truncating writes without explicit fsync in the inspected methods.
It provides no basis to infer the required durability from synchronous I/O.
These are pinned source reads, not new external runtime trials.
The research also links Node's fsync documentation and SQLite's atomic commit
ordering; no SQLite dependency or physical-durability guarantee is adopted here.

## Considered Options

1. **Persistent guards with v2 bindings — recommended.** Fits existing offline
   one-to-one storage ownership with a small state model; requires migration,
   both-root syncing and pair-wide unavailability while pending.
2. **Committed registration manifest.** Immutable generation bindings in S and J,
   a journal-side authority descriptor and one authoritative ready manifest in S
   can publish only after both prerequisites are synced. Repeat registration
   must first durably invalidate old readiness, then stage/sync a new generation
   and publish ready through same-directory rename. Missing, stale or conflicting
   references reject. This supports generation history but adds authority and
   garbage-collection rules. Two independently written ready files repeat the
   defect; final manifest publication still differs from API acknowledgement.
3. **Optional guard on unchanged v1.** Reject: absence cannot distinguish a
   previously interrupted registration from a successful one.
4. **External admission control only.** Reject as the recommended solution: the
   existing programmatic rejection condition would remain unsatisfied. External
   control is required in addition to either valid persistence protocol.

## Implementation and Confirmation

No implementation is authorized by this proposed ADR. The existing failing probe
is baseline evidence only. Implementation status stays not-started, completion
is null and implementation-commits is empty.

After acceptance, confirmation must include:

- Deterministic separate-process admission attempts at every matrix checkpoint,
  fresh/v1/v2 data, first registration and repetition, both root orders in fault
  injection, nested .runs and disjoint filesystems. Assert exact checkpoint exit
  and the matrix row's expected acquisition result: refusal while pending, possible
  readiness for an unchanged v2 pair before its first guard or after logical
  completion. Do not require blanket rejection after final unlink. Check retained
  evidence and the external gate separately; a timeout alone never passes.
- The current fixture updated to the new binding-write synchronization points,
  preserving death and fsync-error cases; it must return 0 because both cases
  actually refuse. Trace file and directory sync ordering, including existing
  matching files, new ancestors, staged rename and final-marker uncertainty.
- Empty/partial/conflicting guards and bindings, missing counterparts, stale
  staging files, lost unlink acknowledgement, close failures, interrupted offline
  resume and repeated cleanup. Successful repair requires verified evidence and
  resync, not deletion of markers merely to make a test pass.
- Both public writer APIs and persistent journal leases, per-Session acquisition,
  rejection/release retries, isLocked/isOpen with zero repair writes, legacy reads,
  deletion before/after its retained marker and scope-free offline registration
  inspection/resume before Session recovery.
  Exercise pending registration with retained local cleanup and the documented
  process-stop handoff, without inventing a writable scope. Old scopes must not
  bypass live registration checks; unchanged-pair resync is not epoch revocation.
- v1 successful and interrupted migration, mixed v1/v2 pairs, old binary rejection
  after conversion, ambiguous aliases/hard links, root replacement during an
  attempt and conflicting one-to-one arrangements. Whole-pair same-path restore
  is an explicitly unsupported operational case, not a promised detection test.
  No concurrent old-version support is inferred from a single post-conversion version check.
- Required headers:check, build and test; source diff review after format/lint.
  Run the declared Node/environment matrix, separating unsupported storage
  capability rejection from an actual verified operating environment.
- Windows registration/sync/aliases/guard-owner cleanup/subprocess termination;
  target filesystem fault testing; and an isolated operational trial that stops
  all admission and restarters and keeps them stopped across maintenance death.
  File/dir sync acknowledgements and injected errors alone do not prove power-loss
  persistence. Do not mark completion while required evidence is missing.

## Follow-up Work

Author decisions before acceptance:

1. Accept v2 conversion and whole-pair outage during incomplete registration,
   rather than keep v1 write compatibility or choose a manifest generation model.
2. Accept last-guard removal as logical registration completion after durable
   prerequisites, separately from final sync/API acknowledgement. Retain external
   shutdown for uncertain outcomes. If successful response receipt must instead
   gate internal admission, request a stronger design and revise this proposal.
3. Accept explicit evidence-based offline repair and the additional synchronization
   cost, including refusal on unsupported destinations, the stated logical identity
   limits and no online root rebinding.

The existing four ADRs remain accepted / partial. Preserve Windows, actual
operational exclusion, physical storage faults and representative long target
tests / slow production MCP / real model / human confirmation work with the
restart conditions in the recovery ADR. Everything 2026.8.31's managed `$schema`
compatibility is separate unfinished work. Initial product profile values remain
unmeasured starting values; this proposal changes none of them.

### Review record — 2026-09-08

Reviewed the original proposal at `672c3668e9c0d1922e9a8d36f217ee89515ac558`;
[follow-up research](../research/2026-09-08-session-storage-registration-review.md)
was committed separately as `6120b3d207d0c816327c5ab06cc921cb0cb32288`.
The original research remains historical evidence. There were no subsequent
source/test/dependency changes; public main remained
`80130cf194e477f136eefaa5b7cd2a2374dff198`.

The review corrected blanket rejection assertions, scope-dependent repair
ambiguity, implied epoch revocation and overbroad physical replacement detection.
Guard versus manifest, v1 conversion, existing-file resync and ordered guard
removal remain the conditional recommendation. Completion semantics require the
explicit author choice above; the parent is not declared unconditionally compatible.

Fresh macOS arm64 / Node 26.5.0 headers:check, build and 397 tests passed,
with 0 lint errors / 12 warnings and no formatting changes to source. The existing
registration diagnostic again returned exit 1, child checkpoints 73/74 and admitted
writers in both cases. This verifies the unchanged defect, not the proposed remedy.
Linux/Windows, UI, operational and physical-storage trials were not repeated in
this source/document review. Their dated evidence and outstanding work remain.
No acceptance, implementation or test correction occurred; metadata remains
proposed / not-started with null decision/completion dates and no implementation
commits. All four accepted / partial parents retain their metadata and reasons.

## References

- [Current review research](../research/2026-09-08-session-storage-registration-review.md)
- [Original registration research and full pinned source ledger](../research/2026-09-08-session-storage-registration.md)
- [Session Writer Recovery Guard](2026-09-08-session-writer-recovery-guard.md)
- [Managed Run Lifecycle](2026-09-07-managed-run-lifecycle.md)
- [Prepared Operation Authorization](2026-09-07-prepared-operation-authorization.md)
- [Required Execution Journal](2026-09-07-required-execution-journal.md)
- [Current storage guide (v1 implementation)](../session-storage.md)
- Source at the baseline: `src/core/session/coordination.ts`, `repository.ts`,
  `recorder.ts`, `writer-lease.ts`, `deletion-service.ts`; independent diagnostic:
  `test/core/execution/fixtures/registration-interruption.mjs`.
- Companion book evidence at `d406295f01946741834fca2ccc08ae8fefd99dea`:
  `books/ai/ai-orbit/analysis/orbit-sessions.adoc`,
  `books/ai/ai-orbit/analysis/orbit-observability.adoc`,
  `books/ai/ai-orbit/analysis/orbit-application-example.adoc`.
