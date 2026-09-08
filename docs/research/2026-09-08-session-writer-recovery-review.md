---
status: current
investigation-date: 2026-09-08
orbit-commit: b6391c8d895e37a58bff4dc39b29610e230fc7ad
related-adrs:
  - docs/adr/2026-09-08-session-writer-recovery-guard.md
superseded-by: []
---

# Session Writer Recovery Review

## Purpose

Review the recovery proposal against every ownership entry point and its
compatibility costs. This note supersedes the earlier investigation as the
current decision input; the [original source ledger and failed probe](2026-09-08-session-writer-lock-recovery.md)
remain historical evidence. No architecture is approved or implemented.

**Finding:** guarded transitions remain a viable conditional recommendation,
but the original proposal omitted rejected-acquisition cleanup, staged release
retry, direct journal lease validation, and an explicit choice for legacy
deletion. Stable identity is necessary; one-to-one root registration and a
mandatory new argument on read-only inspection are not logically necessary
consequences of that requirement.

## Research Questions

- Does rejection release only the guard just acquired, without stranding a live writer?
- Can cleanup resume after owner removal but before guard removal?
- Do direct journal and legacy deletion entry points share the claimed authority?
- Which compatibility costs follow from the recommendation, and which alternatives avoid them?

## Orbit Baseline

Inspected local `b6391c8d895e37a58bff4dc39b29610e230fc7ad` on 2026-09-08.
The working tree was clean; no src/test changes existed after the proposal or
relative to the earlier `49d68e842a05b5c5e08cdac2b748d2fb4b692f87` baseline.
Public main still resolved to `80130cf194e477f136eefaa5b7cd2a2374dff198`.
No local source is described as newly published.

Build and headers passed. The committed stale-lock fixture again returned
exit 1 on macOS arm64 / Node v26.5.0, with both children reporting owned and
simultaneousLiveOwners true. This verifies the unchanged failure, not the
proposed remedy. No protocol implementation, new runtime test, Linux or Windows
run was performed in this review. The earlier full-suite result (twice 371
passing / 1 failing) and isolated log result (6 / 1) remain separate, dated
facts. The fixed August 25 legacy log and the 14-day retention cutoff still
require a later test correction; the full suite was not repeated in this
source/document review.

## Findings

| Review issue                                              | Source or proposal evidence                                                                                                                                                                                                                                  | Required clarification, not implemented behavior                                                                                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rejection after acquiring guard                           | Proposed acquisition rejects live/malformed owners and markers after exclusive guard creation, without an explicit unwind path                                                                                                                               | Always release this attempt's guard after ordinary rejection; never touch the existing owner. Preserve any cleanup failure separately.                                               |
| Release retries cannot simply re-enter acquisition        | SessionRecorder.close and Session.close cache closePromise; proposal says retain ownership and retry even when owner unlink has already succeeded                                                                                                            | Track writer release and guard release separately; serialize retries of the same retained cleanup state without reacquiring one's own guard or reopening writes.                     |
| Journal scope can be omitted by direct callers            | Public FileExecutionJournal.open accepts root, sessionId and an arbitrary releaseLease callback; Session.acquireManagedLease returns only a function. Agent.getJournal supplies matching values, but the public journal does not validate their relationship | Require a core-issued, live, single-consumer scoped lease at the built-in persistent journal boundary; do not confuse the normal Agent call with validation of every library caller. |
| Legacy deletion differs from the service                  | SessionRepository.delete directly unlinks a transcript and does not write a deletion marker; SessionDeletionService does                                                                                                                                     | Choose explicitly between extending marker retention to legacy deletion or refusing that API's mutation and directing callers to the service.                                        |
| Stable identity does not imply every original restriction | Public recorder and repository accept file paths; one-to-one root bindings are the proposed simpler coordination topology                                                                                                                                    | Separate required stable identity from recommended layout/API restrictions, retain read-only path inspection conservatively, and compare multi-resource locking.                     |

The journal finding is source inspection, not an additional demonstrated journal
corruption. Test fixtures intentionally pass no-op lease callbacks to isolate
storage I/O. They will require explicit ownership fixtures if the proposed
public contract is adopted. A custom ExecutionJournal implementation remains a
trusted extension responsible for its own persistence/exclusion contract; core
must not claim a filesystem guarantee for arbitrary user code or raw fs writes.

Additional inspected files: `src/core/agent.ts` (getJournal),
`src/core/session/session.ts` (acquireManagedLease, close),
`src/core/execution/journal.ts` (FileExecutionJournalOptions, open, close),
`src/core/execution/index.ts` (exports), `src/core/execution/recovery.ts`
(recordReconciliation uses an existing journal), `src/core/session/repository.ts`
(create, open, delete), and `src/core/session/deletion-service.ts` (delete).
The recorder, path helper and committed race fixture were also re-read.

## External Systems Investigated

