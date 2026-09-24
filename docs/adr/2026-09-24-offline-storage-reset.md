---
status: accepted
proposed-date: 2026-09-24
decision-date: 2026-09-24
implementation-status: completed
implementation-completed-date: 2026-09-24
implementation-commits:
  - e7090331b2e181be36084f088e7c52a82d713dd2
superseded-by: []
---

# Offline Storage Reset

## Purpose

Provide an explicit destructive test-maintenance command that returns Orbit to
unregistered storage, including the GUI catalog, without removing configuration
or workspace files.

## Decision

Add `orbit storage reset`, `--dry-run`, and `--initialize`. The author accepted
this command shape and requested implementation on 2026-09-24. This record
captures that acceptance before implementation; no commit was requested.

Delete only the selected session root, journal root, log root, project SQLite
file and its `-wal`, `-shm`, and `-journal` sidecars. The default paths match the
CLI/GUI. Any custom target requires all four paths explicitly, preventing a test
session root from implicitly selecting the normal catalog or logs. Allow only
the established session-root/.runs nesting; reject other overlaps, filesystem
roots, home/cwd ancestors, target symlinks, and nested storage registrations.
Refuse known live/unknown Session owners and locally retained cleanup.

Display resolved paths before mutation. Interactive execution requires exact
`RESET` input acknowledging stopped writers, disabled restarters and external
exclusive administration. Automation requires `--confirm-reset` and the three
existing offline declarations. Dry-run is read-only. Configuration, credentials,
workspace files and external backups are outside the selected targets.

Invalidate existing reciprocal bindings before removing payloads. Remove the
session root last. This is an offline administrative operation, not a
transaction or an online recovery mechanism. External exclusion must survive
process death and remain in place through verification. On failure report
remaining targets; retry the same reset under continued exclusion. Absence is
idempotent. The optional initializer runs only after every deletion succeeds;
its failure is reported separately, with normal storage inspect/resume guidance.

Reset explicitly discards registration/transition guards, deletion markers,
journal keys and migration backups inside selected roots. Normal per-session
deletion and recovery retain their existing evidence rules. Reset neither
replays operations nor claims secure erasure or atomic multi-path deletion.

## Consequences

Positive: first-run tests can reproduce missing storage; GUI state is cleared
consistently; dry-run and explicit targets make the operation reviewable.
Negative: history and recovery evidence are irreversibly lost; partial failure
requires continued offline control. PID checks cannot establish exclusion of
GUI catalog users, old binaries or service restarters.
Neutral: settings and workspace contents remain outside reset; optional
initialization uses the existing registration protocol and new pair identity.

## Context and Problem Statement

`src/apps/cli/storage.ts` only initializes, inspects, migrates and recovers.
`SessionDeletionService` retains tombstones and bindings, so deleting each
Session cannot reproduce first-run registration. GUI stores the Project catalog
and curated memory in `projects.sqlite`; retaining that database after clearing
transcripts would leave stale catalog entries. Logs may use `ORBIT_LOG_DIR`.

## Decision Drivers

- Explicit destruction for isolated trials, with reproducible scope.
- Preserve settings and the ordinary evidence-preserving deletion contract.
- Avoid inferring administrative exclusion from filesystem or PID observations.
- Make partial failure and reruns visible without introducing an online reset API.

## External Implementation Research

This decision reuses the pinned investigation in the
[registration ADR](2026-09-08-session-storage-registration-guard.md#external-implementation-research),
recorded on 2026-09-08: Codex `5adb68a49933ae446bf11935662c83dba55a0804`,
`codex-rs/rollout/src/maintenance.rs` and `compression.rs`, separates maintenance
exclusion from scheduling evidence; Pi
`b79e4cc834970cca69daebffab7df1da7d1e52c4`,
`packages/coding-agent/src/core/session-manager.ts`, uses exclusive first writes
and synchronous mutation. Adopt the distinction between exclusion and evidence;
neither establishes an atomic destructive reset of Orbit's paired roots and
Project database. Do not infer such a guarantee from their write mechanisms.
Attempts to retrieve those sources again on 2026-09-24 failed; these are prior
recorded findings, not newly verified source reads or external runtime trials.
A broader external reset comparison is not applicable to Orbit-specific
registration identities and catalog ownership.

## Considered Options

1. Remove the entire application directory: rejected because it includes settings.
2. Delete every Session: rejected because tombstones, registration and catalog remain.
3. Explicit offline reset of enumerated targets: selected, accepting partial deletion.
4. Transactional quarantine/restore: deferred; it adds another persistent recovery
   protocol and does not make deletion across independent volumes atomic.

## Implementation and Confirmation

Implementation completed on 2026-09-24 in
`e7090331b2e181be36084f088e7c52a82d713dd2`, including source, tests, command help
and maintained documentation. This later documentation change records completion.
Local validation on 2026-09-24:

- Headers and build passed; oclif regenerated the command reference.
- Nineteen focused reset/storage command tests passed using isolated directories.
- The complete suite passed 888 tests; six GUI cases failed solely with sandbox
  loopback `listen EPERM`. Their four test files passed all 17 cases when rerun
  with loopback access, including the six previously blocked cases.
- Compiled launcher trials exercised dry-run, clear-and-initialize, and clear to
  unregistered state in temporary storage. Prompt trials checked exact `RESET`,
  rejection of lowercase/whitespace/`y`, empty input, EOF and terminal Ctrl-C.
- The initial targeted fault test compared a noncanonical temporary path and
  missed its injected failure; correcting the test to compare the planned
  canonical path made the partial-deletion/retry case pass. An initial lint
  rejection of sequential test awaits was corrected before the complete suite.

No actual user storage was reset during implementation or verification.

## Follow-up Work

No required implementation work remains for the defined offline test-reset scope.
Physical failure, secure erasure and distributed storage are not claimed.

## References

- [Session storage](../session-storage.md)
- [Current architecture](../architecture.md)
- [Registration guard](2026-09-08-session-storage-registration-guard.md)
- [Project catalog](2026-09-22-project-catalog-and-session-membership.md)
