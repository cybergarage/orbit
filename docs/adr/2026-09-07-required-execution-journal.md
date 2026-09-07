---
status: accepted
proposed-date: 2026-09-07
decision-date: 2026-09-07
implementation-status: partial
implementation-completed-date: null
implementation-commits:
  - 61723f07e2f6318a352dcaacd16e9b88b7ad94fa
  - 7f26357d3afd9f14e7316352f7cc5483a387a2c3
  - 8ffef065251a0b04c0810f67a5318502c6be4df6
superseded-by: []
---

# Required Execution Journal

## Purpose

Record whether a run and an operation were admitted, what authorization was
used, and which effects/results remain known after a save failure or restart.
A best-effort diagnostic log and a transcript cannot provide that contract.

## Decision

**Accepted on 2026-09-07; implementation partial, with confirmation remaining.** Add a required execution
journal distinct from the
conversation transcript and optional operational logs. Core must acknowledge
admission and operation intent before dispatch, and acknowledge required results
before reporting a persistently completed run. Journal failure stops new work
and remains visible in the returned result. It does not roll back effects.

### Contract and record format

Introduce a versioned `ExecutionJournal` contract with asynchronous admission,
append acknowledgement, read/query, synchronization barrier, and close operations.
The initial implementations are a file-backed journal and an explicitly selected
memory journal for ephemeral sessions/tests. Both share validation and ordering;
only file mode claims restart-readable records. Ephemeral mode reports
`recording.mode = memory`, never `durable`, and requires no new transcript files.
A product must not silently switch from file to memory after a storage error.

File mode stores per-run JSONL under
`~/.orbit/runs/<session-id>/<run-id>/events.jsonl` (with an injectable root).
Directories/files are private to the OS user where supported. A version-1 header
identifies the run, session, request ID, recording mode, and schema. Subsequent
records contain increasing sequence, event ID, wall-clock timestamp, monotonic
elapsed time, kind, correlation IDs, and kind-specific bounded data. Sequence,
not wall-clock time, defines order. Unknown versions are rejected for execution
and may be exposed read-only for diagnosis.

