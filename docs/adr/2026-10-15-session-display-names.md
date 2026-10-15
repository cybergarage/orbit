---
status: accepted
proposed-date: 2026-10-15
decision-date: 2026-10-15
implementation-status: completed
implementation-completed-date: 2026-10-15
implementation-commits:
  - 5307d79530d1a53233befd72c230614c44cb2ecf
  - ba2dab20bf0472852f1c1e81ff64e4102af7cdff
  - 5bb0f8040768fe12d4a346069d263cddd8e3cbf9
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
first and refuses running or quarantined sessions. Deletion markers remain final;
Session deletion removes title metadata under the same claim and retry boundary.

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

Accepted under the user's explicit implementation request on 2026-10-15.
Review confirmed the archive writer claim, deletion checks and catalog
transaction are reusable without changing transcript formats. Revision conflicts
and latest-operation retry limits are explicit.

Implementation completed in `5307d79530d1a53233befd72c230614c44cb2ecf`.
On Apple M4 / Node 26.10.0, headers, build, source/test type checks and
formatting/lint passed (zero errors; 107 warnings). The final synthetic-only
aggregate run passed 1,030 tests after title deletion cleanup was included.
The focused core/CLI/GUI run passed 87 tests. Real compiled CLI
subprocesses verified Japanese names, clearing, operation replay, input flags,
reserved command-like IDs and unchanged transcript bytes.

Chrome verification used an isolated synthetic SQLite catalog and session root:
Project settings and explicit Project Rename, Session Rename/save, cancel,
clear-to-preview, matching sidebar/header/details, and name retention after a
GUI server process restart. No real state was copied or used as a fixture.
No backups or Docker images were created by the local validation workflow.

A final GUI refinement in `ba2dab20bf0472852f1c1e81ff64e4102af7cdff`
compares untouched directory input without trimming before deciding on a
name-only mutation. Chrome verified a synthetic Project whose existing directory
ends in a space: both the directory bytes and archive state survived a name-only
Project settings save. Build, source/test types, formatting/lint and the 87-case
related suite were rerun for this final code. The 1,030-case aggregate result
above precedes this GUI-only comparison refinement; final-HEAD CI is separate.

The local aggregate command excluded six entire files that create backups:
`test/apps/cli/storage-reset.test.ts`, `test/apps/cli/storage.test.ts`,
`test/core/execution/context-compaction.test.ts`,
`test/core/execution/context-projection-format.test.ts`,
`test/core/execution/context-projection-migration.test.ts`, and
`test/core/execution/graph-maintenance.test.ts`. It also filtered the SQLite
backup test and `compaction-migration-interruption.mjs` case. Whole-file
exclusions omit some non-backup cases as well. The unrestricted local test suite
is not claimed. The pending remote CI must be assessed at the final PR HEAD.

The first remote analysis reported 5.9% new-code duplication and Reliability C.
The remote unit test also exposed a new HTTP fixture that implicitly constructed
a provider Agent and therefore required a credential. These were not accepted
as final validation. `5bb0f8040768fe12d4a346069d263cddd8e3cbf9` factors the
three integration cases onto one synthetic fixture with an explicit fake Agent,
handles the returned GUI action promises, preserves programmatic dialog focus,
clarifies labels/conditions and marks static CLI metadata readonly. The final
87 related tests pass with OpenAI and Anthropic API-key environment variables
removed. Build, source/test types and headers pass; lint has zero errors and
104 warnings. Chrome reconfirmed initial input focus and title save/display.
Remote analysis and full CI must be rechecked on the subsequent PR HEAD.

## Follow-up Work

Physical power-loss and cross-platform filesystem qualification remain outside
local M4 verification. No release, deployment, app/nest migration or design refresh.

## References

- [Session repository](../../src/core/session/repository.ts)
- [Archive metadata](../../src/core/session/archive.ts)
- [Project engine](../../src/core/projects/engine.ts)
