---
status: proposed
proposed-date: 2026-11-11
decision-date: null
implementation-status: not-started
implementation-completed-date: null
implementation-commits: []
superseded-by: []
---

# Selectable Session Compaction

## Purpose

Make context reduction strategies replaceable while keeping Session ownership,
execution evidence, durable checkpoints and replay under common runtime control.
Evaluate the existing strategy, End-of-Conversation Compaction (EoCC) and
Single-Action Compaction (SAC) with SWE-bench and Terminal-Bench.

Tracking issue — [#22](https://github.com/cybergarage/orbit/issues/22).

## Decision

**Proposed.** Introduce independent internal interfaces for compaction strategy
and compaction algorithm, composed by a context coordinator. Deliver the current
strategy/algorithm pair first, then opt-in EoCC and SAC experiments.

### Responsibility boundary

| Component            | Proposed responsibility                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Compaction strategy  | Decide when to compact, select eligible history and specify which raw messages remain in the next context         |
| Compaction algorithm | Produce a summary from selected history and the previous summary under the requested schema and budget            |
| Context coordinator  | Resolve the pair, validate compatibility and results, construct requests, enforce budgets and commit checkpoints  |
| Execution policy     | Determine continuation after task failures, retry allowances, lack-of-progress stopping conditions and run limits |
| Model-call service   | Apply bounded transport retries, cancellation, timeouts and usage accounting to each summary attempt              |
| Session and replay   | Own canonical records, exclusive writer access, synchronization and reconstruction from stored checkpoints        |
| Agent loop           | Establish completed action boundaries and enforce the experimental one-action execution mode                      |

A strategy receives a read-only snapshot of source IDs, the previous checkpoint,
verified boundaries, task references, budgets and the preparation reason. It
returns either no compaction or a plan identifying the consumed range, retained
messages, required summary contract and summary budget. Threshold and completed-
action triggers belong to this strategy. The strategy does not choose the
summary implementation.

The coordinator passes the selected history and previous summary to the
independently selected algorithm. The algorithm returns a candidate summary,
source references, schema/revision and usage. It may invoke the tool-free
model-call service, whose attempts consume the shared Run budget. The algorithm
does not change the retained range, dispatch tools or commit Session state.

The coordinator validates source membership, complete tool groups, summary
schema, mandatory observation evidence and total serialized request size. It
rechecks the source head and digest before commit. Only successful durable
commit activates a new projection. Summaries remain untrusted context and cannot
supply authorization or replace execution proofs. Pending approvals, unknown
effects and interrupted groups remain subject to the existing admission rules.

### Independent composition

Settings select strategy and algorithm independently, each with its own identity,
revision and validated parameters. Resolve and snapshot both at run start.
Preserve the existing estimator injection. Model changes recompute capacity-
dependent budgets while preserving both selections. Keep both interfaces
internal initially; a public plugin contract requires compatibility review.

| Pair | Strategy                                                 | Algorithm                  |
| ---- | -------------------------------------------------------- | -------------------------- |
| A/C  | Threshold-triggered compaction retaining a recent suffix | Current structured summary |
| A/D  | Threshold-triggered compaction retaining a recent suffix | Handoff-oriented summary   |
| B/C  | Per-action reset                                         | Current structured summary |
| B/D  | Per-action reset                                         | Handoff-oriented summary   |

These are proposed combinations. Availability requires compatible contracts.
Each strategy declares required capabilities, including the accepted summary
schema and whether cumulative updates from a previous summary are required.
Each algorithm declares supported input/output schema versions and cumulative-
update support. Validate compatibility before executing a run. Validate actual
output again after generation. Unknown identities or incompatible pairs produce
configuration errors; no implicit algorithm substitution occurs.

Changing algorithms between runs requires the new algorithm to accept the saved
summary schema or an explicitly supported conversion from canonical evidence.
Otherwise reject that change before model or tool execution. Replay itself uses
the stored summary and projection, independent of the algorithm that produced it.

EoCC and SAC primarily specify strategies and execution regimes. Their recap
prompts are algorithm configuration. Paper reproduction pins the complete pair,
prompts and action mode. Other compatible combinations are separately labeled
Orbit experiments.

### Continuation and replay ownership

Persistence of effort, such as continuing after failed tests, belongs to execution
policy. That policy applies the same continuation and resource rules across
compaction pairs. The strategy can request preparation after an action, while
the Agent loop decides whether another action is permitted. Summary and repair
calls consume the same time, model-call and cost allowances as other run work.

Session replay reconstructs model input from saved summaries, projections and
subsequent messages without invoking a strategy, summary model or tool. Repeating
an environment action is a new execution decision requiring the usual admission
and side-effect checks. Loading a checkpoint never authorizes redispatch.

### Persistence and replay

The compatibility extraction keeps existing checkpoint encoding and replay.
Existing settings resolve to the current strategy/algorithm pair, and legacy
checkpoints retain their interpretation. The first extraction uses run metadata
for pair provenance without changing legacy checkpoint encoding.

EoCC and SAC need a versioned projection that supports consuming through the
current source head with an empty raw suffix. Define the boundary by the last
consumed message ID and the source-head digest. New messages following that
boundary become the suffix on subsequent calls. Explicit task references
preserve applicable user instructions without duplicating them in the rebuilt
input. Canonical system context is assembled through its existing owner.

Record both strategy and algorithm identities, revisions and resolved parameters,
summary schema/revision, consumed boundary, retained source
IDs, task references, usage and existing projection provenance in the new
checkpoint contract. Validate these against canonical Session records. Replay
uses stored projection data and performs no model calls. Changing either selection on a later run reconstructs the previous checkpoint
and validates compatibility before preparing a new one.

Introduce an explicit format capability/version before writing reset
checkpoints. Existing readers must reject unsupported formats. Finalize the
schema, migration and reader behavior in this record before implementing reset
strategies. The first extraction can ship independently with the old format.

### Failure behavior

Retain the current strategy's fallback rules during extraction. Experimental
EoCC/SAC runs record unsuccessful handoffs as explicit failures. They must not
silently continue with full history and report that execution as the selected
regime. An operational fallback, if later offered, must be a separately labeled
policy. A failed persistence operation stops the run using existing recording
failure behavior. Retrying preparation must never redispatch an environment
action whose result was already recorded.

## Consequences

The two interfaces permit independent strategy and algorithm comparisons and makes summary-model
invocation independently testable. Common validation and persistence keep
strategy-specific code small.

Reset strategies add a persistent-format obligation and increase dependence on
summary fidelity. SAC adds summary calls after every action, which can increase
latency and cost even with shorter inputs. Existing structured tool observations
may increase the minimum context size relative to the paper's harness.

Terminal-Bench adds container setup, adapter maintenance and task-specific
resource requirements. Its completion checks extend evaluation beyond patch
correctness. Results remain specific to the pinned tasks, model and environment.

## Context and Problem Statement

Inspected Orbit revision on 2026-11-11 —
`20b124aa995e469cfca5d962b260e3b054d80699`.

[ContextPolicy and prepareSessionContext](../../src/core/session/context-policy.ts)
currently combine triggering, cut selection, summarization, observations and
checkpoint construction. The latest complete tool round is protected by the cut
selection logic. [Checkpoint validation](../../src/core/session/compaction.ts)
requires a real `firstRetainedId`.
[Session.commitCompaction](../../src/core/session/session.ts) synchronizes the
record before activating it. The Agent directly calls context preparation.

| Dimension              | Current Orbit budgeted strategy               | Paper EoCC                                         | Paper SAC                                        |
| ---------------------- | --------------------------------------------- | -------------------------------------------------- | ------------------------------------------------ |
| Trigger                | Estimated token threshold or recovery         | Conversation threshold with handoff reserve        | Each completed environment action                |
| Summary input          | Eligible older prefix and previous checkpoint | Working state at the end of a conversation stretch | Previous state and latest action/result          |
| Next context           | Structured summary and retained raw suffix    | Original instructions/task and handoff             | Original instructions/task and updated handoff   |
| Raw recent tool output | Retained when protected                       | Represented through recap after reset              | Represented through recap before the next action |

Lower thresholds alone retain Orbit's current suffix semantics. Reset projection
and action scheduling are distinct changes.

The existing [E2E guide](../e2e-evaluation.md) and
[results index](../../e2e/results/README.md) document selected SWE-bench
Lite/Verified diagnostics with Ollama, Docker and official patch grading.
Terminal-Bench integration is proposed here as additional confirmation work.

## Decision Drivers

- Preserve existing callers, saved sessions and execution evidence.
- Isolate changes in context policy from model and tool behavior.
- Measure task completion and total cost, including summarization.
- Keep raw history recoverable through canonical records.
- Reproduce comparisons across pinned tasks and runtime revisions.

## External Implementation Research

The following pinned source inspections were performed during the Issue #22
investigation on 2026-11-09 and inform this proposal.

**Codex** at `5adb68a49933ae446bf11935662c83dba55a0804`,
`codex-rs/core/src/compact.rs`, reconstructs compacted history with selected user
messages and a summary, reinjecting initial context. Adopt explicit reconstruction
and user-context retention as design lessons. Keep Orbit's own structured
checkpoint and journal contracts rather than importing the response-item format.
[Inspected source](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/core/src/compact.rs)

**Pi Coding Agent** at `b79e4cc834970cca69daebffab7df1da7d1e52c4`,
`packages/coding-agent/src/core/compaction/compaction.ts`, separates cut selection
and preparation from summary generation, retaining recent tokens and supporting
split turns. Adopt explicit boundaries and staged preparation. Orbit's verified
tool-group and execution-evidence requirements govern admissible cuts.
[Inspected source](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/src/core/compaction/compaction.ts)

**You don't need long context**, arXiv:2611.05306v1, compares full-history
accumulation, threshold-based EoCC and per-action SAC. Its SAC experiments cover
SWE-bench Verified and Terminal-Bench 2.1. Long-input experiments also change
input presentation to selective file reading, so their gains combine retrieval
and context management. The paper's optimized retail cost figures are modeled
estimates. Its SSSM proposal concerns future training. The implementation plan
here follows the paper's regime descriptions and appendix prompts; the authors'
experiment code was not inspected. [Paper](https://arxiv.org/html/2611.05306v1)

**Terminal-Bench and Harbor**, official documentation inspected on 2026-11-11,
provide containerized agent execution and task-specific verification. Use an
Orbit adapter and pinned task releases. Pin the Harbor source/package version
and dataset revision during adapter implementation before recording results.
[Official introduction](https://www.tbench.ai/news/announcement-2-0)

## Considered Options

1. Keep changing thresholds within the current implementation. This is cheap but
   cannot express reset projections or SAC's action boundary.
2. Add independent full preparation pipelines for each regime. This makes
   experiments quick initially but duplicates evidence and persistence checks.
3. Use a shared coordinator with independently selected internal strategies and
   algorithms. **Proposed**, because it
   supports experiments with one owner for validation and durable activation.
4. Expose arbitrary strategy plugins immediately. Defer until built-in regimes
   establish a stable result and replay contract.

## Implementation and Confirmation

### Compatibility extraction

Extract the current strategy and algorithm behind the coordinator. Compare captured serialized
requests, retained message IDs, summary inputs, fallback outcomes and resumed
contexts with existing behavior. Cover old settings and checkpoint fixtures,
model changes, unknown strategies, invalid summaries, cancellation, stale heads
and failed synchronization. Update affected session/agent tests and exports only
when a public contract is deliberately introduced.

Add a deterministic A/C, A/D, B/C and B/D composition matrix with compatible
stub algorithms. Assert selected source ranges, retained messages, algorithm
selection and shared continuation limits. Test rejection of incompatible schemas
and missing cumulative-update support before calls, and verify replay performs
zero summary/tool calls even when the producing algorithm is unavailable. Cover
changing algorithms between runs and explicit legacy-pair defaults.

### Terminal-Bench integration and baseline

Add an opt-in Harbor adapter under the E2E tooling that launches the pinned Orbit
build inside each task environment. Pin model identity, agent configuration,
container image, harness and dataset. Begin with a fixed small smoke set and
confirm setup, inference endpoint access, artifact export, timeout/cleanup and
official verifier execution. Run task oracle controls where provided and verify
an incomplete solution fails. Keep verifier artifacts outside agent-visible
inputs according to the harness contract.

For paper-oriented comparisons, target Terminal-Bench 2.1 and verify availability
and exact revision before running. A newer release is a separately named suite.
Record CPU/memory limits and architecture, including emulation on ARM hosts.
Infrastructure failures get their own outcome with a fixed denominator and retry
policy. Retain the existing SWE-bench runner and add a common result projection
where its evidence fields fit; benchmark-native grading remains authoritative.

### EoCC and SAC experiments

After reset-format review, implement EoCC with reserved handoff capacity and
whole-request accounting. Evaluate supported total-limit/trigger pairs beginning
with 48K/36K, 32K/24K and 16K/12K. Bound the summary call and validate the rebuilt
request before committing it.

Add SAC after EoCC replay is verified. The paper-style harness permits one
actual environment action per working context, followed by a tool-free state
update. Configure one-action behavior consistently across comparison arms.
Reject multi-action model responses before dispatch in this experimental mode
and account for retries; never silently discard requested tool calls. A
multi-tool-round variant receives a separate name and results. General Orbit
multi-turn interaction and new user input must retain canonical task updates.

### Measurements and acceptance

Vary the strategy while holding the algorithm fixed, then vary the algorithm
while holding the strategy fixed. Record both identities, revisions and parameters
for every result. Keep execution continuation, retries, model, tools and resource
limits matched across these comparisons.

Compare fresh full-history sessions, the current budgeted strategy, EoCC and SAC
on fixed SWE-bench and Terminal-Bench tasks. Use development tasks to tune budgets
and separate held-out tasks for final comparison. Include naturally long runs
that actually compact and deterministic fixtures for exact information retention.
Record compaction counts so inactive policies cannot masquerade as evidence.

Measure native task success, normal Agent completion, peak live context, total
input/cache/output tokens for all worker and summary calls, repeated tool work,
summary failure counts, wall time and actual billed cost when available. Keep
estimated and unknown usage explicit. Repeat paired runs and report confidence
intervals with task IDs, repetitions and seeds. Predeclare any quality tolerance
before held-out testing. Report default-setting and matched one-action harness
experiments separately.

Acceptance of the extraction requires compatibility and failure/replay tests.
Acceptance of each experiment requires reproducible configuration and complete
outcome accounting. A default change needs an explicit later decision supported
by measured quality and efficiency. Run the repository's required header, build
and test checks for implementation changes, plus E2E adapter checks and recorded
live benchmark confirmation. Documentation-only proposal validation checks links,
metadata, formatting and diff scope.

## Follow-up Work

- Review the proposed boundary and finalize reset-schema migration details.
- Select and pin Terminal-Bench tasks and Harbor version, then establish baselines.
- Implement extraction, EoCC and SAC in successive reviewable changes.
- Set evaluation repetitions, resource limits and quality tolerance before final runs.
- Update maintained architecture, settings and evaluation documentation with the
  corresponding implementation. Link any partial supersession of older ADRs at
  acceptance while preserving their rationale.

## References

- [Issue #22](https://github.com/cybergarage/orbit/issues/22)
- [Budgeted Session Compaction](2026-09-08-budgeted-session-compaction.md)
- [Long-Turn Context Recovery](2026-09-25-long-turn-context-recovery.md)
- [Verified Interrupted Tool Context](2026-09-14-verified-interrupted-tool-context.md)
- [Source-derived Tool Observations](2026-09-29-source-derived-tool-observations.md)
- [Evidence-based Workflow Evaluation](2026-09-12-evidence-based-workflow-evaluation.md)
