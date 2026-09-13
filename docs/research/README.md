# Engineering Research

Orbit stores dated, point-in-time engineering investigations in this directory.
Research notes preserve repository evidence, external implementation findings,
comparisons, inferences, and open questions that may inform one or more later
decisions.

Research notes are not Architecture Decision Records (ADRs). They do not approve
an architecture, authorize implementation, or describe the maintained product
contract. Current code and maintained user or API documentation remain
authoritative for implemented behavior.

## When to write a research note

Write a research note when an investigation is useful beyond one immediate
change, compares multiple external implementations, establishes a point-in-time
technical baseline, or may support more than one future decision.

Do not use this directory for routine progress reports, chat transcripts,
temporary plans, unverified idea dumps, release notes, or current product
documentation. Keep narrowly scoped research inside an ADR when extracting it
would add indirection without meaningful reuse.

## Relationship to concepts and ADRs

Research notes preserve evidence and analysis. ADRs preserve decisions made
from that evidence.

Concept documents under `docs/concepts/` may synthesize durable terminology,
mental models, and invariants from several investigations. They must link the
supporting research, label unimplemented behavior as directional, and leave the
dated research note intact as historical evidence. Concepts do not approve an
architecture.

When Orbit adopts, rejects, or materially constrains an architecturally
significant option, create or update an ADR under `docs/adr/` before
implementation. Link the research note from the ADR and link the ADR from the
research note, but keep the ADR self-contained: its purpose, decision,
consequences, decision-relevant evidence, and rationale must stand on their own.

Do not add a `Decision` section to a research note. Recommendations and
implications must be labeled as non-binding. Do not change a research note into
an ADR after a decision is made.

## File names

Use the investigation date and a concise lowercase English topic slug:

```text
docs/research/YYYY-MM-DD-<topic>.md
```

Keep the original filename as historical evidence. If later evidence materially
changes the findings, write a new dated note and link the earlier note through
`superseded-by` instead of rewriting the old investigation as though it had
always contained the new evidence.

## Metadata

Begin each note with YAML front matter:

```yaml
---
status: current
investigation-date: YYYY-MM-DD
orbit-commit: <full 40-character commit hash>
related-adrs: []
superseded-by: []
---
```

Allowed statuses are `current` and `superseded`. `orbit-commit` identifies the
Orbit baseline inspected by the note. `related-adrs` and `superseded-by` contain
repository-relative paths. Use an empty list while no relationship exists.

## Recommended structure

Adapt the following top-level sections to the investigation:

1. `Purpose`
2. `Research Questions`
3. `Orbit Baseline`
4. `External Systems Investigated`
5. `Findings`
6. `Analysis`
7. `Implications for Orbit`
8. `Risks and Limitations`
9. `Open Questions`
10. `Related Decisions`
11. `References`

Put the result of the investigation before long implementation details. Clearly
label verified facts, inferences, and non-binding proposals. Record contrary or
neutral evidence instead of presenting only evidence that supports a preferred
direction.

## Source evidence

For every external implementation used as source evidence, record:

- the investigation date;
- the release, tag, or full source commit;
- the inspected source files or official documentation;
- the verified behavior relevant to the investigation; and
- the limits of the comparison.

Never cite a moving branch as point-in-time implementation evidence without
pinning its full revision. Prefer implementation source and primary official
documentation over secondary summaries. Keep quotations short and link to the
source.

For agent runtime, model, tool, session, context, CLI or GUI agent workflow,
persistence, and observability investigations, inspect Codex and Pi Coding Agent
at pinned revisions by default. If either is not relevant, record why.

## Research index