The comparison uses the same exact revisions as the original ledger, not a new
upstream version. On 2026-09-08, re-read the downloaded pinned Codex
`5adb68a49933ae446bf11935662c83dba55a0804`
`codex-rs/thread-store/src/local/writer_lock.rs` and Pi
`b79e4cc834970cca69daebffab7df1da7d1e52c4`
`packages/coding-agent/src/core/session-manager.ts`.
Codex scopes its coordination handle so early returns release it and uses
coordination again for writer-file cleanup. Pi's synchronous initial creation,
append and rewrite still do not demonstrate a writer lease for Orbit's
persistent journal. Neither implements the proposed Node guard cleanup state
machine. The original note supplies the additional maintenance/recorder source
and OS references; no external suite or native Node binding was tested here.

## Analysis

### Exception paths are ownership transitions

A caller rejected because another owner is live may itself own the short
guard. Leaving that guard behind on every ordinary rejection would prevent the
legitimate owner from closing. Conversely, unconditional cleanup can remove a
foreign guard if the caller never acquired it. Cleanup authority must derive
from this attempt's successful exclusive creation and retained local state,
not from its PID or a prior isLocked result.

Release has at least three stages: writes/leases settled with owner present;
owner removed but own guard present; and all coordination artifacts released.
The middle stage cannot use the generic acquire/re-read-owner routine. A lost
or uncertain removal acknowledgement requires conservative ownership matching;
a replacement guard must never be deleted. After a process restart there is no
local creator authority, so an abandoned guard requires offline maintenance.

### Necessary identity versus chosen storage restrictions

A durable ID scope can be obtained through one-to-one root registration, but
also through an explicit mapping or coordinated claims on transcript identity
and journal-root/Session-ID identity. Multiple claims need a global acquisition
order, partial-acquisition rollback, alias handling and transcript-free deletion
recovery. They can preserve more custom layouts but substantially enlarge the
protocol. Thus the original simpler topology is a reasonable _recommendation_,
not a theorem that every safe design must ban overlapping roots or path APIs.

Within the simpler topology, protect against two registered repositories claiming
the same transcript through nested roots or aliases. Validate an exact supported
transcript layout and reject cross-binding overlaps during exclusive registration;
allow the existing default pair's own session-root/.runs nesting. Do not merely
compare two root strings. A path-only read-only isOpen can remain as a conservative
compatibility wrapper, returning unavailable when it cannot resolve a valid
existing scope without mutation.

For legacy deletion, refusing the old transcript-only API and directing callers
to the existing deletion service avoids silently widening the historical marker
retention policy. A delegating compatibility wrapper is possible only with an
explicit complete deletion context and documented retention; absence of a
journal directory is not a safe reason to unlink directly.

### Lease validation and trust

A function that releases ownership carries no verifiable session/root identity.
For the built-in file journal, a runtime-validated capability should bind the
repository, session, owner token, journal root and lifetime. It is usable by one
journal at a time, cannot be serialized/reconstructed as a live lease after
restart, and remains borrowed until I/O settles. Invalid, released, foreign or
already-consumed capabilities fail before journal/key I/O. Factory-based API
encapsulation is an alternative to exposing the capability. Both preserve the
accepted shared ownership contract; neither requires adopting it again.

## Implications for Orbit

Revise the existing proposed ADR rather than accepting it or introducing a
second architectural decision. Keep guard refusal/offline recovery conditional
on author agreement. Tighten mutation authority and cleanup while avoiding an
unnecessary breaking argument on a read-only compatibility wrapper. Prefer
routing legacy deletion to the deletion service over silently adding permanent
markers to the old transcript-only behavior. Document the one-to-one root
choice and its more complex alternative honestly.

## Risks and Limitations

These are source and protocol review findings, not passing implementation tests.
The initial product values, Windows/native locking/sync, representative long
tests, production MCP and actual human waits remain unverified as recorded in
the existing ADRs. OS locks still need a native integration; guard refusal still
needs external maintenance exclusion that survives the maintenance process.
Neither can approve unknown external effects. Existing accepted ADRs remain
partial, and the new ADR remains proposed / not-started.

## Open Questions

Author choice remains required for the guard-versus-native operational cost,
scoped recorder/journal API migration, and one-to-one registration/custom-layout
restrictions. No claim is made that native packaging is harder than offline
maintenance in every deployment. The recommendation is conditional on the
intended single-host product and operator workflow.

## Related Decisions

- [Reviewed proposal](../adr/2026-09-08-session-writer-recovery-guard.md).
- [Journal](../adr/2026-09-07-required-execution-journal.md), [run lifecycle](../adr/2026-09-07-managed-run-lifecycle.md), [authorization](../adr/2026-09-07-prepared-operation-authorization.md): no acceptance or implementation state change.

## References

- [Original investigation and source/OS links](2026-09-08-session-writer-lock-recovery.md).
- [Recorder](../../src/core/session/recorder.ts), [Session](../../src/core/session/session.ts), [journal](../../src/core/execution/journal.ts), [repository](../../src/core/session/repository.ts), [deletion service](../../src/core/session/deletion-service.ts).
- [Existing failing probe](../../test/core/execution/fixtures/stale-lock-race.mjs).
- [Pinned Codex coordination](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/thread-store/src/local/writer_lock.rs).
- [Pinned Pi persistence](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/src/core/session-manager.ts).
- Companion book inputs: A06, A09 and A11 in cybergarage-pub at `7a5790e207e3270863b7d2870275518aa036ce48`; the revised analysis will link this review separately from original proposal history.
