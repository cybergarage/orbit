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

Initialization registers `.orbit-session-binding.json` in both roots, containing
`version: 2`, a shared UUID `pairId` and canonical `sessionRoot` / `journalRoot`.
A v1 pair must be converted offline; equal v1 JSON never permits upgraded writers.
The pair ID remains stable across repeated initialization and explicit resume.
Transcripts, journals and minimal deletion records retain their existing formats.
The configuration records outlive Session deletion and contain no conversation.

The initializer creates and syncs `.orbit-registration.guard` in **both roots**
before writing registration data. It syncs existing binding files as well as new
ones. V1 conversion writes a same-directory temporary v2 file, syncs it, renames
it over the inspected original, and syncs that directory. Both final files and
all affected directories are synced before guard removal. There is no atomic
cross-root rename. Newly created ancestor directories are synced top-down along
with the directories containing their names. Resume also resyncs existing
ancestry: an earlier process may have died after mkdir before its parent sync,
before any guard existed to record that stage. Unsupported ancestor sync refuses
maintenance rather than skipping the prerequisite.

It removes the journal guard and syncs its root, then removes the Session guard
and syncs that root. Last guard removal is logical readiness, after all data
prerequisites. Successful API return additionally requires the final sync.
A failed sync or lost response after the last unlink can leave inspection showing
`ready`; **keep external admission and restarters disabled** and run the guarded
resync below before restarting. Internal readiness does not acknowledge receipt
of an API response or prove physical persistence after a power failure.

Any retained guard, including empty or malformed metadata, refuses scope creation,
writer/lease validation, cleanup and deletion. Retained binding staging files also
refuse admission. Ordinary initialization refuses interrupted registration rather
than silently claiming its guard. Existing v2 storage can be initialized again
only offline; that operation establishes new guards and resyncs both files.
Required file/directory sync failures never silently downgrade storage.

## Inspect and resume an interrupted registration

Read-only inspection takes configured roots, does not require a writable scope,
and does not repair or authorize anything:

```sh
orbit storage inspect --session-root /srv/orbit/sessions --journal-root /srv/orbit/runs
```

`repository.inspectStorage()` returns `unregistered`, `legacy`, `pending`, `ready`
or `conflicting`, canonical roots, and visible artifact paths and SHA-256 values.
It is a diagnostic snapshot, not evidence that writers or restarters are stopped.
The top-level equivalents are `inspectSessionStorage(S, J)` and
`resumeSessionStorage(S, J, conditions, options)`.

After restoring external exclusion and reviewing both roots, resume matching
partial metadata explicitly:

```sh
orbit storage resume --session-root /srv/orbit/sessions --journal-root /srv/orbit/runs \
  --writers-stopped --restarters-disabled --exclusive-storage-control
```

The library equivalent is `repository.resumeStorage(conditions)`. It validates
retained pair/attempt identities, restores any missing guard, syncs both guards,
resyncs both binding files and retries ordered guard removal. It also supports a
valid pair after uncertain acknowledgement. It neither obtains a writable scope
first nor recovers individual Session owners as a side effect.

Empty/torn metadata and unknown staging files require an **independent offline
review**, including configured roots, surviving records, stopped owners and the
interrupted invocation. If that evidence is sufficient to reconstruct this pair,
supply only the reviewed absolute artifact paths and their exact SHA-256 values
in a JSON file via `--reviewed-artifacts FILE`, or as
`{reviewedArtifacts: {[absolutePath]: sha256}}` to the resume API. Do not blindly
copy every inspection digest into an approval file: inspection cannot establish
that reconstruction is valid. The reviewed bytes must still match at use time.

Resume preserves anomalous bytes in `.orbit-registration-evidence-<sha256>.bin`
before repair. If an interrupted evidence copy already occupies that name with
different bytes, it remains unchanged and a new copy uses an additional UUID
suffix. A filename is not proof of a valid copy: verify the actual bytes/hash.
Source repair follows a successfully synced complete copy; incomplete copies
never authorize repair by themselves. It repairs a torn guard in place only after both guard names are
durable, so exclusion remains present. Reviewed staging files are preserved and
removed under those guards. Conflicting valid partner/pair/attempt records,
symlinks, hard links, unreadable artifacts and unknown/live ownership still reject;
digests do not override those checks. A second interruption retains evidence and
requires another inspection. There is no online force flag or timeout recovery.

Root paths and pair IDs describe logical relationships, not authenticated volume
identities. An observed root replacement during maintenance rejects. Copies or
restores to the same canonical paths between stopped processes cannot always be
detected; keep those operations excluded pending a separately reviewed migration.
Moving roots or changing a partner is not same-pair initialization.

The procedure classifies old adjacent `.jsonl.lock` files and refuses unknown or
live owners. It removes only classified dead-owner files after both bindings
are synchronized. Existing transcripts keep their format and contents. Writable
transcripts must use the exact root/year/month/day layout, matching timestamp and
Session ID, with one transcript per ID and no hard links or ambiguous aliases.
Import other layouts under a fresh ID instead of bypassing validation. Old
binaries ignore the new protocol, so mixed-version writing is unsupported.
Rollback also requires stopping every writer and reviewing retained state.

## Normal acquisition and cleanup

`SessionRepository.scope(id)` issues a validated scope for its registered v2 roots,
pair ID and Session ID. Acquisition and live lease checks revalidate both current
bindings and guard absence; a previously issued scope cannot bypass pending state.
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

## Recover an abandoned Session guard

A guard left by a crashed transition is never reclaimed automatically. Stop all
writers/restarters and establish external exclusion as above, then run:

```sh
orbit storage recover SESSION_ID --writers-stopped --restarters-disabled --exclusive-storage-control
```

Registration must be ready before Session recovery; finish root-level resume
first. Specify the same custom roots if applicable. The library equivalent is
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

Graph maintenance uses the same complete journal validation as execution, with
versions 1 and 2 allowed per Run. It refuses unacknowledged or unsettled original
terminals and checks bound Graph transcript positions before removing a guard.
A later settlement is separate evidence and does not rewrite that terminal.
Missing Graph transcripts or partial deletion evidence can therefore require
manual offline review; automatic recovery never discards a journal to proceed.
See [v3 migration](interrupted-context.md#exclusive-v2-to-v3-migration) for the
byte-preserving conversion and response-unknown restart conditions.

## Supported assumptions and remaining verification

The current verification focus is Linux/macOS. Windows and other environments
are deferred. Representative application trials await the coding agent or a
future autonomous application; real operational exclusion and physical-failure
trials await a target deployment, storage and SLI/SLO. These deferrals are not
passing evidence and do not relax runtime storage requirements.

The protocol assumes cooperating upgraded processes on one host, a stable PID
namespace and a local filesystem with the required exclusive-create and sync
semantics. It is not protection from arbitrary JavaScript or hostile filesystem
writers. Network mounts, separate PID namespaces, physical power-loss survival,
Windows/filesystem variations and representative product workloads require their
own verification. See the [recovery ADR](adr/2026-09-08-session-writer-recovery-guard.md)
for evidence and open conditions; acceptance and implementation are distinct.

Registration ordering and acknowledgement evidence are recorded in the
[registration ADR](adr/2026-09-08-session-storage-registration-guard.md).
