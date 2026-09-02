# Adaptive Execution

## Purpose

Adaptive Execution is the directional capability to improve Processor Graph
selection or topology from measured outcomes while preserving reproducibility,
policy, human control, and rollback.

It is not implemented and is not an authorization for self-modifying production
behavior.

## Conceptual Model

Adaptive Execution separates two planes:

```text
Execution plane                         Learning and control plane
---------------                         --------------------------
run immutable graph version  --trace--> evaluate outcomes
invoke Processors                       propose candidate graph
enforce budgets and policy  <--promote- validate and replay
record terminal outcome                 canary, approve, or reject
```

The execution plane optimizes for predictable, bounded runs. The learning and
control plane works asynchronously from recorded evidence and produces new
candidate graph versions. Promotion is an explicit state transition, not an
implicit side effect of a model response.

The basic lifecycle is:

1. Trace runs against an immutable graph version.
2. Evaluate outcomes using task-specific quality, cost, latency, reliability,
   and safety measures.
3. Propose a candidate change to routing, Processor configuration, or topology.
4. Validate graph structure, schemas, capabilities, budgets, and policy.
5. Replay representative and adversarial cases in isolation.
6. Compare the candidate with the current version under defined thresholds.
7. Require approval appropriate to the risk, then canary or promote.
8. Monitor and automatically or manually roll back on regression.

## Current Orbit Implementation

Orbit emits structured model, tool, turn, and thread events and persists
session records. These are useful prerequisites for later evaluation, but they
do not constitute an adaptive control plane.

Orbit does not currently define graph versions, evaluation datasets, objective
functions, candidate generation, replay isolation, promotion policy, canary
routing, or graph rollback.

## Directional Model

Adaptation can operate at several levels of risk:

- selecting among already approved graph versions;
- tuning bounded Processor configuration;
- changing Router policy within declared edges;
- adding or removing edges and Processors; or
- introducing a new Processor implementation.

Higher-risk changes require stronger evidence and approval. Early work should
prefer selecting among human-authored, prevalidated graphs. Autonomous topology
generation is a later research question, not the starting point.

Evaluation must resist single-metric optimization. A candidate that improves
task success while increasing unsafe effects, nondeterministic failures,
unbounded cost, or unexplained routing is not an improvement.

## Invariants

- The execution and learning/control planes are separate.
- Historical runs retain the exact graph and policy versions they used.
- Candidates are evaluated outside normal production execution before
  promotion.
- Promotion criteria are explicit, versioned, and auditable.
- Safety, capability, cost, and latency constraints can veto quality gains.
- Risk determines whether promotion is automatic, canaried, or human-approved.
- Every promoted version has a known rollback target.
- Sensitive trace data is minimized and governed throughout evaluation.

## Non-goals

- Online mutation of an active run's topology
- Using user-visible production activity as an ungoverned training set
- Treating model self-critique as sufficient evaluation
- Optimizing a single benchmark without regression and safety coverage
- Removing human responsibility for high-impact changes
- Promising continual autonomous learning as a current Orbit feature

## Related Concepts

- [Concept Overview](overview.md)
- [Processor Graph](processor-graph.md)
- [Processor Model](processor-model.md)
- [Agent Runtime](agent-runtime.md)

## Related Research and Decisions

- [Adaptive Processor Graph Runtime research](../research/2026-09-02-adaptive-processor-graph-runtime.md)
- [Session-scoped Logging Architecture](../adr/2026-08-25-session-scoped-logging.md)
- [Architecture Decision Records](../adr/README.md)
