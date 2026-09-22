# Projects and Curated Memory

## Implementation status

The catalog storage layer is implemented. Application/session coordination,
GUI navigation and Run memory injection are not enabled yet. The accepted
[catalog](adr/2026-09-22-project-catalog-and-session-membership.md) and
[memory](adr/2026-09-22-project-memory-context.md) decisions describe that
remaining scope, not current application behavior.

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
