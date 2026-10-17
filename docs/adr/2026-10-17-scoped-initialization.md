---
status: accepted
proposed-date: 2026-10-17
decision-date: 2026-10-17
implementation-status: completed
implementation-completed-date: 2026-10-17
implementation-commits: [3f8ed6fa549826d08e7d17ffa9cbe7da1c89c494]
superseded-by: []
---

# Scoped host initialization

## Purpose

Expose the author-approved settings, saved-data and all modes consistently in the
CLI and embedded GUI without deleting user work or broadening storage reset.

## Decision

The author approved the three scopes and their implementation on 2026-10-17.
Use one public planning/execution API with explicit host-owned paths. CLI and GUI
share the Orbit profile, including gui-scheduled. Settings files require explicit
selection, including acknowledgement that inherited settings may be shared and
contain credentials. No values appear in plans. All combines these scopes with
only explicitly owned cache targets. Do not delete a profile root, workspaces,
skills, context files, environment credentials, plugins or model installations.

Deletion is permanent, not OS Trash. Require a displayed plan, explicit permanent
confirmation, stopped writers, disabled restarters and exclusive external control.
A GUI enters maintenance before closing its scheduler and application, then
replans after close; it cannot resume serving runtime operations until restart.
Failure to close prevents deletion. Plans detect aliases, unsafe nesting and
replacement. Failure after deletion starts reports incomplete status and requires
continued offline control; retry uses a new reviewed plan for remaining targets.
The existing storage reset contract is unchanged. Electron integration requires a
published core version and remains separate; Trash needs its own host adapter.

## Consequences

A single contract avoids CLI/GUI drift and orphaned schedules. Explicit setting
selection is less convenient than clearing an ancestor tree, but prevents silent
changes to shared project credentials. External exclusion remains an operator
responsibility: known Orbit writer evidence is inspected, but idle old processes,
MCP programs and unrelated filesystem writers cannot be proven absent. Permanent
reset is not atomic or recoverable, and no backup or staging copy is created.

## Context and Problem Statement

At 2247eb32d4a2c2e1fe139632d6c8fbdd8ce44c8a storage reset handles sessions,
runs, logs and SQLite, but not gui-scheduled or settings. GUI preferences are
in memory. Settings resolve from cwd ancestors and can be shared. Orbit App uses
an independent Electron profile with externally referenced workspaces.

## Decision Drivers

Preserve work and secrets; share paths between CLI/GUI; fail closed under uncertain
runtime cleanup; keep existing CLI compatibility and explicit destructive consent.

## External Implementation Research

Codex and Pi are not used as reset implementations: their application-owned data
formats, process coordination and credential ownership cannot establish Orbit's
exclusion or deletion safety. This decision reuses inspected Orbit storage reset,
writer claims, scheduler close and application close contracts at the pinned
revision above. No external runtime behavior is claimed or imported.

## Considered Options

Deleting ~/.orbit or Electron userData was rejected because shared configuration,
plugins, workspace artifacts and browser state have different ownership. Calling
a CLI subprocess from the GUI was rejected because the live process must close
its own resources. Broadening storage reset was rejected for compatibility.

## Implementation and Confirmation

Implemented in 3f8ed6fa549826d08e7d17ffa9cbe7da1c89c494. Headers, build,
format/lint, 1,186 full regression tests and independent package-consumer
verification passed locally. Thirteen focused tests include the subsequently
added request-drain barrier. The actual embedded GUI was exercised with an
isolated SQLite catalog, scheduler, authenticated HTTP and isolated Electron
profile: explicit setting selection, preview, stop, confirmation, permanent
deletion and workspace retention passed without inference. The final panel was
visually inspected. The first full run had a CLI module-loading failure because
a concurrent build removed dist; the final full run and package validation ran
sequentially and passed. Remote exact-head checks are recorded in the PR.
No user-data reset or credential change was performed. The implementation is
permanent deletion only; Electron integration and Trash remain follow-up work.

## Follow-up Work

Publish the new core API before Orbit App adoption. A future Trash adapter must
restore a consistent set and specify cross-filesystem partial failures. Do not
claim environment credential revocation or secure erasure.

## References

- [Storage reset](../../src/core/session/storage-reset.ts)
- [CLI storage reset](../../src/apps/storage-reset.ts)
- [GUI host](../../src/apps/cli/gui.ts)
- [Settings resolution](../../src/core/settings.ts)
