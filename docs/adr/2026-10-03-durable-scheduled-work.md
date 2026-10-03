---
status: proposed
proposed-date: 2026-10-03
decision-date: null
implementation-status: not-started
implementation-completed-date: null
implementation-commits: []
superseded-by: []
---

# Single-owner durable scheduled work

## Purpose

Provide a minimal shared scheduling primitive for Nest without duplicating desktop scheduling or weakening the execution journal. Inspected upstream Orbit: 56b1bea (full revision recorded in Git ancestry). Existing execution/run.ts binds request IDs to canonical input; execution/authorization.ts records intent before dispatch; recovery.ts refuses automatic dispatch of uncertain effects. A schedule must retain this identity rather than consume a reservation and generate a new request ID.

## Decision

Use a single-owner, bounded JSON snapshot with exclusive owner lock, fsync, atomic same-directory rename and directory synchronization. Persist schedules, occurrences, runs and attempts separately. Atomically materialize queued work and advance its cursor. Fixed millisecond intervals and one-shot timestamps only; coalesce missed intervals into the latest due occurrence. Keep a stable request ID for all attempts of an occurrence. Read-only interrupted attempts may resume; opaque effects become unknown and require reconciliation. Approvals and cancellation survive process death. Results are attached to one run and committed once. This does not promise exactly-once external execution or timezone/DST recurrence.

The host supplies narrowly scoped execution; this store does not launch shell commands or model tools. Existing RunSupervisor and operation journals remain authoritative for hosts using agent tool execution. The first Nest host uses deterministic read handlers and no external writes; the scheduling attempt is not an Orbit model/tool Run.

## Evidence and alternatives

Codex b741e480e203f037ca726bc2a76d99a8e8668e66, codex-rs/rollout/src/recorder.rs: asynchronous rollout recording with explicit flush handling. Adopt explicit persistence boundaries; conversation rollout is not a schedule/occurrence transaction.

Pi 4c6fb7cfe8c538a668726f6f8b3554098c39faee, packages/coding-agent/src/core/session-manager.ts: append-only conversation trees, synchronous append/rewrite. Adopt separate durable identity and inspectable history; do not use transcript append as an atomic scheduling transaction.

SQLite would scale better but requires a new dependency or Node version floor beyond Orbit's Node 20 support. A bounded atomic snapshot has higher write amplification and is suitable only for an initial desktop slice. Fail closed for corrupt state and live owner; do not steal a live lock. PID reuse can require manual lock inspection. Network shares and multiple machines are unsupported. Rename/fsync evidence covers process death; physical power-loss guarantees depend on filesystem/device behavior.

## Consequences

One writer, serialized transitions, limited history size, explicit local storage path. No daemon or login item. Window closure can leave the Electron process running; exit, sleep and poweroff stop execution. Tests must prove crash recovery, stable retry identity, one visible result, persistent approval/cancellation, owner exclusion and uncertain-effect quarantine. Full Orbit validation remains required.

## Acceptance

The user explicitly approved implementing the shared durable scheduler and first Nest prototype on 2026-10-03. Review found the narrow trigger and read-only scope consistent with that instruction; no separate architecture approval is required.
