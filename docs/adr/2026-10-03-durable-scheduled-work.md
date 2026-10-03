---
status: accepted
proposed-date: 2026-10-03
decision-date: 2026-10-03
implementation-status: completed
implementation-completed-date: 2026-10-03
implementation-commits:
  - 5651e29b00a967322fc0db42a915ac9af592869e
  - e29acaf125e935f36768b463df1302d425b2d787
superseded-by: []
---

# Single-owner durable scheduled work

## Purpose

Provide a minimal shared scheduling primitive for Nest without duplicating desktop scheduling or weakening the execution journal. Inspected upstream Orbit: 56b1bea2d9f7b60266c03e2fece0bad579230290. Existing execution/run.ts binds request IDs to canonical input; execution/authorization.ts records intent before dispatch; recovery.ts refuses automatic dispatch of uncertain effects. A schedule must retain this identity rather than consume a reservation and generate a new request ID.

## Decision

Use a single-owner, bounded JSON snapshot with exclusive owner lock, fsync, atomic same-directory rename and directory synchronization. Persist schedules, occurrences, runs and attempts separately. Atomically materialize queued work and advance its cursor. Fixed millisecond intervals and one-shot timestamps only; coalesce missed intervals into the latest due occurrence. Keep a stable request ID for all attempts of an occurrence. Read-only interrupted attempts may resume; opaque effects become unknown and require reconciliation. Approvals and cancellation survive process death. Results are attached to one run and committed once. This does not promise exactly-once external execution or timezone/DST recurrence.

The host supplies narrowly scoped execution; this store does not launch shell commands or model tools. Existing RunSupervisor and operation journals remain authoritative for hosts using agent tool execution. The first Nest host uses deterministic read handlers and no external writes; the scheduling attempt is not an Orbit model/tool Run.

## Evidence and alternatives

Codex b741e480e203f037ca726bc2a76d99a8e8668e66, codex-rs/rollout/src/recorder.rs: asynchronous rollout recording with explicit flush handling. Adopt explicit persistence boundaries; conversation rollout is not a schedule/occurrence transaction.

Pi 4c6fb7cfe8c538a668726f6f8b3554098c39faee, packages/coding-agent/src/core/session-manager.ts: append-only conversation trees, synchronous append/rewrite. Adopt separate durable identity and inspectable history; do not use transcript append as an atomic scheduling transaction.

Upstream already uses better-sqlite3 for project storage. SQLite would scale better, but this module deliberately uses built-in Node 20 APIs so Electron hosts can bundle the primitive without loading a native SQLite addon for another runtime ABI. This increases snapshot write amplification and should be revisited before larger workloads. A bounded atomic snapshot has higher write amplification and is suitable only for an initial desktop slice. Fail closed for corrupt state and live owner; do not steal a live lock. PID reuse can require manual lock inspection. Network shares and multiple machines are unsupported. Rename/fsync evidence covers process death; physical power-loss guarantees depend on filesystem/device behavior.

## Consequences

One writer, serialized transitions, limited history size, explicit local storage path. No daemon or login item. Window closure can leave the Electron process running; exit, sleep and poweroff stop execution. Tests must prove crash recovery, stable retry identity, one visible result, persistent approval/cancellation, owner exclusion and uncertain-effect quarantine. Full Orbit validation remains required.

## Acceptance

The user explicitly approved implementing the shared durable scheduler and first Nest prototype on 2026-10-03. Review found the narrow trigger and read-only scope consistent with that instruction; no separate architecture approval is required.

## Implementation evidence

Implementation e29acaf125e935f36768b463df1302d425b2d787: headers/build and 1,085 full-suite tests passed on the Mac mini M4; seven focused tests cover SIGKILL recovery, atomic cursor/result behavior, persistent approval/cancellation, canonical retries, ownership and corrupt evidence. Independent npm package-consumer verification passed (397 files). Nest's real gemma4:12b schedule was killed during inference and restarted with one stable request ID, two attempts and one visible result. Local-only model review is limited; PID reuse and snapshot scalability remain documented. Windows/power-loss validation is not claimed. orbit-app migration is a separate follow-up and not part of this store's implemented scope.

### Scoped packaging follow-up

5651e29b00a967322fc0db42a915ac9af592869e extracts the existing pure canonical JSON helper and preserves its journal export. This prevents the scheduler-only desktop host from importing unrelated glob/tool code. The complete suite still passes 1,085 tests and the package consumer validates 399 files. Inherited build dependency advisories are not claimed fixed; Nest excludes those modules from its shipped bundle.
