---
status: accepted
proposed-date: 2026-10-14
decision-date: 2026-10-14
implementation-status: completed
implementation-completed-date: 2026-10-14
implementation-commits:
  - f1707929573f1cabfdef9b32a67d4a08680d5678
superseded-by: []
---

# Bundled GUI local scheduling

## Purpose

Implement the approved Home, Scheduled and Settings design in Orbit's bundled
GUI, with a bounded local scheduling adapter that preserves the existing durable
work and managed execution boundaries.

## Decision

Use the existing loopback Express/React host, capability token, origin checks and
request validation. Keep a 64px primary navigation rail, 280px context list and
detail workspace. Compact windows use a dismissible context drawer. Expose real
diagnostics and runtime information in Settings.

Adapt DurableWorkStore with versioned workspace-read payloads, validated absolute
workspace paths and creation replay identities saved atomically in each schedule.
Use one bounded managed Agent at a time, the application session repository and
its operation journal. Permit only read/list/glob/grep inside the selected
workspace. Deny non-read effects, inherited MCP startup and blanket approvals.

Keep dispatch disabled unless the user explicitly supplies `gui --scheduled-work`.
This avoids executing saved tasks during ordinary GUI startup or verification.
Pause prevents future occurrences; cancel signals the actual executor and remains
pending until it settles. Unknown outcomes suspend further dispatch and require
stopped confirmation plus evidence before reconciliation as failed.

The user approved the layout and local bounded adapter on 2026-10-14 and
subsequently released the shared checkout for local implementation. Publication,
real task execution, daemon installation and security changes remain outside that
approval. The later handoff instruction authorizes local commits to leave the checkout safely switchable; publication remains separately gated.

## Consequences

- Positive: one scheduling state authority, durable request identities, actual
  managed-run evidence and narrow execution permissions.
- Negative: the local process must remain running for dispatch; fixed intervals
  coalesce missed occurrences, and the bounded JSON store requires eventual
  history management. Unknown cleanup can require manual stopped verification.
- Neutral: no daemon, Docker, calendar recurrence, credentials editor, provider
  editor, write task or external send task is introduced.

## Context and Problem Statement

Inspected base `cdae0cb8c19cf5d61f59f6809b09a9bab2718b9d`, including
`src/apps/gui/{client.tsx,sidebar.tsx,server.ts}`, `src/apps/cli/gui.ts`,
`src/core/execution/{scheduled-work.ts,authorization.ts,run.ts}`,
`src/core/{agent.ts,application.ts}` and session repository ownership.
DurableWorkStore persists schedules, occurrences, attempts and results; it does
not dispatch agent work. Agent and RunSupervisor already own cancellation,
authorization, operation journals and quiescence.

## Decision Drivers

Preserve actual Home behavior and security boundaries; match high-fidelity Figma
context; provide durable local scheduling without duplicating core execution;
validate persisted permissions and workspace again at dispatch; use synthetic
fixtures for local verification.

## External Implementation Research

Inspected on 2026-10-14 at pinned revisions already cited by the accepted durable
work decision:

- Codex `b741e480e203f037ca726bc2a76d99a8e8668e66`,
  `codex-rs/rollout/src/recorder.rs`: a queued recorder retains writer ownership
  and explicit flush/shutdown acknowledgements. Adopt explicit settlement and
  retained ownership; do not use transcript recording as a schedule transaction.
- Pi `4c6fb7cfe8c538a668726f6f8b3554098c39faee`,
  `packages/coding-agent/src/core/session-manager.ts`: separate session persistence
  and session loading. Adopt reuse of existing session history; do not create a
  second conversation store as the scheduling authority.

These comparisons support preserving Orbit's existing recorder/journal and
DurableWorkStore separation, rather than importing another host runtime.

## Considered Options

1. Extend the existing local GUI with a narrow durable adapter (selected).
2. Import orbit-app or orbit-nest runtime/UI (rejected: different product and
   ownership boundaries).
3. Add a daemon, Docker worker or calendar scheduler (rejected: outside scope).
4. Execute schedules through unrestricted conversation agents (rejected: would
   inherit tools and permissions beyond the saved task contract).

## Implementation and Confirmation

Local implementation and verification are complete. Deterministic tests use
isolated temporary storage, synthetic executors and injected synthetic models.
Native Chrome verification on M4 covers desktop and compact layouts, exact local
assets, menus, keyboard focus, task creation, pause/resume, cancellation,
reconciliation and persistence across host restart. No real scheduled work ran.
Assets are bundled as data URLs under the unchanged data-only image CSP. Local
commit evidence is recorded separately after the implementation commit exists.

## Follow-up Work

Preserve the local diff
separately from PR #7: the branch is based on its released HEAD and inherits its
core changes without duplicating them. Project Delete and Session Archive are
not wired into this GUI scope. No CLI Issue #6 change is included.

## References

- [Local GUI](../gui.md)
- [Durable scheduled work](../scheduled-work.md)
- [Durable work decision](2026-10-03-durable-scheduled-work.md)
- [GUI architecture](2026-08-22-gui-application.md)
- [Codex recorder source](https://github.com/openai/codex/blob/b741e480e203f037ca726bc2a76d99a8e8668e66/codex-rs/rollout/src/recorder.rs)
- [Pi session source](https://github.com/badlogic/pi-mono/blob/4c6fb7cfe8c538a668726f6f8b3554098c39faee/packages/coding-agent/src/core/session-manager.ts)

## Completion evidence

Local implementation commit `f1707929573f1cabfdef9b32a67d4a08680d5678`
passed the full 1,134-test suite, build, lint, source/test type checks and header
checks. After final presentation corrections, all 43 focused GUI tests and the
build/type/header checks passed again. Native browser verification covered
desktop and compact navigation, menus, dialog focus, repeated creation clicks,
pause/resume, cancellation, reconciliation, persistence and host restart using
isolated synthetic tasks with dispatch disabled. No real scheduled task ran.

An independent diff review reported no remaining blocking regressions. PR #7 was
confirmed merged at `3265f14310cb8b3c06d315048d2ace85ac42100b`; the local branch
retains the released implementation base without duplicating those core changes.
Publication and live-provider execution remain outside this local verification.

Before publication, only the two GUI commits were replayed onto merged main
`3265f14310cb8b3c06d315048d2ace85ac42100b`. The replayed tree was byte-for-byte
equivalent to the verified original tree; this completion record then updated
the implementation hash. The three-dot publication diff contains only GUI scope.
