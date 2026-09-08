---
status: superseded
investigation-date: 2026-09-08
orbit-commit: f20d919bdbedb3e900156787856e3e4ea1644e60
related-adrs:
  - docs/adr/2026-09-08-session-storage-registration-guard.md
  - docs/adr/2026-09-08-session-writer-recovery-guard.md
superseded-by:
  - docs/research/2026-09-08-session-storage-registration-review.md
---

# Session Storage Registration Interruption

## Purpose

Investigate how a Session/journal root pair can distinguish durable registration
from two merely visible binding files. The existing defect is reproducible;
no remedy is implemented or approved by this note.

**Non-binding recommendation:** use persistent registration guards in both roots,
with a new binding version that requires that protocol. Resynchronize existing
binding contents during exclusive offline repair. A completion manifest is a
credible alternative, but it does not eliminate publication/acknowledgement
ambiguity or the need to invalidate an old registration before maintenance.

## Research Questions

- What evidence admits a writer today, and which interruption escapes it?
- Can absence of a newly introduced guard distinguish old successful and failed registrations?
- How do initial registration, repeated registration and repair order writes and syncs across two roots?
- What does a crash before or after the last marker transition mean for admission and operator restart?
- Which responsibilities remain with external maintenance exclusion?

## Orbit Baseline and Reproduction

Inspected local `f20d919bdbedb3e900156787856e3e4ea1644e60` on 2026-09-08.
The Orbit working tree was clean. There were no source/test/dependency differences
since diagnostic commit `5ee2265e239ef2f3135656ac6f520157af062e93`.
Public main still resolved to `80130cf194e477f136eefaa5b7cd2a2374dff198`;
these local implementations are not described as newly published.

Inspected source at that baseline:

