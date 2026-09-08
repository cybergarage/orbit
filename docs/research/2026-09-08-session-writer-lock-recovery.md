---
status: current
investigation-date: 2026-09-08
orbit-commit: 49d68e842a05b5c5e08cdac2b748d2fb4b692f87
related-adrs: []
superseded-by: []
---

# Session Writer Lock Recovery

## Purpose

Investigate the demonstrated failure of simultaneous SessionRecorder stale-lock
reclamation and compare a persistent exclusive guard with OS-managed locking.
This is non-binding research. It neither selects an implementation nor reopens
the accepted managed-run, authorization, and required-journal contracts.

**Result:** the existing PID/token check followed by unlink admits two live
writers. A guard can prevent the interleaving only if every ownership mutation
participates and the guard itself is never reclaimed automatically. OS locks
remove that orphan-guard availability cost, but require an actual supported
Node integration and careful lock-file lifetime management. Neither option is
implemented by this investigation.

| Candidate                                | Exclusion mechanism                                  | Recovery cost                                                            | Non-binding assessment                                                                                  |
| ---------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Exclusive guard around owner transitions | Exclusive file creation; only its creator removes it | An abandoned guard blocks the affected session until offline maintenance | First implementation candidate if this availability and migration cost is acceptable                    |
| OS-managed writer lock                   | Kernel lock held by the writer's file handle         | Kernel releases after handles close; delay/inheritance must be handled   | Prefer if automatic crash recovery is a product requirement; binding and platform evidence still needed |
| Re-read token then unlink                | Separate observation and path deletion               | Same replacement race remains                                            | Insufficient                                                                                            |
| Serialize old recovery externally        | Operator excludes competing processes                | Depends entirely on operational discipline                               | Temporary restriction, not a correction                                                                 |

## Research Questions

- Which current entry points can replace or remove ownership?
- How can admission, inspection, release, and deletion use the same exclusion?
- What happens when the recovery mechanism itself crashes?
- What migration and maintenance conditions can actually exclude old writers?
- What do pinned Codex/Pi sources and OS specifications establish, and not establish?

## Orbit Baseline

Inspected on 2026-09-08 at local commit
`49d68e842a05b5c5e08cdac2b748d2fb4b692f87`. The working tree was clean and
`git diff 49d68e842a05b5c5e08cdac2b748d2fb4b692f87 -- src test` was empty.
The implementation remains `8ffef065251a0b04c0810f67a5318502c6be4df6` and its
ancestors. A read-only remote check found public main still at
`80130cf194e477f136eefaa5b7cd2a2374dff198`; local implementation evidence must
not be described as a released version.

