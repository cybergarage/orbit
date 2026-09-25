---
status: accepted
proposed-date: 2026-09-25
decision-date: 2026-09-25
implementation-status: completed
implementation-completed-date: 2026-09-25
implementation-commits:
  - 7612eaedee8d4fbe9ba5ecd03a75b875e31449c6
superseded-by: []
---

# Coding Budgets and Explicit Continuation

## Purpose

Make ordinary coding tasks practical and provide a usable next action after a
known budget stop, including legacy conversations with an undispatched final
tool batch. The author requested implementation after reviewing the comparison
and GUI/history findings on 2026-09-25.

## Decision

Use configurable finite default limits of 100 tool rounds, 101 model requests,
1,000 tool requests and 60 minutes. These are provisional product defaults, not
measured optima. Preserve approval, cleanup and source limits. Derive the Agent's
default iteration allowance from effective Run tool rounds; keep explicit
`maxToolIterations` as a compatible additional limit. Expose `executionLimits`
in workspace settings and per-request limits through Thread, application and GUI.

Preserve journal versions and terminal outcomes. Encode specific exhaustion in
the existing terminal `reason` string and decode it for typed presentation;
publish effective limits in live/recovered snapshots. Historical generic reasons
remain valid and receive generic guidance.

When a newly received tool batch is rejected for budget before any dispatch,
append truthful error results describing nondispatch. Never replay these calls.
The GUI offers a new explicit request in the same conversation, with adjustable
limits and a `continueFromRunId` bound into request identity. It preserves the
previous immutable Run and rechecks completion/recording/ownership on the server.

For legacy history, allow only an unresolved final assistant batch from the
specified acknowledged, quiescent budget-exceeded Run. Under managed writer
ownership, synchronize and reread transcript and journal, validate journal order
and the terminal transcript boundary, and reject missing calls with any matching
operation intent. Validate all preceding message groups. Append error-form
nondispatch notices before the new user message, then synchronize before any
model/MCP work. This is explicit append-only recovery of known nonexecution,
not revision-1 cancelled-context projection or an automatic v2-to-v3 migration.
Refuse ambiguous identity, partial batches, unknown effects, Graph legacy
recovery, failed evidence or intervening conversation changes with actionable
guidance. Old transcript bytes and terminal outcomes remain intact.

## Consequences

Typical exploration can exceed five rounds. Users can see and change finite
limits, understand exhaustion and intentionally continue. Larger defaults can
consume more compute and time. Limits remain useful for unattended callers.
Append-only legacy recovery adds a narrowly scoped proof boundary and conservative
refusals; it does not recover arbitrary interrupted histories. New notices are
explicit errors with no fabricated successful output.

## Context and Problem Statement

At baseline `86a597ca0ae4f91e43b079b07965491e69d6d1f0`, Agent and Run each impose
five rounds. A reported coding task used its entire allowance on successful
reads. The GUI displayed a generic budget outcome and recording status, with
neither continuation controls nor an explanation. Persisting the sixth model
response before rejecting its tools left an incomplete group. Budgeted context
validation rejects it; cancelled-only projection cannot repair a budget stop.

## Decision Drivers

- Complete realistic investigation, implementation and verification cycles.
- Keep bounded execution, explicit authorization and ownership reliable.
- Make stopped work understandable and recoverable without rewriting history.
- Bind continuation and limits into retry identity and validate at API boundaries.
- Preserve unrelated cancellation/projection and Graph contracts.

## External Implementation Research

Investigated 2026-09-25; see the [comparison](../research/2026-09-25-agent-execution-limits-and-gui-continuation.md).
Codex `aa380897f67b91e1a47d530d7286d497b6726d3f`, `session/turn.rs`,
`context_manager/normalize.rs` and `config/mod.rs`, continues on tool/pending
input and handles context budgets separately. Pi
`5fd446ca1843682e8da3fec4ceb71c42f56fbace`, `agent-loop.ts`, `agent.ts` and
`agent-session.ts`, likewise separates natural continuation, context and retry.
Adopt practical continuation and distinguish budget classes; do not copy broad
missing-output normalization as proof of nondispatch. Claude Code's official
CLI reference documents opt-in print-mode max turns with no default cap.
Retain finite Orbit limits rather than claiming unbounded service capacity.

## Considered Options

1. Raise only one constant: rejected because independent limits and history/UI
   failures remain.
2. Remove all execution limits: rejected for this scope; preserve finite unattended
   operation and measure defaults separately.
3. Rewrite old history or replay the final command: rejected because it destroys
   evidence or assumes authorization/execution facts.
4. Configurable practical budgets plus explicit, verified continuation: selected.

## Implementation and Confirmation

Implemented in `7612eaedee8d4fbe9ba5ecd03a75b875e31449c6` and confirmed on
2026-09-25. The accepted scope is complete: configurable defaults, exhaustion
details, explicit continuation, verified append-only legacy recovery, GUI controls
and restored saved-run status. Maintained execution, settings, GUI, integration,
architecture and concept documentation describe the resulting behavior.

`npm run headers:check`, `npm run build` and `npm test` passed sequentially;
the complete suite passed 935 tests. Coverage includes more than five rounds,
all three counters, settings/API validation, request identity, conservative
legacy refusals, and a persistent application restart/continuation scenario that
preserves the original transcript prefix. GUI component tests verify limit
controls, status and eligibility. The existing MCP timeout assertion now follows
the configured product default; test directories are isolated from other retained
execution owners. Formatter changes, the final diff and documentation links were
reviewed. No live provider task was used to benchmark the provisional limits.
The reported user's original session was not modified during validation.

## Follow-up Work

Measure default budgets across providers and representative coding tasks.
Unknown-operation recovery and arbitrary interrupted Graph continuation remain
outside scope. Preserve platform/fault-trial deferrals in earlier ADRs.

## References

- [Managed lifecycle](2026-09-07-managed-run-lifecycle.md)
- [Required journal](2026-09-07-required-execution-journal.md)
- [Verified interrupted context](2026-09-14-verified-interrupted-tool-context.md)
- [Execution](../execution.md), [GUI](../gui.md), [Settings](../settings.md)

## Acceptance — 2026-09-25

The author requested the researched changes be implemented. Review confirmed that
finite configurable defaults, explicit continuation and a narrowly verified
append-only legacy path address the reported failure without replaying commands
or weakening operation authorization. This decision is accepted for that scope;
implementation and validation evidence follow in a later commit.
