---
status: accepted
proposed-date: 2026-11-15
decision-date: 2026-11-15
implementation-status: completed
implementation-completed-date: 2026-11-15
implementation-commits:
  - 81a9730aee770858164d2ef8b9821aa398c9652d
superseded-by: []
---

# Non-preemptive job priority with bounded bypass aging

## Purpose

Choose urgent work ahead of independent background jobs without weakening the
single-host event foundation, per-key order or conservative effect recovery.

## Decision

Expose explicit `high`, `normal` and `low` Job priorities; missing means normal.
Keep priority outside arbitrary payloads. Future trusted user-input/approval
hosts can choose high and background hosts low; this change adds no such ingress.

Add a reusable state-only ready-job selector. Candidates have stable identity,
key, unique positive sequence, explicit readiness and optional priority. Only the
earliest unfinished candidate per key can compete; an unready head blocks its
successors. Compare effective priority, then bypass age, then arrival sequence.
No global FIFO is promised across independent keys.

A successful selection increments an eligible losing head's counter only when
the selected job has a higher base priority. Same-class FIFO waiting earns no
credit, retaining the old order when an earlier blocked normal job becomes ready.
Promote one priority level per four bypasses, capped at high after eight. Counts
saturate at eight and the selected candidate's count is removed. At equal
effective priority, greater bypass age wins before stable arrival sequence.
Thus a continuously eligible low Job reaches the maximum rank after eight credited higher-base-priority
bypasses and cannot be overtaken by newly arriving high Jobs. Older equally
aged candidates may precede it; the finite earlier backlog must still drain.
This is a selection-opportunity guarantee, not a wall-clock deadline. Blocked
keys, long-running work, process downtime and stopped/unknown owners can delay
all work. No priority can preempt an admitted execution.

DurableWorkStore persists optional priority metadata and internal scheduling
state, and adds `claimNext()` to select and claim one Job atomically with its
attempt and fairness update. The bundled LocalScheduler uses this operation and
retains its single active execution and global unknown-outcome stop. Explicit
`claim(id)` remains the host's manual selection API. EventStore admission and
consumer acknowledgement are unchanged; generic owners can call the selector
inside their existing EventStore transaction and store its state alongside jobs.

Schedules accept optional priority; `enqueue()` adds an optional fifth options
argument while retaining its existing effect/approval arguments. A replay key
binds normalized priority as well as payload/effect/approval. Timer facts capture
schedule priority independently of payload. Public snapshots keep their v1 shape
with optional fields on runs/schedules; internal task format stays fixed at 2.
Missing scheduling metadata starts empty, so old state remains readable. Present
invalid priorities/counters reject. No format identifier supplies missing proof.

## Consequences

Urgency improves across independent keys, while persisted aging prevents strict
priority starvation under continued high-priority arrivals. Entirely default/normal histories
retain FIFO selection, including approval transitions. Credits earned under
earlier mixed-priority traffic remain durable. Persisting counters adds bounded metadata and snapshot
validation cost. This is not a worker pool, distributed broker, retry/backoff
policy, workflow engine or authorization grant. Opaque unknown outcomes remain
unknown and never become ready due to priority or age.

## Context and Problem Statement

Inspected main `d1acb7a5b42205f22d58e820abc1749abe97aeb8`, merged PR #37.
EventStore atomically accepts facts and admits application jobs; LocalScheduler
currently picks the first queued run. There is no existing priority selector.
Open Issues #11/#22 concern search and compaction, not scheduling; no open PR or
priority branch duplicates this change. Existing Nest integration is excluded.

## Decision Drivers

Preserve per-key order, atomicity, stable IDs, terminal cancellation, stale-attempt
refusal, conservative recovery and backward compatibility. Avoid hidden payload
control, preemption, clock dependence and retry-driven external effects.

## External Implementation Research

Investigated on 2026-11-15:

