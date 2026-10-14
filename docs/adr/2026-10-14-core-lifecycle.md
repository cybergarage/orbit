---
status: accepted
proposed-date: 2026-10-14
decision-date: 2026-10-14
implementation-status: completed
implementation-completed-date: 2026-10-14
implementation-commits:
  - cdc1a18fd6d7a86ef469c232c42e722d72916984
superseded-by: []
---

# Core Project Deletion and Session Archive

## Purpose

Complete the core lifecycle requested in issue #5 while preserving source files,
conversation history, existing deletion safeguards and project archive behavior.

## Decision

The implementation request authorizes a local implementation with a preference
for rejecting non-empty project deletion. Publication authorization is separate
from this lifecycle contract.

Delete a project by exact UUID, expected project revision and stable operation ID.
Reject deletion when any membership across any registered storage pair still
points to the project, including unavailable or archived conversations, or any
creation reservation is pending. Move or delete conversations explicitly first.
Delete all project memories and committed reservations in the same catalog
transaction as the project. Retain detached membership revisions and operation
results for conflict detection and exact retries. Never touch the project directory.

Store individual session archive state in a versioned atomic sidecar within the
registered session coordination namespace. Acquire the existing writer claim,
inspect transcript identity and durable run settlement, and change only archive
metadata. Refuse active writers, quarantined/unsettled runs and deletion markers.
The application closes idle threads first; archive does not cancel a run. Missing
metadata means active. Existing transcript formats remain unchanged.

Keep omitted listing filters equivalent to all for compatibility. Explicit active,
archived and all filters apply before pagination. Archive is organizational: an
explicit resume can still open retained history. Unarchive retains the same ID.

## Consequences

Project deletion cannot silently erase conversations. Pending reservations must
be completed before deletion. Session archive is reversible and older transcript
readers retain history, but older software does not apply the new archive filters.
Catalog operation results retain historical metadata and may include prior memory
mutation results; deletion does not promise secure erasure.

## Context and Problem Statement

At Orbit `7be870c267a5247c55a20ea7b849a60af7d82816`, the project catalog already
provides revision checks, operation replay and transactional memory/membership
updates. Session deletion retains markers and removes transcript/log/journal data.
It cannot serve as an archive implementation.

## Decision Drivers

History preservation, explicit destructive scope, referential integrity, backward
compatibility and shared coordination with existing writers and deletion.

## External Implementation Research

Reuse the pinned investigation in the [catalog ADR](2026-09-22-project-catalog-and-session-membership.md#external-implementation-research):
Codex `fdd89e78ac33f02e65dabe60567cdfeba2e954d4` Memory startup/consolidation
and Pi `95fbc04997eaee961eb673fa7923e9220609ebd5` SessionManager/resource
loader. These establish grouping and projectless conversation lessons, not a
complete desktop lifecycle storage contract. Adopt the existing Orbit identity
and coordination boundary. Neither source establishes Orbit's deletion policy
or a compatible archive metadata format; those require Orbit-specific tests.
No new provider, context-loading or external product integration is introduced.

## Considered Options

Implicit cascade is rejected because it would hide dependent conversation deletion.
Automatic detachment is rejected because it would silently rewrite membership.
Transcript rewriting is rejected because archive should not change history bytes.
The existing SQLite transaction and independent archive sidecar preserve these
boundaries with no dependency or schema upgrade.

## Implementation and Confirmation

The local core scope completed in
`cdc1a18fd6d7a86ef469c232c42e722d72916984`, based on upstream
`59fbbf37033426365a41bd831244241b92c7ba3e`. On Apple M4 with Node
26.10.0, headers, build, source/test type checks and lint passed; lint reported
zero errors. The focused lifecycle suite passed 43 tests, and the selected broad
suite passed 983 tests. All executed filesystem tests used synthetic temporary
repositories and catalogs.

An independent reviewer reproduced two regressions: unavailable archived
membership was classified active, and failed archive could remove a concurrently
resumed runtime mapping. Both have failing-before-fix synthetic tests and passed
after correction; the reviewer confirmed the fixes without further findings.

The no-backup restriction kept these complete files outside the broad run:

- `test/apps/cli/storage-reset.test.ts`
- `test/apps/cli/storage.test.ts`
- `test/core/execution/context-compaction.test.ts`
- `test/core/execution/context-projection-format.test.ts`
- `test/core/execution/context-projection-migration.test.ts`
- `test/core/execution/graph-maintenance.test.ts`

Whole-file exclusions also omit non-backup cases. The SQLite test titled
"persists operations and takes a consistent SQLite backup while WAL is live"
and the `compaction-migration-interruption.mjs` subprocess case were filtered
out separately. These backup tests create only synthetic temporary fixtures:
SQLite copies, versioned transcript backups, dummy backup content, and synthetic
Graph baseline snapshots. They do not copy real development conversations.
They were not executed; the unrestricted suite is not claimed to pass.
Local tests do not establish physical power-loss or cross-platform qualification.

## Follow-up Work

CLI exposure is issue #6 and is outside this scope. Power-loss and cross-platform
qualification remain outside local M4 tests. Backup-test coverage remains
unverified under the execution restriction.

## References

- [Issue #5](https://github.com/cybergarage/orbit/issues/5)
- [Project feature guide](../projects.md)
- [Session feature guide](../session.md)
- [Catalog engine](../../src/core/projects/engine.ts)
- [Session coordination](../../src/core/session/coordination.ts)
