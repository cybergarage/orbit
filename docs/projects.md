# Projects and Curated Memory

## Implementation status

Project catalog storage, registered session coordination, curated memory and GUI
controls are implemented in core and the local GUI. CLI conversation workflows
remain projectless. See the [catalog decision](adr/2026-09-22-project-catalog-and-session-membership.md)
and [memory decision](adr/2026-09-22-project-memory-context.md) for rationale and
qualification limits.

## GUI workflow

Start `orbit gui` after building. Choose **Unassigned** or a Project in the
sidebar. Under **Project settings**, enter a name and an optional absolute
working directory, then choose **Create project**. A blank directory uses the
GUI's startup directory. Two Projects may use the same directory.

**New Chat** in a Project creates a separate persisted conversation. Its cwd,
workspace settings, context files and Skill catalog are resolved for that thread.
Changing Project navigation leaves existing runs associated with their original
threads. Resume retains the saved cwd and model. Changing a Project's default
directory affects only future conversations.

Use **Save changes** to rename or change the default directory. **Archive** hides
the Project from the active list and blocks new Project work; existing runs finish.
Select **Archived projects** to inspect or unarchive it. There is no hard Project
deletion operation.

Open an idle conversation and expand **Move conversation** to attach it, move it,
or return it to Unassigned. Its historical messages and recorded cwd remain.
Source-derived memory rows in the old Project are retired instead of copied.
Active or quarantined conversations cannot be moved. Missing/deleted sources are
shown as unavailable. A creation reservation interrupted before membership commit
is labeled incomplete under Unassigned, and cannot start a run until reconciled.

## Application integration

Pass a `projectStore` to `OrbitApplicationService` to enable coordination. The
application owns its shutdown. Existing synchronous `createThread()` stays
projectless. Use `await createProjectThread(projectId, {operationId})` for a
Project; retain the UUID operation ID across retries. Core reserves that ID,
synchronizes the registered transcript, and commits membership before returning
a Thread. An interrupted attempt retains its reservation and any unassigned
transcript. Retry with the same Project and operation ID; a changed Project
revision or conflicting header requires explicit inspection, not an overwrite.

`service.projects` exposes metadata, membership and scoped listing operations.
Membership mutations require both the source Project and expected revision.
The host closes an idle writer and acquires the registered session claim before
committing the catalog update. Project-aware deletion marks a source unavailable
before the existing session deletion workflow and cleans membership afterward.
Project listing also reconciles completed CLI deletion markers under writer
ownership, unlinks the deleted source and retires derived notes. An unfinished
deletion remains unavailable; corrupt deletion evidence raises an error.

The optional `resolveProjectRuntime(cwd)` hook lets an embedding host resolve
per-thread agent options. The default reads workspace settings and instructions;
an explicitly supplied execution policy retains its roots. The GUI host explicitly
sets workspace-confirm roots to each thread's cwd. Project membership itself
does not grant tool permission.

REST routes use the existing loopback/token/origin boundary. `/api/projects`
provides paginated metadata, `/api/projects/:id/sessions` lists scoped
conversations, `/api/projects/:id/threads` creates them, and
`/api/sessions/:id/membership` performs explicit moves. Scoped resume checks
membership server-side. Mutation responses carry revisions; `project.changed`
invalidates browser lists, and reconnect reloads authoritative lists. CLI
`exec`, `resume` and interactive workflows do not open the catalog.

## Catalog adapters

Core exports `ProjectStore`, `MemoryProjectStore` and `SqliteProjectStore`.
Opening the SQLite adapter is explicit; importing Orbit does not open a catalog
or import the native binding. The binding runs in an owned worker. Always await
`close()`; it drains accepted requests before closing the database. Queue and
lock limits return retryable `ProjectStoreError` errors with code `busy`.

```typescript
import {SqliteProjectStore} from '@cybergarage/orbit'

const store = await SqliteProjectStore.open({file: '/example/data/projects.sqlite'})
try {
  const projects = await store.query({archived: false, kind: 'projects', limit: 50})
  console.log(projects)
} finally {
  await store.close()
}
```

Use a local filesystem on one host. Schema 1 uses WAL, foreign keys and FULL
synchronization, with an exclusive initialization transaction. Newer or corrupt
schemas are refused. The adapter does not repair damaged catalogs. Directory
synchronization is performed on Unix; portable directory synchronization is not
available through this API on Windows. Physical power-loss behavior and the
complete platform matrix have not been qualified.

`backup(destination)` uses SQLite's backup API and requires a new absolute
destination. Do not copy only a live database file: committed pages can still be
in its WAL. A catalog backup does not include session transcripts or journals.

## Low-level transaction contract

`mutate(operationId, mutation)` takes a UUID operation ID and expected revision.
An exact retry returns the original result, even after later edits. Reusing the
ID with different input or submitting an outdated revision fails with
`conflict`. Changes and operation results commit together. Read operations are
transactional. Project lists use ID order with an exclusive `after` cursor;
membership lists use session ID order within a registered storage pair.

