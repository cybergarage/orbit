---
status: accepted
proposed-date: 2026-09-22
decision-date: 2026-09-22
implementation-status: partial
implementation-completed-date: null
implementation-commits:
  - 105147dab7608a16b38a4cdd84499c1d0d690bd9
  - 73ffdc5be019f60c1e4ecba225c1dcf241ff2aa4
  - 649283b8f618cf3200ea3b943729b5f69242f8d3
  - 4070b5c70a7db96f1baa08152b24ca6e9b50f3c0
superseded-by: []
---

# Project Catalog and Session Membership

## Purpose

Give Orbit applications a durable way to group separate conversations, select a
working directory for new work, and navigate those conversations in the GUI.
Preserve the CLI's existing single-session workflow and persisted transcripts.

## Decision

Adopt a core-owned Project catalog with explicit session membership and a
production SQLite store. The GUI calls the core application service. Project
selection is application state; it does not change filesystem authorization or
concatenate conversations. This decision extends the GUI ADR's original scope;
it does not supersede that ADR's loopback security or service architecture.

### Identity and operations

- A Project has an opaque UUID, display name, optional default directory,
  archive state, integer revision, and creation/update timestamps. A directory
  is a location, not identity. Multiple Projects may use the same directory.
- A session belongs to zero or one Project. Membership is keyed by registered
  session-storage `pairId` and session ID, never by an arbitrary path supplied
  by a browser. Membership has a revision independent of Project metadata.
- A Project with no directory uses the application's configured startup cwd
  for new sessions; this effective cwd is resolved and recorded at creation.
  It does not imply an empty sandbox or a new temporary directory.
- Core supports create/list/read/rename, changing the default directory,
  archive/unarchive, attach/unlink, and paginated project-session listing.
  Every mutation takes an expected revision and returns the committed revision.
  Stable ordering and cursors include an ID tie-breaker.
- Attach requires a valid existing session in the registered store. Moving a
  session requires an idle, closed writer and an explicit source/destination
  operation. Its recorded cwd and historical content remain unchanged.
- Membership is organizational, not proof that a session's content originated
  entirely in its current Project. The GUI displays the recorded cwd and warns
  that moving a session retains its history; it does not promise isolation of
  historical messages after a move.
- Archive hides a Project from the default list, retaining its data. Existing
  runs finish; new project-owned work is refused until unarchive. Opening past
  transcripts remains possible. Hard project deletion is outside this scope.

Public modules are `src/core/projects/` with `ProjectStore`,
`ProjectService`, and deliberately exported types. Add async
`createProjectThread(projectId, options)` instead of changing the return type of
existing synchronous `createThread()`. Keep `createThread()` projectless.

### Persistence

Use a separate local `projects.sqlite` under the configured Orbit data home,
with an injectable path for tests/embedders. Schema version 1 contains Projects,
Memberships and recoverable Operations; the linked Memory decision adds its own
versioned tables. Use SQL constraints for UUID identity, unique membership and
foreign keys. Do not store transcript copies or provider credentials here.

The proposed binding is exact `better-sqlite3@12.11.1`, loaded only by the SQLite
adapter. It declares Node 20 through 26 support. The newer 13.0.3 declares Node

> =22, so adopting that major would violate the existing Node 20.19 contract.
> Do not silently raise the engine floor or float this dependency across majors.
> Install with npm and commit the lockfile only during accepted implementation.
> Pinning metadata is not proof of binary availability or native build success.

Use WAL, foreign keys and synchronous FULL; verify effective settings at open.
Support one host on a local filesystem, not a shared/network database. SQLite's
transaction covers catalog rows, not JSONL transcripts. Acknowledge a mutation
only after commit succeeds; treat uncertain I/O outcomes as requiring a read
by operation ID, not as permission to apply the mutation twice. Bound lock waits
and return a retryable busy result. Run synchronous database work in an owned
worker with a bounded queue so a busy database cannot block GUI cancellation.
Close/drain the worker through the application lifecycle.

Every retryable mutation carries an operation ID and canonical request digest.
A reused ID with changed input is rejected; an exact retry returns the recorded
result. Store catalog changes and their operation outcome in one transaction.
Schema migrations run exclusively before admitting requests; newer schemas are
refused rather than reset. Initial parent/database creation and backups require
explicitly tested synchronization and SQLite-aware backup, not copying a live
WAL database file alone. Expose failures without claiming universal power-loss
safety beyond the tested filesystem/VFS behavior.

Provide an in-memory adapter for deterministic tests. Adapter conformance must
include compare-and-swap and recovery semantics, not just CRUD signatures.

### Session creation and recovery

1. Resolve Project revision, active state and effective cwd; reserve an
   operation and session ID in a durable pending catalog row.
2. Create the Session through the registered repository and existing writer
   ownership. Synchronize its header before exposing it to the GUI.
3. Recheck the Project revision/state and commit membership plus the operation
   result. A changed Project prevents admission; retain a recoverable pending
   operation rather than silently selecting a different directory.
4. Return the project-owned thread only after membership commit. No model or
   MCP startup may run before that point.

