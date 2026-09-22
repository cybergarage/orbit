# Projects and Curated Memory

## Implementation status

Project catalog storage, registered session coordination and GUI navigation are
implemented. Curated memory rows are available in the store, but memory editing
and Run injection are not enabled yet. The accepted
[memory decision](adr/2026-09-22-project-memory-context.md) describes that
remaining scope.

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
evidence still requires the planned journal integration. Storage tests establish
transaction behavior, not recall quality or end-to-end memory availability.
