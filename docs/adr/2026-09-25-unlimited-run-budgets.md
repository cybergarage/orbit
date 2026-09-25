---
status: proposed
proposed-date: 2026-09-25
decision-date: null
implementation-status: not-started
implementation-completed-date: null
implementation-commits: []
superseded-by: []
---

# Unlimited Run Budgets

## Purpose

Allow long coding tasks to finish without an arbitrary iteration or total-time
stop. The author explicitly requests unlimited support and unlimited defaults
for Orbit, with finite budgets retained as caller-selected constraints.

## Decision

Represent an execution limit as a nonnegative safe integer or the JSON string
`unlimited`. Permit that string for `toolRounds`, `modelCalls`, `toolRequests`,
and `elapsedMs`, and make those four Run defaults unlimited. Finite elapsed
milliseconds must remain positive and within the supported timer range.
Agent `maxToolIterations` and Graph Agent iteration overrides accept the same
explicit string; a Graph node cannot widen a finite parent iteration allowance.
Independent finite Run counters remain authoritative.

Skip aggregate timers and counter comparisons for unlimited fields. Do not use
an enormous finite value or serialize JavaScript Infinity. Keep cancellation,
required journals, permission policy, finite approval/cleanup/startup timeouts,
MCP source limits, Graph visit limits and context budgets. An unlimited Run uses
the MCP SDK's finite per-request timeout instead of passing Infinity to its timer.

Carry the literal through workspace settings, request identity, snapshots,
transcript turn context, journals, evaluation inspection and GUI controls.
Existing numeric records remain readable without rewriting them. Older Orbit
readers may reject newly written unlimited turn context; this is a forward-reader
compatibility change within existing record versions, not a history migration.
Publish it in maintained documentation. No evidence or terminal result is rewritten.

This partially supersedes the finite aggregate-budget decision in
[the earlier coding-budget ADR](2026-09-25-coding-budgets-and-continuation.md).
Its explicit continuation, nondispatch recovery and ownership rules remain in
force. The finite default assumptions of the managed lifecycle are refined only
for these four optional aggregate ceilings.

## Consequences

Long tasks can continue until natural completion, cancellation or failure.
Operators own the resulting model usage and retained history and can select
finite caps for unattended workloads. Unlimited does not promise unlimited model
context, provider availability, storage or memory. Bounded shutdown and unknown
operation handling remain necessary even without a total-time deadline.
Explicit numerical limits and zero-call budgets retain their prior behavior.

## Context and Problem Statement

At `6f6e57077201c0b5c20bfffabddac3930b36f2b2`, Run limits and Agent iterations
require finite numbers. Run admission, project preparation and active execution
install deadline timers. Passing Infinity directly would overflow Node timers;
JSON persistence would also turn it into null. GUI fields, Graph evidence and
transcript parsing assume numeric limits. Changing only defaults is insufficient.
The book E2E trials exhausted their separately configured 50-round budgets;
these results motivate configurable duration, not a claim that longer runs solve
the tasks. E2E host-specific caps are separate follow-up work.

## Decision Drivers

- Honor the author's explicit unlimited-default policy.
- Keep finite overrides useful and preserve explicit user cancellation.
- Preserve truthful evidence and numeric historical records.
- Avoid timer overflow and JSON ambiguity across public boundaries.

## External Implementation Research

Inspected again on 2026-09-25 at the immutable revisions already identified in
[the execution-limit investigation](../research/2026-09-25-agent-execution-limits-and-gui-continuation.md).
Codex `aa380897f67b91e1a47d530d7286d497b6726d3f`,
`codex-rs/core/src/session/turn.rs`, continues its main loop according to
`needs_follow_up` and pending input, with cancellation propagated independently.
Pi `5fd446ca1843682e8da3fec4ceb71c42f56fbace`,
`packages/agent/src/agent-loop.ts`, continues on tools/steering and queued
follow-ups; errors, aborts and explicit turn decisions terminate that loop.
These source inspections support separating natural completion from aggregate
ceilings. They do not establish unlimited provider capacity or require Orbit to
copy their persistence contracts. Retain Orbit's managed ownership and optional
numeric budgets rather than adopting either runtime wholesale.

## Considered Options

1. Raise a constant to 10,000: rejected; still finite and retains a separate time stop.
2. Use Infinity or a large sentinel number: rejected; ambiguous persistence and timer overflow.
3. Make all resource constraints optional: rejected; approval, cleanup, tool and
   Graph safety/lifecycle constraints are different from aggregate work budgets.
4. Explicit unlimited aggregate limits with optional finite overrides: selected.

## Implementation and Confirmation

Implement the selected scope after acceptance. Confirm parser boundaries,
execution beyond previous caps, finite exhaustion, cancellation and cleanup,
unlimited admission without timer overflow, persisted numeric/unlimited reads,
Graph/evaluation compatibility, settings/API exposure and GUI controls. Run
headers, build and the complete test suite sequentially. Record the full
implementation hash and actual evidence in a later finalization commit.

## Follow-up Work

Update E2E host controls separately. Live model outcomes, cross-platform resource
exhaustion and multi-day endurance are not established by unit tests.

## References

- [Managed execution](../execution.md)
- [Settings](../settings.md)
- [Coding budgets and explicit continuation](2026-09-25-coding-budgets-and-continuation.md)
- [Managed Run lifecycle](2026-09-07-managed-run-lifecycle.md)