| File                                                         | Symbols / evidence                                                                                                                                               |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/session/coordination.ts`                           | Binding, readBinding, validateBinding, writeExclusive, initializeSessionStorage, sessionScope, validateScope, WriterClaim, isSessionLocked, recoverSessionWriter |
| `src/core/session/repository.ts`                             | initializeStorage, scope, create/open and read-only discovery                                                                                                    |
| `src/core/session/recorder.ts`                               | scoped writers and conservative isOpen wrapper                                                                                                                   |
| `src/core/session/writer-lease.ts`                           | consumeWriterLease validates the live scoped owner                                                                                                               |
| `src/core/session/deletion-service.ts`                       | deletion acquires the same scope and preserves a separate deletion marker                                                                                        |
| `test/core/execution/recovery-guard.test.ts`                 | first-binding interruption coverage, registration and cleanup cases                                                                                              |
| `test/core/execution/fixtures/registration-interruption.mjs` | second-binding write checkpoint and independent post-interruption admission                                                                                      |

Fresh macOS arm64 / Node 26.5.0 headers:check and build passed. Running the unchanged
compiled diagnostic returned **exit 1**. A network-disabled Linux arm64 / Node
22.23.2 container with a read-only repository mount returned the same result,
using the host build for this diagnostic only; this was not another native build.

```text
node test/core/execution/fixtures/registration-interruption.mjs
{"childExit":73,"mode":"death","offlineResume":"succeeded","writableAdmission":"accepted"}
{"childExit":74,"mode":"sync-error","offlineResume":"succeeded","writableAdmission":"accepted"}
```

The fixture asserts no child timeout/error and the exact exit checkpoint. It
terminates immediately after the second binding write, or injects its fsync
failure. Both reciprocal JSON files are visible, so a new repository creates a
writer before offline resumption. The fixture's later initializeStorage success
does **not** prove that existing binding contents were resynchronized.

The full macOS `npm test` passed **397 tests**, with 0 lint errors / 12 warnings.
It does not include this independent failing diagnostic. Format/lint produced no
source changes. No runtime or test file was modified for this investigation.
Earlier Linux native builds, UI trials and the fixed date-dependent log test
remain separately dated evidence, not reruns in this investigation.

## Findings

### Visible binding equality is not registration completion

`validateBinding` requires matching version-1 JSON in both roots.
`writeExclusive` writes, fsyncs the file and then syncs its directory; the gap
between the second write and that sync is externally readable. There is no
persistent registration-in-progress record. The existing first-binding test
rejects because one counterpart is absent and cannot establish the second case.

Repeated initialization compares an existing binding but only syncs directories.
A repair protocol must open, validate and fsync each existing binding file as
well as directory entries. Re-reading JSON or receiving an API success is not a
substitute for these operations. The required-execution-journal storage level
must not be weakened to conceal a registration failure.

### Legacy data needs an explicit transition

Guard absence on version-1 storage cannot distinguish an old successful
registration from the reproduced interrupted registration. Keeping v1 writable
with an optional new marker leaves precisely this ambiguity. A new format must
refuse writable v1 admission until offline conversion, while retaining read-only
transcript access without implying writable readiness. At this baseline, the old
reader rejects any binding version other than 1; that helps after conversion but
does not protect the interval before conversion. Stop old binaries and all
restart sources throughout migration and maintenance.

### Completion, durability and acknowledgement need separate definitions

For guards, first make both guards durable, then make both bindings durable,
then remove guards. Absence of the last guard can become visible before the last
directory sync returns. At that point binding data was already synchronized;
if a power failure resurrects a removed guard, reopening refuses conservatively.
A final sync failure or lost process response can therefore coexist with a
logically ready registration. Attempting to recreate a guard on error cannot
close a process-death interval retroactively.

A manifest has the analogous issue: publish only after prerequisites are synced,
but its name is visible before publication-directory sync returns. A second
"acknowledged" file merely repeats the issue. Neither scheme can make on-disk
admission equivalent to the caller having received success. External admission
must remain stopped after any uncertain outcome until exclusive inspection and
resynchronization finish. This is a proposed clarification of the recovery ADR's
completion wording, not permission to weaken its adopted rationale silently.

## External Systems Investigated

The following pinned sources were re-read on 2026-09-08 from the previous
investigation's downloaded source set. No new upstream revision or external
runtime experiment is claimed.

### Codex

Revision `5adb68a49933ae446bf11935662c83dba55a0804`:

- `codex-rs/rollout/src/compression.rs`, materialize_rollout_for_append_blocking:
  writes a temporary output and calls flush/sync_all before publishing it by
  hard link or persist_noclobber. This provides a concrete example of preparing
  data before making a final path visible. It is not a two-root registration
  transaction or evidence for all directory durability guarantees.
- The same file's CompressionRunMarker has timestamp-based stale handling and
  remove-on-drop behavior. That marker schedules compression; transferring its
  automatic reclamation to registration would contradict Orbit's fail-closed
  offline requirement.
- `codex-rs/rollout/src/maintenance.rs` holds a nonblocking OS-managed maintenance
  file lock separately from the scheduling marker and per-thread ownership.
  Mutual exclusion and durable recovery state are different responsibilities.
  An OS lock released by death alone cannot record unfinished registration.

### Pi Coding Agent

Revision `b79e4cc834970cca69daebffab7df1da7d1e52c4` (the prior `v0.84.4` pin),
`packages/coding-agent/src/core/session-manager.ts`: \_persist exclusively creates
an initial JSONL file with wx, then appends; \_rewriteFile truncates and writes.
These inspected paths do not explicitly fsync contents or implement reciprocal
root registration. Synchronous JavaScript I/O and initial exclusive creation
therefore offer no evidence for Orbit's adopted durability condition. This is a
limited source comparison, not a claim about every Pi persistence subsystem.

### Primary persistence documentation

[Node 20.19.0 fs documentation](https://nodejs.org/download/release/v20.19.0/docs/api/fs.html#fsfsyncsyncfd)
distinguishes file writing from explicit fsync. Platform and filesystem capability
must be tested; choosing a supported Node major does not establish directory
sync support on every storage device.

[SQLite's atomic commit explanation](https://www.sqlite.org/atomiccommit.html),
sections 3.7, 3.10, 3.11 and 5, describes flushing prerequisites before journal
removal and a super-journal for multiple database files. This motivates explicit
ordering and a completion point. It does not validate Orbit's protocol: SQLite
has its own locking and recovery, and ordinary independent root files are not
an SQLite transaction. Documentation was read on 2026-09-08; no SQLite benchmark
or source-version experiment was performed.

## Analysis of Options

| Option                                           | Strength                                                                                                                                        | Cost / limitation                                                                                                                        |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Durable registration guards + versioned bindings | Incomplete work remains explicit in either root; existing Session guards need no new OS dependency; repair is offline                           | Requires v1 migration, two-root sync ordering, conservative outage and a precise final-removal rule                                      |
| Committed registration manifest                  | Positive ready record can identify exact binding generation and content; immutable staged bindings avoid half-overwriting a selected generation | Needs authority placement, reciprocal discovery, generation invalidation and sync ordering; final publication is not API acknowledgement |
| External shutdown alone                          | No new format                                                                                                                                   | Does not meet programmatic rejection after the reproduced interruption; not recommended                                                  |
| Guard added without format change                | Small patch                                                                                                                                     | Old v1 pairs with no guard remain ambiguous; insufficient                                                                                |

For the guard candidate, place `.orbit-registration.guard` in **each** root,
outside per-Session deletion. Require both absent and matching v2 bindings before
issuing any writer scope. Each binding carries a stable pair ID and canonical
role-labelled Session/journal paths. Each guard identifies that pair and an
attempt; an empty, malformed or mismatched guard still blocks. No PID/age-based
online removal is allowed. A retry does not change the Session identity or permit
rebinding an existing root to another partner.

For the manifest alternative, use immutable generation-specific binding data in
both roots. Keep the authoritative `.orbit-registration.json` in the Session
root and a journal-side descriptor locating that authority and generation.
Both prerequisite files must be synced before publishing the authoritative ready
manifest via a temporary file in that root and same-directory rename. Normal
admission verifies generation, roles, paths and exact selected binding content
in both roots. A dangling journal descriptor or missing/mismatched manifest
rejects. Before re-registration, durably invalidate the old ready manifest
(e.g. replace it with pending and sync) **before** changing dependencies; a
manifest-only design cannot leave an old ready record authoritative throughout
repair. Publish a new ready record only after all replacement prerequisites are
durable. This has similar pending-state costs to guards. A manifest replicated
independently as two ready JSON files without this authority/order would repeat
the current bug. Roots may be on different filesystems; no cross-root rename is
assumed atomic.

The guard candidate is the smaller extension of the current one-to-one layout.
The manifest candidate is attractive if immutable generations and auditable
registration history become requirements. Those are not current accepted goals.
Neither option relaxes ownership, quiescence, journal acknowledgement, Session
deletion evidence or external shutdown.

## Implications for Orbit

A proposed ADR should specify the guard candidate's complete transition table,
not just introduce a filename. It must include existing-file resync, new-parent
directory durability, counterpart identity, old-data refusal, guard retention
on every pre-completion failure and exclusive repair of interrupted conversion.
Normal scope validation, Recorder, journal lease consumption, isLocked/isOpen,
Session deletion and maintenance must all recognize the registration state.

Author review must resolve the format migration cost and the completion-point
clarification. If the existing requirement is intended to mean that **every**
failed initialization, including after final publication, must leave internal
admission disabled until another successful API response, neither ordinary-file
candidate establishes that stronger property. A separately enforced admission
service or operational acknowledgement protocol would need additional research;
it must not be smuggled into a local fix.

## Risks, Limitations and Open Questions

This recommendation has source reasoning and a negative baseline probe, not a
proof or a passing implementation. File identity, aliases and sync behavior on
Windows remain unverified. External exclusion is an operator prerequisite, not
proven by three boolean arguments. Host process death and injected fsync errors
do not establish physical power-loss behavior. Disk failure, directory replacement
and raw writes outside Orbit are not made safe by a JSON marker.

Retain the four accepted / partial ADRs. A later implementation must still perform
the supported environment matrix, deployment admission/restarter interruption,
physical-storage fault work and representative long tests / actual model / slow
production MCP / human confirmation trials. The official Everything 2026.8.31
managed `$schema` refusal remains a separate compatibility issue; its successful
direct-client echo/delay trial does not close it. Initial profile limits are
unchanged and are not measured optima.

## Related Decisions and References

The [registration guard proposal](../adr/2026-09-08-session-storage-registration-guard.md)
records the candidate protocol and author choices. It remains proposed / not-started.

This is a follow-up to [Session Writer Recovery Review](2026-09-08-session-writer-recovery-review.md),
not a replacement of its writer-exclusion investigation.
The [accepted recovery ADR](../adr/2026-09-08-session-writer-recovery-guard.md)
records the original condition, diagnostics and unresolved environment evidence.
Its reasons and the three common runtime ADRs remain intact.

Book evidence (in the companion publication repository):
`books/ai/ai-orbit/analysis/orbit-sessions.adoc` (A06),
`books/ai/ai-orbit/analysis/orbit-observability.adoc` (A09), and
`books/ai/ai-orbit/analysis/orbit-application-example.adoc` (A11),
commit `d406295f01946741834fca2ccc08ae8fefd99dea`.

- [Orbit coordination source](https://github.com/cybergarage/orbit/blob/f20d919bdbedb3e900156787856e3e4ea1644e60/src/core/session/coordination.ts) (local commit; remote availability not asserted)
- [Codex compression](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/rollout/src/compression.rs)
- [Codex maintenance](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/rollout/src/maintenance.rs)
- [Pi session manager](https://github.com/badlogic/pi-mono/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/src/core/session-manager.ts)
