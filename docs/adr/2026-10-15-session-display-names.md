---
status: proposed
proposed-date: 2026-10-15
decision-date: null
implementation-status: not-started
implementation-completed-date: null
implementation-commits: []
superseded-by: []
---

# Project and Session Display Names

## Purpose

Expose consistent editable names through core, CLI and the local GUI without
rewriting conversation bodies or changing Project membership and directories.

## Decision

Extend the existing lifecycle coordination boundary. Store Session title and
monotonic titleRevision in an atomic versioned coordination sidecar. Missing
metadata means no title and revision zero. Normalize surrounding whitespace,
reject empty names and control characters, and limit names to 256 UTF-16 units.
A null title explicitly restores preview/default display. Readers use title,
then preview, then the default session label.

Require an expected revision and stable operation UUID. Replay the latest exact
operation, synchronizing its metadata again before acknowledgement; reject changed
input or stale revisions. After another rename commits, an old retry conflicts
instead of overwriting newer input. Metadata changes require the registered writer
claim and transcript/recovery inspection. The application closes idle ownership
first and refuses running or quarantined sessions. Deletion markers remain final.

Project rename is a dedicated catalog mutation under existing transaction,
revision and durable operation replay semantics. It changes only name, revision
and updatedAt. Partial Project settings updates preserve omitted fields in the
same transaction; a name-only settings save uses the rename API.

## Consequences

Transcript bytes, IDs, membership, archive state and recorded directories are
unchanged. Old readers retain conversation compatibility but ignore titles.
Session retries are intentionally limited to the latest title operation; callers
must refresh after a conflict. Title changes do not reorder conversation activity.
Additional metadata must survive alongside the registered session root.

## Context and Problem Statement

At Orbit 871d2dcc6ac6886be87313cb3a1698743033d637, Session archive already
uses atomic sidecar publication and exclusive writer claims. Project updates
already provide transactional revision checks and durable operation results,
but require callers to resubmit unrelated fields. Session previews derive from
user message content and have no separate editable title.

## Decision Drivers

History preservation, explicit conflict handling, backward compatibility,
consistent retrieval, and reuse of the established persistence boundary.

## External Implementation Research

Reuse the pinned source investigation in the
[catalog ADR](2026-09-22-project-catalog-and-session-membership.md#external-implementation-research),
as the [lifecycle ADR](2026-10-14-core-lifecycle.md) does: Codex
fdd89e78ac33f02e65dabe60567cdfeba2e954d4 and Pi Coding Agent
95fbc04997eaee961eb673fa7923e9220609ebd5. Their grouping/session lessons
support separate organizational identity. Neither establishes Orbit's sidecar
format or writer coordination contract. Adopt Orbit's tested archive boundary;
reject copying an external transcript representation. No model integration or
context assembly changes are needed.

## Considered Options

Transcript rewriting risks altering evidence and requires format migration.
Storing titles in Project membership loses projectless metadata and couples moves
to naming. An independent sidecar follows the existing archive implementation.
Unconditional last-write-wins updates hide stale-editor conflicts and are rejected.

## Implementation and Confirmation

Not implemented. The user explicitly requests implementation through Draft PR;
the proposal will be reviewed against the existing lifecycle invariants first.

## Follow-up Work

Physical power-loss and cross-platform filesystem qualification remain outside
local M4 verification. No release, deployment, app/nest migration or design refresh.

## References

- [Session repository](../../src/core/session/repository.ts)
- [Archive metadata](../../src/core/session/archive.ts)
- [Project engine](../../src/core/projects/engine.ts)