- [go-job v1.2.3](https://github.com/cybergarage/go-job/tree/5b17e81aff50eafbd63cd0948cc740408e0b21d1),
  commit `5b17e81aff50eafbd63cd0948cc740408e0b21d1`:
  `job/priority.go`, `policy.go`, `queue.go`, `worker.go` separate explicit
  priority policy from execution and provide a medium default. Adopt that
  separation. Worker retry/backoff and goroutine execution are not adopted;
  they do not establish Orbit's uncertain-effect recovery contract. No Go
  service or dependency is added. These inspected files do not establish a
  fairness guarantee that can replace the policy above.
- [RabbitMQ priority documentation](https://www.rabbitmq.com/docs/priority),
  dated official documentation observation: strict priority can starve lower
  classes and in-flight work is outside ready-queue prioritization. Adopt few
  classes, explicit starvation prevention and non-preemption. No broker is added.
- [Codex recorder](https://github.com/openai/codex/blob/b741e480e203f037ca726bc2a76d99a8e8668e66/codex-rs/rollout/src/recorder.rs),
  commit `b741e480e203f037ca726bc2a76d99a8e8668e66`: retain explicit durable
  acknowledgement boundaries. Rollout recording is not a durable job selector;
  its inspected source does not supply this fairness policy.
- [Pi session manager](https://github.com/badlogic/pi-mono/blob/4c6fb7cfe8c538a668726f6f8b3554098c39faee/packages/coding-agent/src/core/session-manager.ts),
  commit `4c6fb7cfe8c538a668726f6f8b3554098c39faee`: keep application queue state
  separate from conversation history. Conversation replay is not dispatch
  authority or a fairness implementation. No transcript mechanism is changed.

## Considered Options

Strict priority can starve low work. Wall-clock aging needs a clock and makes
recovery/time changes part of selection. A weighted cycle gives class shares but
needs more cursor/class accounting and can obscure same-key blocking. Bounded
bypass aging uses only persisted selection opportunities and deterministic
ordering, with no sleeping or test clocks.

## Implementation and Confirmation

The user authorized design and implementation, then independent review and PR
publication. The proposal was reviewed against the safety requirements and accepted on
2026-11-15 before source implementation. The later completion record below
identifies the implementation commit after validation and independent review. Tests must
cover sustained urgent arrivals, blocked heads, restart fairness, default FIFO,
explicit metadata/payload separation, atomic failure and unchanged interruption,
terminal cancellation and unknown-effect behavior.

The #37 Sonar review reports 13 code smells, not runtime/security findings: three
complexity, three optional-chain, six assertion-style and one exception-specificity
issue. Only touched scheduling paths and relevant assertions are candidates for
focused improvement; unrelated store refactoring is excluded.

Local confirmation on 2026-11-15 at base
`d1acb7a5b42205f22d58e820abc1749abe97aeb8`: headers and build passed, full
source/test type checking (`tsc -p tsconfig.test.json --noEmit`) passed, targeted
lint and the full format/lint pretest completed with warnings and no errors.
The focused scheduling/event/GUI-executor set passed 80 tests and the complete
suite passed 1,386 tests. Package-consumer validation passed for 515 packaged
files, including priority declarations, selector state and atomic task claims.
All checks used isolated synthetic state on macOS arm64, Node.js 26.10.0; no live
provider calls were made. Windows and distributed behavior are not qualified.

An independent read-only review found an eligibility-change FIFO discrepancy;
restricting credits to higher-base-priority bypasses and adding selector/store
approval-unblock regressions corrected it. Re-review found no remaining
correctness blockers. Purely default traffic does not earn aging credits, while
credits earned in mixed-priority traffic remain durable. Process-death,
unknown-effect, no-preemption, same-key and atomic-failure tests pass. Touched
timer capture/validation paths were split into focused helpers, and the relevant
corruption test now asserts semantic exception messages. Unrelated #37 style
findings are not claimed resolved. No workflow/dependency/budget change is made.

Implementation completed on 2026-11-15 in
`81a9730aee770858164d2ef8b9821aa398c9652d`, after the separately committed
accepted decision. This later documentation commit records completion evidence.
Publication is authorized; merge and deployment are not. Current-head CI results
are recorded in the PR and are distinct from the successful local checks above.
The remaining items below are outside this decision's completed scope.

## Follow-up Work

Nest Project/Session integration, message/approval/notification ingress, UI
priority controls, dynamic reprioritization, multiple workers, distributed leases,
backoff/retries and wall-clock service-level guarantees remain separate work.

## References

- [Event foundation decision](2026-11-14-durable-timer-inbox.md)
- [Event inbox](../event-inbox.md)
- [Scheduled work](../scheduled-work.md)