An exact retry reconciles the reserved ID against its registered session header.
Never overwrite an existing session with mismatched identity or cwd. Missing
headers can be retried; conflicting headers are quarantined. Failed creation
may leave an empty, unassigned session, which is reported and retained rather
than automatically deleted. Reconciliation never replays a user/model turn.
Normal unassigned enumeration labels pending reservations so the GUI does not
present them as successfully created Project conversations.

Membership changes use the existing session writer exclusion while updating the
catalog. Establish lock order as session ownership before catalog transaction;
never hold a catalog transaction while waiting for a session writer or doing
model/network work. Creation reservations commit before acquiring that ownership.
This prevents a catalog/session lock cycle.

Session deletion remains owned by `SessionDeletionService`. Project-aware hosts
mark membership unavailable before deletion, then finish catalog cleanup after
the existing deletion marker completes. A failed deletion remains visible and
retryable. A legacy CLI deletion may not know the catalog: project reads must
check source availability and reconcile missing/deleted sessions. Memory recall
must perform its own source checks, as specified in the dependent ADR.

### Runtime and GUI

Resolve cwd, settings, context files and Skill catalog per new thread. Maintain
thread-specific runtime ownership and cleanup; do not mutate a singleton's cwd
when the selected Project changes. Resume uses the recorded session cwd/model
and resolves the appropriate workspace-dependent services for that session,
with tests preserving existing explicit saved defaults.

Add validated REST operations for Projects and membership. Use the existing
capability token, origin checks, request limits and loopback binding. A selected
Project in the browser does not authorize an arbitrary session ID or file path.
The service verifies membership on scoped reads/mutations. Catalog change events
carry revisions so clients can invalidate views after reconnect; a full list
read remains the authoritative resynchronization path.

The GUI adds Project and Unassigned navigation, project-session lists, create,
rename, archive and attach/unlink controls. Active runs remain tied to their
original thread even when navigation changes. Initial support includes one
optional directory, not worktree creation, multiple roots or remote hosts.
The CLI adds no Project commands, catalog initialization or selection requirement.

## Consequences

- Positive: reusable identities and explicit ownership survive directory changes
  and GUI restarts, with projectless compatibility.
- Negative: a native database dependency, worker lifecycle, schema migration and
  cross-store recovery protocol increase packaging and test obligations.
- Neutral: Projects organize work but grant no tool permissions. Memory is a
  separate dependent decision, and project movement preserves historical content.

## Context and Problem Statement

At Orbit `abc358ba69a6b9de24d2c7a16a6bd38b28aac00c`, application `createThread`
uses startup `runtime.cwd` and settings. `SessionRepository.findLatest` filters
by cwd but does not establish project identity. GUI new-thread requests have no
Project parameter. Application tests cover durable creation and saved runtime
restoration; they do not cover simultaneous project-specific runtimes.
`SessionDeletionService` already coordinates deletion markers and writers.
The accepted GUI ADR explicitly deferred Projects.

## Decision Drivers

Stable grouping; shared core/GUI behavior; no CLI expansion; per-thread runtime
isolation; recovery across catalog and transcript writes; Node 20.19 and Windows
compatibility; preservation of existing session ownership and security.

## External Implementation Research

Investigation date: 2026-09-22. The linked research contains reproducible paths
and limitations; the decision-relevant observations are:

- Codex `fdd89e78ac33f02e65dabe60567cdfeba2e954d4`: inspected Memory startup and
  consolidation. Product documentation establishes desktop grouping, not an OSS
  desktop catalog schema. Adopt separate conversations and grouping; do not
  infer its storage implementation from the UI.
- HermesAgent `92dd3321929a915479ade608591d40de93965c7b`:
  `hermes_cli/projects_db.py`, desktop `store/projects.ts`, and project-store
  tests establish a per-profile SQLite catalog, stable IDs, folders and archive.
  Adopt explicit identity and transactions; defer its multi-folder/worktree scope.
- Pi `95fbc04997eaee961eb673fa7923e9220609ebd5`: `SessionManager` and resource
  loader establish cwd-grouped sessions and context loading. Preserve a useful
  projectless path; reject cwd as the only Project identity.
- OpenClaw `6b13f55aaf7151e3edfb33ddafeac69abb0b38d2`: memory consolidation's
  project groups show explicit scope. They do not establish a Project catalog
  or a complete access-control boundary.

SQLite's official WAL documentation describes one-host operation, one writer,
FULL synchronization and the need to preserve WAL state. The npm registry was
read on 2026-09-22: 12.11.1 records source
`4cbc39ca582fecb6b51dd920dfdd338ba4b72230`; 13.0.3 records
`dbc2ea1165fef1f599b9be12faea33fa5e9d7ffb`. Only package metadata was verified,
not native binary execution or upstream support commitments.

## Considered Options

1. **Selected option: SQLite behind a core adapter.** Transactions cover
   membership and related metadata; explicit native packaging cost.
2. **Single JSON catalog.** Avoids native dependencies but requires a new
   cross-process lock/recovery implementation and increasingly large rewrites.