| Investigated | Status     | Topic                                                                                                                                   |
| ------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-13   | current    | [Human-selected Workflow Candidates](2026-09-13-human-selected-workflow-candidates.md)                                                  |
| 2026-09-12   | current    | [Workflow Evaluation Evidence and Comparable Trials](2026-09-12-workflow-evaluation-evidence.md)                                        |
| 2026-09-12   | current    | [Bounded Processor Graph Execution](2026-09-12-bounded-processor-graph-execution.md)                                                    |
| 2026-09-09   | current    | [Explicit Skill Selection and Run-scoped Instructions](2026-09-09-explicit-skill-selection.md)                                          |
| 2026-09-08   | current    | [Input Budgets and Durable Session Compaction](2026-09-08-input-budgets-and-compaction.md)                                              |
| 2026-09-08   | current    | [Session Storage Registration Review](2026-09-08-session-storage-registration-review.md)                                                |
| 2026-09-08   | superseded | [Session Storage Registration Interruption](2026-09-08-session-storage-registration.md)                                                 |
| 2026-09-08   | current    | [Session Writer Recovery Review](2026-09-08-session-writer-recovery-review.md)                                                          |
| 2026-09-08   | superseded | [Session Writer Lock Recovery](2026-09-08-session-writer-lock-recovery.md)                                                              |
| 2026-09-07   | current    | [Run Execution, Approval, and Required Recording](2026-09-07-run-execution-approval-and-recording.md)                                   |
| 2026-09-04   | current    | [OpenClaw 2.0 Agent Architecture, Work Serialization, and Orbit Gaps](2026-09-04-openclaw-2-agent-architecture-and-orbit-gaps.md)       |
| 2026-09-03   | current    | [LangGraph Concepts, Intermediate Representations, and Orbit Processors](2026-09-03-langgraph-concepts-intermediate-representations.md) |
| 2026-09-03   | current    | [Visual Agent Graph Authoring with React Flow and LangGraph.js](2026-09-03-visual-agent-graph-authoring-react-flow-langgraph.md)        |
| 2026-09-03   | current    | [Grok Bot Architecture and Skill Ownership](2026-09-03-grok-bot-architecture-and-skill-ownership.md)                                    |
| 2026-09-02   | superseded | [Adaptive Processor Graph Runtime](2026-09-02-adaptive-processor-graph-runtime.md)                                                      |
| 2026-09-02   | current    | [Agent Workflow Optimization Papers](2026-09-02-agent-workflow-optimization-papers.md)                                                  |

The [Skill proposal review](../adr/2026-09-09-run-scoped-skill-selection.md#review-findings-and-author-decision--2026-09-12) clarifies ordered request replay, dedicated
summary input, exact snapshot validation and interrupted preparation. That review
left the ADR proposed / not-started. The author subsequently accepted it on
2026-09-12. It was not-started at acceptance; its subsequent [implementation evidence](../adr/2026-09-09-run-scoped-skill-selection.md#implementation-evidence--2026-09-12) records accepted / partial. Research and baseline verification
do not themselves authorize implementation.

The [bounded Graph investigation](2026-09-12-bounded-processor-graph-execution.md) updates the execution baseline and recommends a single managed Run with coarse Agent nodes. Its linked ADR was accepted by the author on 2026-09-12 with implementation not-started at acceptance. Its subsequent [implementation evidence](../adr/2026-09-12-managed-processor-graph.md#implementation-evidence--2026-09-12) records accepted / partial; the earlier accepted/partial records and deferred trials are unchanged. The earlier adaptive-runtime note remains historical evidence, including broader directions outside the new proposal.

The [Graph proposal review](2026-09-12-bounded-processor-graph-execution.md#same-baseline-proposal-review--2026-09-12) corrects value/finalizer assumptions and makes staged catalog validation, replay binding, transcript synchronization and failure-prefix decoding explicit. That review left the ADR proposed / not-started. The author subsequently accepted it; the seven accepted/partial ADRs and deferred trials are unchanged.

The [evaluation investigation](2026-09-12-workflow-evaluation-evidence.md) reuses the optimization-papers research and compares current Run/Graph evidence with missing historical measurements. At investigation, its [ADR](../adr/2026-09-12-evidence-based-workflow-evaluation.md) was proposed / not-started; all eight accepted/partial decisions and author-deferred trials remain unchanged.

The [evaluation review](2026-09-12-workflow-evaluation-evidence.md#same-source-proposal-review--2026-09-13) distinguishes portable identities from journal HMACs, host attestations from raw inspection and immutable terminal results from later settlement. That review retained the original investigation and left the linked ADR proposed / not-started.

The author [accepted the reviewed evaluation contract](../adr/2026-09-12-evidence-based-workflow-evaluation.md#author-acceptance--2026-09-13) on 2026-09-13. Its subsequent [implementation evidence](../adr/2026-09-12-evidence-based-workflow-evaluation.md#implementation-evidence--2026-09-13) records accepted / partial, public text APIs and Unix validation. The proposal/review state descriptions above are historical; research remains non-binding evidence and is not the implementation record.

The [candidate-selection investigation](2026-09-13-human-selected-workflow-candidates.md) distinguishes current per-Run Graph binding and read-only evaluation from proposed application-owned selection. Its [ADR](../adr/2026-09-13-application-owned-workflow-selection.md) remains proposed / not-started. Transactional host storage, evidence eligibility, capture boundaries and recovery costs require review and author judgment; the nine accepted/partial decisions are unchanged.

The [candidate-selection proposal review](../adr/2026-09-13-application-owned-workflow-selection.md#proposal-review--2026-09-13) clarifies one-use dispatch ownership, exact submitted-input encoding, scoped authority/availability transactions and read-only journal binding verification. Actual catalog checks follow managed MCP startup, so startup effects remain observable. The proposal stays proposed / not-started; the nine accepted/partial ADRs are unchanged.