| Record kind             | Required information and acknowledgement point                                                                                                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run-admitted`          | Request ID and keyed input digest, frozen configuration/policy and declared source identities, finite limits; acknowledged before returning accepted admission, with no resolved remote catalog claim.                                    |
| `run-ready`             | Resolved validated catalog identity and initialization completion; acknowledged after required MCP discovery and before the first model invocation.                                                                                       |
| `approval-requested`    | Opaque operation/request IDs, keyed descriptor digest, policy rule/reason code, generation, expiry, responder scope; acknowledged before exposing a pending decision.                                                                     |
| `authorization-decided` | Allow/deny/ask reply identity, rule/responder identity, operation binding, and validity; acknowledged before an allow can be consumed.                                                                                                    |
| `operation-intent`      | Operation/call/source identity, authorization reference, keyed descriptor digest, effect class, budget reservation; acknowledged before handler dispatch.                                                                                 |
| `operation-result`      | Not-started, succeeded, failed, or unknown effect status; bounded result/error references and partial effects known to core. Invalid/denied calls also have explicit non-dispatch outcomes.                                               |
| `stop-requested`        | First accepted stop reason/time and later causes as observations. Cancellation signalling is immediate and never delayed by failed storage.                                                                                               |
| `run-terminal`          | One terminal execution summary, operation outcomes, quiescence, prior save/cleanup status, and acknowledged transcript high-water reference if a transcript exists. The record does not assert that its own acknowledgement was received. |
| `late-settlement`       | New evidence about an unresolved operation after the terminal result; references the original result and does not rewrite it.                                                                                                             |

A result references transcript entries or other application-owned artifacts
rather than duplicating full prompts, tool output, patches, or credentials.
MCP startup records carry a core startup ID and configured server identity;
model call ID and resolved catalog fields are absent, not invented. Tool-call
records bind the catalog acknowledged by `run-ready`. Replay validation enforces
this ordering and never infers startup permission from later catalog membership.
Application-specific evaluation data remains a separate concern.

### Acknowledgement and file ownership

`append` resolves only after the selected acknowledgement level succeeds for
complete record bytes and all preceding records. File mode requires an explicit
level: `file-sync` or `file-and-directory-sync`; memory mode uses `memory`.
Record mode, selected level, and achieved capability in admission and returned
recording status. Default persistent product configuration requests
`file-and-directory-sync`. If that level cannot be provided, reject admission;
selecting a weaker level is an explicit application-owner setting, never a
fallback after an I/O error. Directory synchronization covers newly created
ancestor entries needed to reach the session/key/run files, not just the final
JSONL directory. Report filesystem capabilities rather than assuming an OS name
proves them. No level claims universal survival of hardware/controller failure.

Required synchronization includes a newly created session HMAC key before any
acknowledged record refers to it. Reuse a valid existing key; never regenerate
one while records bound to the old key remain. Inability to read/create/sync the
key rejects durable admission. A memory acknowledgement means retained by that
instance. All acknowledgement waits share the supervisor deadline and retain
writer ownership when a timed-out write may still complete.

One owner holds session write authority for transcript, admission index, and
journal. Extend or coordinate the existing SessionRecorder writer lock; do not
introduce a second uncoordinated owner that can deadlock against an already-open
Session. A borrowed persistent Session must explicitly delegate that same lease
or be rejected for managed durable execution before starting work. Another
process gets busy/read-only rather than a concurrent writer. The managed owner
retains leases across incomplete close while any write/cleanup remains active.
Stale-lock reconciliation requires evidence the owner is gone, never elapsed
time alone, and checks unresolved journal entries before allowing new work.
This protects session records, not all files in the workspace or arbitrary
legacy code that bypasses the managed API.

Keep per-session request-ID mappings for as long as the corresponding journal
is retained. Rebuild them from admitted records, so a crash between indexing and
acknowledgement does not create a second run. An acknowledged request with the
same keyed submitted input/options returns the recorded run; conflicting input
is rejected. This request digest excludes later ambient configuration resolution
and the discovered catalog. Those have their own frozen identities in the
records. Perform duplicate lookup before resolving a new configuration or
starting any resource, so retrying an accepted request cannot start a second MCP
client after an environment change.
A persisted admission without any operation intent is still incomplete after a
restart, and its request ID returns that state rather than starting work. IDs
are unique client-generated values, not reusable prompt shortcuts. After session
deletion, the session cannot accept new runs; a new session has a new identity.

There is no atomic transaction across transcript, journal, and external effects.
Before `run-terminal` claims completed file-mode recording, synchronize the
required transcript entries through a new explicit synchronization capability,
then write/synchronize the terminal journal record with their high-water
reference. Preserve existing transcript entry formats and normal flush behavior;
add a capability rather than quietly redefining every existing flush as fsync.
If either barrier fails, return a save failure with the known execution result.
Do not append a misleading second terminal success/failure to compensate.

The terminal record stores the execution summary and prior barrier evidence,
not a claim about receipt of its own acknowledgement. The live supervisor derives
its one immutable RunResult after that acknowledgement succeeds or fails. If an
acknowledgement is lost after a complete terminal write, the live result reports
recording uncertainty/failure. Recovery may expose that same stored execution
summary with separately labeled recovered recording evidence; it must not claim
that the original caller received a success. Use the same terminal event ID when
reconciling a lost acknowledgement, and never dispatch work to resolve it.

### Failure and restart behavior

| Failure point                                       | Required behavior                                                                                                                                                    |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before run admission acknowledgement                | Return admission failure; start no model, tool, or MCP process. If acknowledgement is lost after commit, the request ID resolves the ambiguity.                      |
| Before operation intent acknowledgement             | Do not dispatch that operation. Close further admission and preserve any earlier effects.                                                                            |
| During/after dispatch before result acknowledgement | Record or return known results, mark recording failed, and stop new work. Missing durable outcome remains unknown on recovery. Never retry the effect automatically. |
| Optional logger/observer failure                    | Report sink health separately; do not change the run's work outcome or synthesize successful required recording.                                                     |
| During finalization/close                           | Collect failures in RunResult/close report, attempt remaining cleanup, and retain recoverable writer state. Do not erase the original execution error.               |

A failed append poisons admission until explicit recovery. Preserve the failed
record's ID and unwritten data for reconciliation; a retry of the same journal
record is not a retry of the external operation. The writer must recognize an
already fully committed event ID after a lost acknowledgement and reject a
conflicting payload. Never continue blindly appending after a partial line.

On startup, validate header, ordering, complete JSON lines, and IDs. Preserve the
original file when a torn suffix or conflict is found; expose read-only recovery
evidence and block continuation rather than silently truncating history. A
missing terminal result is an interrupted/incomplete run. An intent without a
result means the effect may or may not have happened, even if the handler might
not have started. Pending approvals expire on restart. Reconcile by inspecting
the target and explicitly starting a new run; do not replay recorded commands.
A recovery observation may resolve uncertainty but does not invent a past result.
Incomplete local writes/cleanup must settle or be reconciled before releasing
writer ownership. Unknown external completion additionally needs evidence from
the target/resource owner; acknowledging the warning is not proof of termination.
Validated records can be re-exposed as recovered evidence. Their presence alone
does not prove the original caller received an acknowledgement or that an
unconfirmed synchronization barrier completed.

When storage is unavailable, the in-memory terminal result is still returned
with failed recording and known effects. Core must not promise that the failure
itself is durably saved into the failed store. CLI/GUI must show that limitation.

### Privacy, retention, and deletion

Required records default to metadata and bounded identifiers/reason codes. Keep
full operation data only in the private live runtime and disclose the required
non-secret contents to the authorized approval responder. Store a versioned
HMAC-SHA-256 digest using a private per-session key for equality bindings involving
secret-bearing input; a plain public hash could expose guessable secrets. The
key is stored separately with private file permissions and is removed with the
session. Missing keys prevent approval reuse and request-ID comparison; recovery
becomes read-only until explicitly resolved, never automatic redispatch.

Durable audit evidence can answer which operation identity/policy/decision was
used, but cannot necessarily reconstruct the full edit or command after restart
from metadata alone. Link available transcript/artifact evidence and explicitly
report unavailable details. This bounded evidence is sufficient for initial
restart safety; a full encrypted payload archive is a separate privacy decision.
The journal is not tamper-proof against its OS user or arbitrary code in-process.

Do not apply the optional diagnostic store's drop/rotation policy to required
records. Retain complete run journals until explicit session deletion in the
initial version; a full filesystem stops new admission. A capacity limit reports
failure rather than dropping evidence. Retention automation is deferred.
Session deletion closes admission, rejects active/quarantined sessions, and
acquires the same session writer ownership. Before removing data, acknowledge a
minimal deletion marker at `~/.orbit/runs/deletions/<session-id>.json`, outside
the artifacts being removed. It contains only schema, session ID, and deletion
state; its synchronization follows the selected file level. If that marker
cannot be saved, remove nothing. Admission/resume consult the marker first.
Remove transcript, optional logs, then run records/key through the deletion
service. Partial deletion returns affected/remaining artifacts and can retry
after restart from the marker even when the transcript or key is already gone.
Report success only after absence of all target artifacts is confirmed, then
retain a minimal completed marker to prevent that session ID from being reused.
The marker is disclosed as retained deletion metadata, not described as complete
erasure of every identifier. Automated marker retention is a separate policy;
no undeclared transcript or secret content may remain in it.
Existing sessions with no journal remain readable and may start new managed
runs, but old operations have unknown authorization provenance.

### Acceptance and relationship to earlier decisions

The author explicitly accepted the reviewed recommendation on 2026-09-07,
including required separate recording, unsupported-storage rejection, the
metadata retention policy, and the minimal marker retained after deletion.
The file-and-directory-sync default is an accepted starting product choice,
not a claim that every filesystem supports it. At acceptance, implementation was not started.

[Session Persistence](2026-08-22-session-persistence.md),
[Session-scoped Logging](2026-08-25-session-scoped-logging.md), and
[Session Records versus Runtime Logs](2026-08-25-session-versus-runtime-log-content.md)
remain accepted for their existing transcript and optional-log contracts.
This decision adds a third artifact family, coordinated writer ownership,
explicit synchronization barriers, and deletion/recovery participation for
managed runs. It neither rewrites their historical rationale nor converts
optional logs into mandatory records. Current transcript/log guides continue to
describe implemented behavior until this extension is delivered.

## Consequences

- Positive: saving a required intent and result has a defined acknowledgement;
  recovery can expose ambiguity without replaying potentially completed effects.
- Negative: extra writes/synchronization, a third artifact family, writer locks,
  key ownership, disk growth, and explicit failure handling add latency and
  implementation complexity. File mode may refuse work during storage failure.
- Neutral: optional logs keep their existing diagnostic role, and transcript
  formats remain readable. The journal is not a distributed transaction or
  compliance-grade audit service.

## Context and Problem Statement

At Orbit `8ee97144c20b006225db52efc482004200527e4c`, SessionRecorder queues
append operations. FileSessionLogStore can drop at capacity and catches writer
failures; flush reports those failures but close does not propagate them in the
same way. Agent appends a completed phase before its terminal flush and may then
enter a failure path. A03/A09/A13/A11 require mandatory execution evidence to be
separated from optional observation. Existing accepted logging ADRs explicitly
separate transcript and runtime-log purposes; this decision adds a third data
contract rather than changing all logs into required records.

## Decision Drivers

- Fail before starting an operation when its required admission cannot be saved.
- Report known effects separately from unknown durable outcomes.
- Preserve existing session reads and optional diagnostics.
- Avoid secret duplication and automatic replay after ambiguous failure.

## External Implementation Research

Source inspection on 2026-09-07 used Codex
`5adb68a49933ae446bf11935662c83dba55a0804` (`rust-v0.152.1`) and Pi
`b79e4cc834970cca69daebffab7df1da7d1e52c4` (`v0.84.4`).
Codex `codex-rs/rollout/src/recorder.rs` acknowledges flush/shutdown commands and
retains unwritten suffixes on errors. Adopt explicit writer acknowledgements and
recoverable failed writes. Its `core/src/tasks/mod.rs` warns and continues on
some terminal flush failures; do not adopt that behavior for required admission.
Pi `packages/coding-agent/src/core/session-manager.ts` writes synchronous JSONL
and can defer materialization until an assistant message exists. Retain the
separation of session content from control records; do not infer fsync or
write-ahead authorization from synchronous append. Neither comparison proves
exactly-once external effects, a private HMAC ledger, or this new journal schema.

## Considered Options

| Option                                                         | Advantages                                                                | Costs and disposition                                                                                                |
| -------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Use current diagnostic logs                                    | Reuses existing storage and GUI.                                          | Drop/retention/failure semantics cannot provide required admission. Not recommended.                                 |
| Put all control records in the transcript                      | One artifact and existing session IDs.                                    | Couples model-context history and control/privacy evolution; broad reader migration. Not recommended for this scope. |
| Separate required JSONL journal with explicit acknowledgements | Small local deployment, distinct semantics, preserved transcript readers. | New lifecycle and synchronization complexity. Selected.                                                              |
| Transactional database for all state                           | Stronger local transactions/indexing.                                     | Major storage migration, still not atomic with remote effects. Defer until scale/recovery requirements justify it.   |

## Implementation and Confirmation

### Implementation evidence — 2026-09-07

Implementation status is **partial**, not completed. The code and maintained
guides are committed; the remaining confirmation below prevents a completion
date. Acceptance and its rationale are unchanged.

- `61723f07e2f6318a352dcaacd16e9b88b7ad94fa`: shared execution, permission,
  journal/recovery/deletion, CLI/GUI/library integration, public exports,
  maintained architecture/concepts/feature guides and contract tests.
- `7f26357d3afd9f14e7316352f7cc5483a387a2c3`: explicit legacy migration and
  locally validated MCP argument admission tests.

The version 1 JSONL writer records admission/ready, authorization, intent,
known outcome and terminal transcript high-water evidence. Persistent runs
reuse SessionRecorder ownership, synchronize the key and required ancestors,
and refuse unsupported acknowledgement without fallback. Reopening preserves
partial bytes and recognizes existing event IDs. Read-only inspection, recovered
snapshots, explicit reconciliation and retained deletion markers are exposed.
Deletion uses the selected file level and retries after transcript/key removal.

Validation on macOS arm64, Node v26.5.0: `npm run headers:check`,
`npm run build` and `npm test` passed; the final suite has **351 passing tests**.
Lint reported 10 complexity/parameter/style warnings and no errors. Reviewed
formatter output and `git diff --check` passed. `npm run prepack` regenerated
command documentation; its tool-update notice is not a build failure.

Evidence lives in `test/core/execution/{run,contracts,agent,storage,restart,retries}.test.ts`
and `test/apps/gui/execution.test.ts`, together with the updated existing tests.
Subprocess fixtures exit at admission, intent, external-effect, result and
terminal checkpoints and prove zero redispatch after restart. The real stdio
fixture verifies child termination. Browser testing verified a bound write
preview, reload/reopen while awaiting approval, one approval, and a completed /
acknowledged result. The TTY confirmation fixture returned true on `y` and false
on Ctrl+C. No provider credentials or external production MCP service were used.

A five-run utilization sample repeated against the committed implementation
at 12:02 UTC on 2026-09-07 used a deterministic model
and actual read/write/Bash operations under the unchanged default limits. Each
run used 4 model calls, 3 tool requests and 3 rounds and completed. Wall times
were 455.6–1119.4 ms (median 1112.5 ms). The 70 strong-sync journal acknowledgements
were 5.6–107.7 ms (median 62.8 ms) on the host temporary filesystem (statfs type 26).
These small warm-host samples are not optimality estimates, percentiles for a
production population, or measurements of live model latency.

### Follow-up verification — 2026-09-07

Commit `8ffef065251a0b04c0810f67a5318502c6be4df6` adds targeted MCP and process tests,
real Ink/GUI fixtures, local schema/UI corrections, and the separate failing
stale-lock probe. Acceptance, decision date and initial product limits are
unchanged. Implementation remains **partial**, with no completion date.

`headers:check`, `build` and `npm test` passed on macOS arm64 / Node v26.5.0
and an isolated Linux arm64 / Node v24.16.0 container. Both suites reported
**372 passing tests**; lint had zero errors and 10 existing warnings. The Linux
copy used `npm ci --ignore-scripts` from the unchanged lockfile. The separate
`node test/core/execution/fixtures/stale-lock-race.mjs` probe **failed exclusion
on both platforms** (exit 1, both children reported `owned`). The passing suite
does not include or cancel this negative evidence.

| Confirmation | Source and execution evidence | Limit |
| --- | --- | --- |
| Memory/file ordering, idempotency, torn writes, lost acknowledgement and missing keys | `test/core/execution/{run,contracts,storage,restart}.test.ts` passed again. | Process-exit and injected I/O faults are not power-loss tests. |
| Required sync capability and no fallback | Existing storage tests exercise rejected levels, key/ancestor sync failure and explicit weaker selection. | Direct directory-sync behavior was exercised on macOS/Linux, not Windows. |
| Lease retention and competing live writer | `process-storage.test.ts` starts a separate owner, requests close while its journal lease remains, rejects another writer/deleter, then recovers after process exit. | Sequential stale recovery alone does not establish concurrent recovery safety. |
| Deletion interrupted after each stage | Five actual subprocess exits after initial marker, log deletion, transcript removal, journal/key removal and completed marker all resumed; the minimal marker remained and ID reuse failed. | File-sync was explicitly selected; additional platforms remain unverified. |
| Simultaneous stale-lock reclamation | `fixtures/stale-lock-race.mjs` under the execution tests reproduces two simultaneous live owners on macOS and Linux. | **Failed guarantee; unresolved.** Passing fault/restart tests do not justify completed status. |
| Acknowledgement overhead | The managed-run ADR records the 3-run delayed-workload sample: 66 strong-sync acknowledgements, median 8.3 ms. | Small host sample, not a storage capacity or power-loss guarantee. |

### New finding: simultaneous stale-lock reclamation

`src/core/session/recorder.ts` reads a dead owner's token/PID and later unlinks
the lock path in `acquireLock`; `isLocked` also removes stale locks. The check
and unlink are separate operations. The probe pauses two child processes after
both read the stale record, allows A to unlink/create its live lock, then allows
B to unlink that replacement and create another. Both report ownership while
alive. The journal delegates this same recorder lease. This establishes an
exclusion defect; concurrent journal corruption is a possible consequence, not
a separately observed corruption result in this probe.

This predates the current local fixes. It contradicts the required single-writer
condition and must be resolved before completion. The new finding does not
rewrite the accepted reason for keeping transcript and journal ownership
coordinated. A token re-read before unlink alone still leaves a check/unlink
race and is not an adequate remedy.

| Follow-up option (not adopted) | Benefit | Cost / required confirmation |
| --- | --- | --- |
| Exclusive recovery guard covering every stale-removal path; abandoned guard fails closed and needs explicit offline recovery | Retains the current recorder/journal lease arrangement and can serialize reclaimers. | Adds recovery state and a blocked-recovery procedure; ordinary acquire, isLocked, deletion, guard crash and migration must all participate. |
| OS-backed process-lifetime locks with a supported cross-platform implementation | Kernel releases ownership after process exit; avoids PID-file reclamation as the exclusion primitive. | Platform support/dependency and filesystem semantics need research, tests and a new decision. |
| Keep current code and serialize recovery externally | Immediate operational restriction, no format change. | Not a correction or a sufficient completion basis. |

Recommendation: prepare a research-backed proposal for the exclusive recovery
guard first, explicitly comparing an OS-backed lock. Do not automatically
reclaim an abandoned guard through the same unsafe check/unlink pattern. The
author must decide the recovery/compatibility cost before implementation; no
option is accepted in this record. Resume with the deterministic probe and
require one owner, then test interruption of the recovery mechanism itself.

### Confirmation remaining before completed

- Concurrent stale-lock reclamation is a **known failing** exclusion condition,
  not merely untested platform behavior. The recovery decision above and its
  implementation are required before completion.
- Windows filesystems and the remaining supported Node versions require direct
  sync-capability, lock and deletion/cleanup trials. Resume on a configured
  Windows runner; unsupported strong-sync must still reject without fallback.
- No physical disk failure/power-loss test was performed. Controller/hardware
  survival is not claimed. Broader storage/load measurements and recovery
  interruption combinations are still required beyond the bounded host fixtures.

The implementation reference is [Managed Execution](../execution.md), with
[current architecture](../architecture.md), [Agent Runtime](../concepts/agent-runtime.md)
and [coding tool migration](../tools.md). The following original checklist is
retained as acceptance history; it must be reconciled case by case, not marked
satisfied merely because the aggregate suite passes.

### Original acceptance checklist

At acceptance, implementation had not started. Baseline validation passed headers/build and
293 tests; this validates no target journal guarantee. Implement
writer contract and failure/recovery tests, then integrate admission, operation
intent/result, terminal barriers, queries, and deletion with the supervisor.
Update session/log/privacy guides, concepts, architecture, and public exports.
Existing accepted logging history stays intact; implementation documentation
must distinguish required records from best-effort operational capture.

Required confirmation includes memory/file contract parity; lost acknowledgement
after a complete write; short/partial write; failed append/sync/directory sync;
duplicate event ID; a crash at each point from intent through terminal record;
lock contention/stale locks; secret-value absence and missing key; no automatic
memory fallback; and deletion failure after only some artifacts were removed.
Inject faults deterministically first. Add subprocess restart tests showing that
unknown effects never trigger redispatch. Physical power-loss behavior and
platform-specific synchronization must be measured separately, not inferred from
passing mocked I/O tests. Measure acknowledgement overhead before product limits
are finalized. Additional required cases cover unsupported acknowledgement levels
with no silent downgrade, ancestor/key synchronization failure before admission,
existing Session lease delegation, a write settling after close returns, deletion
interrupted after each removed artifact, and duplicate requests after ambient
configuration changes. These are unimplemented acceptance criteria, not tests
performed by the document review.

### Minimal scope and trade-off after review

The author accepted a separate journal over reusing droppable logs on 2026-09-07.
Its minimum
recoverable scope includes admission/ready ordering, key ownership, session writer
coordination, and partial-deletion handling; none is implied by choosing JSONL.
A smaller memory-only first implementation is an alternative, provided it is
explicitly labeled ephemeral and does not claim persisted confirmed execution.
A database may simplify local transactions but does not remove uncertainty about
external effects, and still requires a separate storage decision. The acceptance includes this recovery and
synchronization cost; JSONL alone
does not establish the durability contract.

## Follow-up Work

On 2026-09-07, the author accepted a separate journal, fail-closed durable
admission, metadata-only evidence after restart, retention until explicit
deletion, and the minimal retained deletion marker. The accepted persistent
product default is file-and-directory-sync with rejection on unsupported
storage; weaker levels still require explicit application-owner configuration.
Storage primitives, supported-platform sync capabilities, and key/lock recovery
need implementation confirmation. This decision does not select automated
retention, encrypted full payload archives, global workspace locking, or a
transactional database. It can be reviewed independently of the particular
approval UI but must integrate with the other two contracts before the complete
persistent editing workflow is delivered.

## References

- [Research and source ledger](../research/2026-09-07-run-execution-approval-and-recording.md).
- [Managed Run Lifecycle](2026-09-07-managed-run-lifecycle.md).
- [Prepared Operation Authorization](2026-09-07-prepared-operation-authorization.md).
- [Accepted session persistence](2026-08-22-session-persistence.md).
- [Accepted session-scoped logging](2026-08-25-session-scoped-logging.md).
- [Accepted session versus runtime log contract](2026-08-25-session-versus-runtime-log-content.md).
- [Current SessionRecorder](../../src/core/session/recorder.ts), [FileSessionLogStore](../../src/core/logs/file-store.ts).
- [Pinned Codex `codex-rs/rollout/src/recorder.rs`](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/rollout/src/recorder.rs).
- [Pinned Codex `codex-rs/core/src/tasks/mod.rs`](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/core/src/tasks/mod.rs).
- [Pinned Pi `packages/coding-agent/src/core/session-manager.ts`](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/src/core/session-manager.ts).