3. **cwd-only grouping.** Reuses existing discovery but cannot represent separate
   Projects with the same directory or stable identity after relocation.
4. **GUI localStorage.** Easy to prototype but fails reusable library ownership,
   consistent cross-client state and reliable server-side association.

## Implementation and Confirmation

### Author acceptance — 2026-09-22

The author explicitly accepted both linked proposals and authorized implementation,
validation and the book chapter, with incremental commits. Acceptance includes
the Node 20-compatible database candidate and qualification conditions, recoverable
Project/session coordination, curated memory, journal-v3 compatibility work and
unchanged CLI feature scope. Implementation is not started at this acceptance;
completion evidence will follow actual implementation commits. The original
proposal wording below records the design adopted by this decision.

### Implementation evidence

### Implemented and verified — 2026-09-22

The commits in metadata implement worker-owned SQLite storage, transactional
catalog mutations, Project/session creation coordination, per-thread workspace
resolution, GUI navigation and curated memory. `ProjectMemoryService` validates
registered sources and freezes bounded user-role input; journal v3 records the
exact context before managed effects. GUI exposes human notes, linked excerpts,
edits, retirement, selection, preview and recorded snapshots. CLI workflows do
not opt into catalog access or memory preparation. Maintained behavior is in
[Projects](../projects.md), GUI/integration, architecture and context-compaction
guides and the glossary.

On macOS arm64 / Node 26.9, final validation passed: headers, build, all 867 tests,
and `test:package` in an independent consumer including the native SQLite probe.
Focused tests cover deterministic whole-entry selection, explicit overflow,
source change/deletion, immutable provenance, mid-Run edits, no A-to-B leakage,
exact replay, mixed journal versions, missing/duplicate/tampered context,
acknowledgement failure without dispatch, tool iteration, two Agent Graph stages,
transcript v1/v2/v3 paths and compaction excluding memory source text. Existing
verified-interruption tests remain passing. REST checks include capability,
origin, revisions, Project scope, excerpt path rejection and stale previews.

The follow-up fix reconciles completed CLI deletion under writer ownership,
refuses corrupt bounded deletion evidence and restores per-thread settings when
previewing after source inspection closed an idle thread. Regression tests cover
those paths.

An isolated GUI with temporary storage and a deterministic model was operated
through Project creation, memory creation/preview/run, excerpt saving, retirement,
historical snapshot inspection and conversation reopening. These checks establish
mechanics, not model recall quality. No production credentials or conversations
were used.

### Remaining qualification

Implementation status remains **partial**, with no completion date. Native
installation/package consumption has not been qualified across the full supported
Node/OS matrix. The acceptance-time requirement to qualify that matrix before
adding the dependency was not completed; this record does not retroactively
claim it passed or raise the Node engine floor. The tested host successfully
loaded the pinned binding and SQLite 3.53.2. Windows directory durability and
physical power-loss behavior remain unqualified.

The complete creation/deletion interruption matrix, separate-process stress,
and combined Project-memory plus interrupted-context fault injection remain
follow-up qualification. Project listing reconciles completed CLI deletion markers
under writer ownership and retires derived memory; unfinished deletion remains
unavailable and corrupt evidence is refused. External removal without an
acknowledged deletion marker remains visible as unavailable rather than being
silently removed. These qualification limits prevent marking the complete accepted scope
finished even though core/GUI feature paths are available.

### Acceptance-time implementation checklist (historical)

Not started at acceptance. Implement the accepted scope. Before adding the dependency,
qualify 12.11.1 installation and package consumption on the supported Node/OS
matrix, inspect its SQLite version and current upstream fixes, and verify
worker shutdown. A failed qualification requires revising the proposal, not an
unreported engine-floor increase or database fallback.

Required tests: two Projects sharing cwd; independent settings while both run;
projectless creation/resume; stale revisions; idempotent retry; pending creation
interruption at each boundary; conflicting session IDs; reconnect/list ordering;
archive during activity; deletion failure/retry; unavailable directories; corrupt
and future catalog schemas; concurrent processes; exports; token/origin/limit
checks; clean CLI startup without a catalog or database import.

Update architecture, concepts/glossary, GUI and integration guides; provide a
maintained Projects guide. Run headers, build, tests sequentially and package
validation because the dependency changes consumer installation. Do not mark
cross-platform or physical storage behavior verified from in-memory tests.

## Follow-up Work

The dependent [Project Memory ADR](2026-09-22-project-memory-context.md) defines
shared knowledge. Multi-root/worktrees, remote hosts, hard project deletion and
many-to-many session membership remain separate extensions. Acceptance must
explicitly include the native dependency and recoverable cross-store costs.

## References

- [Research](../research/2026-09-22-projects-and-cross-session-memory.md).
- [GUI architecture](2026-08-22-gui-application.md).
- [Session storage registration](2026-09-08-session-storage-registration-guard.md).
- [SQLite WAL](https://www.sqlite.org/wal.html).
- [12.11.1 package metadata](https://registry.npmjs.org/better-sqlite3/12.11.1).
- [13.0.3 package metadata](https://registry.npmjs.org/better-sqlite3/13.0.3).
