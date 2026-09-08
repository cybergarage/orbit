# Session storage registration, recovery and migration

Persistent CLI, GUI and library sessions require a registered pair of session and
execution-journal roots. Read-only inspection of older transcripts remains
available. A new installation must initialize storage before creating its first
persistent session. In-memory Sessions do not require this procedure.

## Initialize or migrate offline

Stop every CLI, GUI, library host and older Orbit binary using either root.
Disable their automatic restarters and establish exclusive administrative access
to the storage. Keep that external exclusion in place if this command crashes.
A dead PID, a process list or these command-line acknowledgements cannot prove
that another service will not restart; the operator owns that prerequisite.

For the default roots (`~/.orbit/sessions` and `~/.orbit/runs`):

```sh
orbit storage initialize --writers-stopped --restarters-disabled --exclusive-storage-control
```

For custom storage, pass `--session-root` and `--journal-root`. The default journal
for an explicit session root is its `.runs` child. Other overlapping pairs and
cross-binding nested roots are rejected. Root aliases resolve through filesystem
real paths; arbitrary lowercasing is not used to simulate Windows identity.

The same procedure is available to an embedding application:

```ts
import {SessionRepository} from 'orbit'

const repository = new SessionRepository({rootDir: '/srv/orbit/sessions', journalRoot: '/srv/orbit/runs'})
// Only after establishing offline exclusive control, never per request:
repository.initializeStorage({
  allWritersStopped: true,
  automaticRestartersDisabled: true,
  exclusiveStorageControl: true,
})
```

Initialization exclusively creates `.orbit-session-binding.json` in both roots,
containing version 1 and the canonical session/journal root identities. These
configuration records outlive per-session deletion and contain no conversation
content. Conflicting bindings fail; a partial reciprocal registration disables
writable admission. Rerun the offline procedure with the same roots to finish a
matching partial registration. Malformed/conflicting records require evidence
review, not blind overwrite. File and directory synchronization is required for
registration; unsupported storage must not be silently downgraded.

The procedure classifies old adjacent `.jsonl.lock` files and refuses unknown or
live owners. It removes only classified dead-owner files after both bindings
are synchronized. Existing transcripts keep their format and contents. Writable
transcripts must use the exact root/year/month/day layout, matching timestamp and
Session ID, with one transcript per ID and no hard links or ambiguous aliases.
Import other layouts under a fresh ID instead of bypassing validation. Old
binaries ignore the new protocol, so mixed-version writing is unsupported.
Rollback also requires stopping every writer and reviewing retained state.

## Normal acquisition and cleanup

`SessionRepository.scope(id)` issues a validated scope for its registered roots.
Low-level `SessionRecorder.create(file, header, scope)` and `open(file, scope)`
require that scope; the old path-only mutation and arbitrary prepare callback
are removed. The recorder performs defined transcript validation/repair under
ownership. Repository reads do not register or repair storage.

Every owner transition uses `<session-root>/.coordination/<id>.guard`; the owner
is `<id>.owner` in the same directory. Guards are short-lived and created with
exclusive file creation. A competitor rejects without removing the guard.
Under its guard, a contender may remove a well-formed owner whose PID is
positively absent, then install its own PID/token. Live or unknown owners reject.
Rejection releases only the rejecting attempt's guard. Inspection never removes
stale evidence. `SessionRecorder.isOpen(file)` retains its read-only argument,
returning conservatively true for any owner/guard or unresolved identity/error.
`isSessionLocked(scope)` is also a snapshot, never writer permission.

The owner remains through transcript writes and journal leases; model, MCP and
human waits do not retain the short guard. Close stops new writes and waits for
known I/O and borrowed leases before removing its owner under a guard. Repeated
close calls coalesce; a failed cleanup can be retried without reopening writes.
`retrySessionCleanup(scope)` resumes only a previously requested cleanup,
including failed admission where no recorder was returned. It cannot close an
active writer. Owner/guard identity and creator tokens prevent a retry from
removing replacement ownership. Failed cleanup may require offline recovery;
it does not rewrite an already immutable managed-run result.

## Persistent journal and deletion APIs

Use `Session.acquireWriterLease()` (or a recorder's typed `acquireManagedLease()`)
with `FileExecutionJournal.open(id, {root, lease})`. The old `releaseLease`
callback option is removed. The core validates session, binding, generation and
live ownership before journal or key I/O; copied, released and second-use leases
reject. A successfully consumed lease belongs to that journal until its I/O
settles. Calling the caller's release function then cannot release ownership
early. If validation rejects before consuming a valid lease (for example a
wrong root), the caller still owns it and must release it or retry with the
matching context. Loading failures after consumption release it automatically.
Custom journals remain trusted extension code responsible for their own I/O.

`SessionRepository.delete()` refuses mutation of an existing transcript and
directs callers to `SessionDeletionService` with their actual log store and
explicit retained-marker semantics. An absent session with no marker is a no-op.
CLI and GUI already use the service. The service holds the same Session-ID owner
through all asynchronous deletion steps and rechecks inventory and runtime
state after acquisition. Removing the transcript never switches the scope to
a marker filename. Retry returns the remaining summary or ID and preserves the
already accepted minimal `{version, sessionId, state}` deletion marker.

## Recover an abandoned guard

A guard left by a crashed transition is never reclaimed automatically. Stop all
writers/restarters and establish external exclusion as above, then run:

```sh
orbit storage recover SESSION_ID --writers-stopped --restarters-disabled --exclusive-storage-control
```

Specify the same custom roots if applicable. The library equivalent is
`recoverSessionWriter(repository.scope(id), conditions)`. It checks the binding,
owner, deletion marker and journal evidence, rejects live/unknown owners or
conflicting/torn evidence, removes the identified stale owner first and the
guard last, and synchronizes the directory. Missing artifacts are tolerated on a
repeated attempt. It does not remove deletion markers, restore approval, infer
unknown outcomes or replay actions. Unknown partial owner records require manual
evidence review under the same external exclusion; there is no online force flag.

If interrupted, keep external admission disabled and repeat inspection/recovery
before enabling compatible writers. After the final guard unlink, the filesystem
protocol alone would allow admission; the external operator exclusion must still
hold until verification finishes. The test harness exercises this sequence in
isolated roots but cannot validate a production service manager's restart policy.

## Supported assumptions and remaining verification

The protocol assumes cooperating upgraded processes on one host, a stable PID
namespace and a local filesystem with the required exclusive-create and sync
semantics. It is not protection from arbitrary JavaScript or hostile filesystem
writers. Network mounts, separate PID namespaces, physical power-loss survival,
Windows/filesystem variations and representative product workloads require their
own verification. See the [recovery ADR](adr/2026-09-08-session-writer-recovery-guard.md)
for evidence and open conditions; acceptance and implementation are distinct.