| Inspected source                                                   | Verified behavior and significance                                                                                                                                                                                                                          |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/session/recorder.ts`: acquireLock, isLocked, releaseFile | All can unlink an owner path. Exclusive creation does not make a preceding stale observation atomic with unlink. isOpen can mutate disk through isLocked. The in-process Set only covers one process and path.resolve does not establish physical identity. |
| Same file: create/open, acquireManagedLease, close                 | create/open reserve ownership before writing/preparation; a managed lease delays close and delegates the recorder writer to the journal. Release must keep this ordering.                                                                                   |
| `src/core/session/repository.ts`: create/open/delete               | create checks the deletion marker before reservation; open repairs recovered JSONL in the reservation callback. Legacy deletion also uses SessionRecorder. These must participate, not just Agent's managed admission.                                      |
| `src/core/session/paths.ts`: sessionFilePath                       | Transcript names depend on creation time as well as ID. An ID-only journal can outlive that path.                                                                                                                                                           |
| `src/core/session/deletion-service.ts`: delete                     | Holds a recorder on the transcript initially, but retries against the deletion marker if the transcript is gone. This changes the lock path; the proposal must define one identity across both stages.                                                      |
| `src/core/execution/deletion.ts`, `journal.ts`                     | Minimal deletion marker is outside removed artifacts; journal delegates recorder ownership. Recovery of ownership does not establish an external effect's outcome.                                                                                          |
| `test/core/execution/process-storage.test.ts`                      | Covers live-owner contention, sequential stale recovery and five interrupted deletion stages. This is narrower than concurrent reclaimers.                                                                                                                  |
| `test/core/execution/fixtures/stale-lock-race.mjs`                 | Two real children pause after reading the same stale record. A replaces the lock, then B deletes A's replacement. Both remain alive and report ownership.                                                                                                   |

### Reproduction and validation observed on 2026-09-08

On macOS arm64 / Node v26.5.0, build the unchanged source and run:

```sh
npm run build
node test/core/execution/fixtures/stale-lock-race.mjs
```

Build passed. The probe returned **exit 1** and:

```json
{"first": "owned", "lock": true, "second": "owned", "simultaneousLiveOwners": true}
```

This is a reproduced failure, not a passing test or a demonstrated corruption
of journal bytes. The fixture uses a temporary repository, a PID from an exited
child, barriers inside intercepted lock reads, and cleanup of its own children.
The 2026-09-07 journal ADR already records the same result on Linux arm64 /
Node v24.16.0. Linux was not re-run for this documentation investigation;
Windows remains unverified.

`headers:check` passed. The first full `npm test` returned **371 passing / 1
failing**; an isolated `test/core/logs.test.ts` retry returned **6 passing / 1
failing**. A second full run also returned **371 passing / 1 failing**. The failing legacy cursor case writes a fixed
`2026-08-25T00:00:00.000Z` record, while FileSessionLogStore uses a 14-day age
limit and the current clock. On September 8, retention removes that record,
and querying after its ID returns an empty page. This source-supported cause
is separate from writer reclamation. The test needs a controlled clock or
explicit retention configuration in a later authorized correction; no runtime
or test files were changed here. Previous 372-test results remain dated
historical evidence, not today's result.

## External Systems Investigated

All following source files were fetched at exact revisions and inspected again
on 2026-09-08. No external runtime suite was executed.

### Codex

Revision `5adb68a49933ae446bf11935662c83dba55a0804` (the prior investigation's
`rust-v0.152.1` pin):

- `codex-rs/thread-store/src/local/writer_lock.rs`: WriterLockCoordinator
  acquires an OS coordination lock before opening and try-locking a per-thread
  writer file. Stale cleanup and Drop also hold coordination. Drop closes the
  writer handle before deleting its path for Windows compatibility. The
  `.coordination.lock` file is retained. This directly supports coordinating
  _all_ open/unlink paths, even when the writer lock itself is OS-managed.
- `codex-rs/rollout/src/maintenance.rs`: a separate home-wide maintenance guard
  opens a retained file and uses File::try_lock, returning None on contention.
  It coordinates replacement jobs; it is not proof that arbitrary live appenders
  have stopped for offline recovery.
- `codex-rs/rollout/src/recorder.rs`: commands serialize writer work and
  acknowledge flush/shutdown; those task Mutex values are in-process state.
- `codex-rs/rollout/src/compression.rs`, `ordinal.rs`, and `lib.rs`: inspected
  the append materialization, ordinal and maintenance call/export paths to
  distinguish publication/maintenance from live writer ownership. Compression's
  durable scheduling marker is distinct from the OS maintenance lock.

Useful lessons are stable logical thread identity, separate ownership and
maintenance, coordinated path removal, and handle lifetime. Do not transfer
Rust's standard-library lock availability to Orbit's Node >=20.19 runtime,
or describe these source reads as tests of Orbit's complete lease/deletion
protocol. Codex's blocking coordination call is not automatically appropriate
on Orbit's JavaScript event loop.

### Pi Coding Agent

Revision `b79e4cc834970cca69daebffab7df1da7d1e52c4` (the prior investigation's
`v0.84.4` pin), `packages/coding-agent/src/core/session-manager.ts`:
`_persist` exclusively creates a first file with wx, then uses appendFileSync;
`_rewriteFile` opens with w and rewrites entries. The inspected methods do not
supply a process-lifetime writer-lock protocol. Exclusive first creation and
synchronous I/O must not be inferred to protect concurrent resumptions. This
comparison covers the inspected persistence paths, not a repository-wide claim
that Pi has no concurrency controls anywhere.

## Findings

### Filesystem guards

[Node v26.5.0 file-system flags](https://nodejs.org/download/release/v26.5.0/docs/api/fs.html#file-system-flags)
document exclusive creation and caution about network filesystems. Exclusive
creation can choose one guard owner; it does not condition unlink on a token.
A process that did not create the guard must leave it in place, regardless of
PID, age or malformed metadata. A zero-byte guard created just before a crash
is still exclusion evidence. This is a conservative availability trade-off.

The guard should cover the whole owner transition, including normal initial
acquisition and release, not only the stale branch. Admission cannot check
that a guard is absent and then independently create the owner file: a
reclaimer can enter between those operations. Inspector-driven unlink is
another writer and must be removed or coordinated.

### OS locks and file lifetime

[Linux flock](https://man7.org/linux/man-pages/man2/flock.2.html) associates
locks with open file descriptions; duplicate descriptors can prolong ownership.
Nonblocking acquisition distinguishes contention, and network-filesystem
semantics vary. [Apple's archived flock manual](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/flock.2.html)
is a platform reference, not current macOS test evidence.
[Windows LockFileEx](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-lockfileex)
releases locks on process termination or handle closure, but release can be
delayed. Neither API establishes durable journal acknowledgement.
[Rust File locking](https://doc.rust-lang.org/std/fs/struct.File.html#method.try_lock)
explains the native primitive used by the inspected Codex source.

For an OS option, keep a stable sidecar open through recorder flush, managed
lease release and deletion. Never lock the transcript inode and then replace
it, or unlink/recreate a sidecar while another process can hold its old inode.
Either retain the sidecar permanently, or coordinate its removal and every
opener as Codex does. A native Node binding is the most direct candidate;
a helper that can die independently of its client can release protection while
the client still writes, so a naive subprocess lock service is insufficient.
No binding, dependency or supported-platform matrix is selected here.

## Analysis

### Identity is part of exclusion

A guard named after whichever artifact exists is insufficient when deletion
switches from transcript to marker. A stable coordination scope must be
available before create and after transcript removal. The proposed ADR develops
repository identity plus Session ID and a stable sidecar namespace, with
explicit admission context for low-level recorder callers. This costs API and
configuration compatibility but avoids adding transcript paths or secret
payloads to the minimal retained deletion marker.

Aliases, duplicate IDs in date-based files, mismatched journal roots, and two
repositories sharing journal artifacts must not silently create independent
locks for the same data. Canonical root binding, revalidation under ownership,
and rejection of ambiguous mappings are required. Hard links, bind mounts,
network sharing, PID namespaces and hostile filesystem modification are outside
a single-host cooperative protocol unless independently supported and tested.
A PID seen alive or an indeterminate liveness result must deny reclamation;
PID reuse can reduce availability and is not justification for timed stealing.

### Crash boundaries and maintenance

| Interruption                                  | Persistent-guard candidate                                                        | OS-lock candidate                                                        |
| --------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Before obtaining exclusion                    | No ownership; no mutation                                                         | No ownership; no mutation                                                |
| After guard creation, before reading owner    | Guard remains; deny admission                                                     | Handle release permits later lock acquisition                            |
| After stale owner removal, before replacement | Guard remains even with no owner; deny admission                                  | Exclusive handle still protects transition; revalidate after reacquiring |
| After replacement, before guard release       | New owner plus guard; deny other admission                                        | Keep writer handle; metadata is not ownership authority                  |
| After guard release, during run               | Dead owner may be reclaimed under a newly acquired guard                          | Lock releases when relevant handles close                                |
| During deletion or terminal persistence       | Recover writer exclusion first, then inspect marker/journal; never replay effects | Same recovery semantics after obtaining the kernel lock                  |
| During maintenance itself                     | Keep admission externally disabled and repeat inspection                          | External maintenance exclusion still required for format/path migration  |

An offline maintenance procedure must disable every CLI/GUI/library writer and
its restarter, including old versions, then establish sole administrator access
to the storage domain. Another PID/token file is not proof of this condition.
If the condition cannot be established, recovery is refused. Inspect and
preserve evidence, remove only positively identified coordination artifacts,
verify the journal and deletion marker without rewriting outcomes, and release
the maintenance barrier last. Unexpected live owners or conflicting bindings
stop the procedure. Do not remove unknown files with a wildcard. Killing a
writer does not prove a remote operation stopped.

## Implications for Orbit

The guard candidate can keep the accepted recorder-to-journal lease contract
without a new native dependency, at the cost of explicit orphan handling and
an offline all-writer upgrade. The OS candidate is stronger for unattended
recovery, with additional packaging and platform work. The author should choose
between those costs after reviewing the proposal; this note does not approve
either. Fixed-token rechecks and an externally serialized old binary are not
valid completion criteria.

## Risks and Limitations

No candidate protocol was implemented or runtime-tested. No power-loss,
Windows locking/sync, production MCP or representative human-wait trial was
performed. Existing initial limits remain starting profiles, not measured
optima. The known two-writer failure and today's separate date-dependent log
test failure remain unresolved. The three accepted ADRs stay partial.

## Open Questions

- Is an affected session being unavailable until offline recovery acceptable?
- Is mandatory stable recorder context and an all-writer offline migration
  acceptable, including rejection of ambiguous legacy layouts?
- If automatic crash recovery is mandatory, which native integration can
  support Orbit's Node/OS matrix without a helper-lifetime gap?
- What supported local-filesystem profiles and operator evidence will be
  required before claiming platform confirmation?

## Related Decisions

The [required journal](../adr/2026-09-07-required-execution-journal.md),
[managed run](../adr/2026-09-07-managed-run-lifecycle.md), and
[authorization](../adr/2026-09-07-prepared-operation-authorization.md)
remain accepted / partial. Their reasons, dates, and implementation history
are unchanged. A separate proposal is the next decision input.

## References

- [Orbit recorder](../../src/core/session/recorder.ts), [repository](../../src/core/session/repository.ts), [deletion service](../../src/core/session/deletion-service.ts).
- [Committed race probe](../../test/core/execution/fixtures/stale-lock-race.mjs), [process tests](../../test/core/execution/process-storage.test.ts), [log tests](../../test/core/logs.test.ts).
- [Codex writer coordination](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/thread-store/src/local/writer_lock.rs).
- [Codex maintenance](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/rollout/src/maintenance.rs).
- [Codex recorder](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/rollout/src/recorder.rs), [compression](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/rollout/src/compression.rs), [ordinal](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/rollout/src/ordinal.rs), [exports](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/rollout/src/lib.rs).
- [Pi session manager](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/src/core/session-manager.ts).
- Book inputs: A06 `books/ai/ai-orbit/analysis/orbit-sessions.adoc`, A09 `books/ai/ai-orbit/analysis/orbit-observability.adoc`, A11 `books/ai/ai-orbit/analysis/orbit-application-example.adoc` in the companion cybergarage-pub repository, committed at `01313fb5323101bdcf7c825daf686cf94d3b63fb` before this investigation. These identify the goal and prior observed failure; Orbit source is the implementation evidence.