Project IDs are independent of directory names. Membership uses the registered
storage pair ID and session ID. An unlinked membership retains its revision to
prevent stale attachment requests from succeeding. Pending creation reservations
retain their chosen directory and Project revision; a changed Project blocks
reservation completion without erasing the pending record.

The store is a trusted host boundary, not a model tool or an HTTP handler.
Session writer ownership, source availability and source digest verification
must be enforced by the coordinating host before a catalog mutation. The store
alone does not grant access to a session or validate a user-provided excerpt.

Memory rows preserve immutable source references and retirement state. Writes
are limited to 128 active entries, 8 KiB per body and 1 MiB of active bodies per
Project. Catalog capture validates the membership revision and memory generation
transactionally. It records only the supplied snapshot digest; exact Run context
evidence resides in the execution journal. Storage and deterministic adapter
tests establish mechanics; they do not evaluate semantic recall quality.

## Curated memory workflow

Open a Project conversation and expand **Project memory**. Add a human-authored
note, or choose a source message and enter an exact excerpt. An optional edited
note preserves the original message reference and digest. Titles are limited to
256 characters; bodies to 8 KiB. The server resolves registered sessions itself
and rejects invented excerpts and browser-supplied paths.

Project conversations default to **Curated memory** in the GUI. Select notes to
prioritize them, then use **Preview next run** to inspect the exact rendered
context and exclusions. Selection is whole-entry: explicit selections first,
then most recently updated entries with ID tie-breaking, at most 16 entries and
2,048 tokenizer tokens. Explicit selections that cannot fit fail visibly;
automatic exclusions carry reasons. The configured model input policy still
validates the actual prepared request, including other context and tools.
A preview binds the memory generation; if notes change before admission, preview
again. Without a preview, a run captures the current eligible generation.

**Edit** changes future runs. **Stop using** retires a note; **Restore** checks
its linked sources again. Moving or unlinking a source conversation retires
its derived notes. Missing, changed or unavailable sources are excluded. Corrupt
or ambiguous source files cause a preparation error. Source reads are bounded
and coordinated with writer ownership; an active source can require a retry
or **Off**. Idle source threads may be closed during inspection and are reopened
when their next application run starts.

**Off** omits fresh memory for the next run. It cannot remove quotations already
in conversation history. **Show recorded snapshots** displays the exact context
recorded for previous runs, including notes later edited or retired. A recorded
snapshot alone does not prove the provider received it. Secure erasure is not
provided by retirement, deletion of a source, or turning memory off.

## Run context and integration

`service.projectMemory` provides `create`, `saveExcerpt`, `edit` and `prepare`.
Writes require a UUID operation ID; edits also require the observed entry
revision. Preserve operation IDs on network retries and use a new ID for changed
input. Source references are immutable. `service.previewProjectMemory` performs
non-capturing preparation; `service.projectContextHistory` reads recorded context.

Pass `memory: {mode: 'curated', selectedIds?, expectedGeneration?}` to
`service.startRun`, `startGraphRun`, or a managed Agent configured with the
coordinating memory service. Library callers default to off unless they opt in.
Low-level callers must retain ownership of the destination Session during
capture. A bare legacy `invoke` host cannot execute curated memory.

Capture revalidates membership and memory generation in one catalog transaction.
The execution journal then acknowledges `run-admitted` and `project-context`
before managed effects. Such runs use journal **v3**; ordinary runs continue to
use v1, and Graph runs without memory use v2. A journal may contain runs of all
three versions. Transcript versions are independent and are not upgraded merely
to use memory. Graph execution retains its explicit transcript migration rules.
Readers predating journal v3 cannot consume these runs and must not be used for
maintenance of affected journals.

The context record is bounded to 256 KiB and contains exact entries, revisions,
provenance, exclusions, rendered text and a digest. Admission stores a digest of
configuration that includes the context digest, never raw provider/MCP settings.
An interrupted admission without acknowledged context is reported as interrupted
preparation; recovery observes it rather than automatically dispatching it.
A repeated admitted request returns its prior run without capturing newer notes.

Each model request in the run receives one fixed user-role memory prefix. The
prefix is untrusted historical data, separate from system instructions, canonical
messages and compaction source history. Tool iterations and Agent Graph stages
reuse it; edits are visible only to later runs. Existing verified-interruption
preflight and prepared-request checks remain in force.

GUI REST endpoints include `/api/projects/:id/memory`, `/memory/excerpts`,
`/memory/:entryId`, `/api/threads/:id/memory/preview` and
`/api/sessions/:id/project-context`. The same capability, origin, payload and
schema checks protect them. `project.memory.changed` carries entry revision and
Project generation metadata. **Refresh notes** reloads authoritative entries;
a stale revision never silently overwrites another edit.
