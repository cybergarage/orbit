# Processor Graph

## Purpose

The Processor Graph composes executable stages with explicit, inspectable, versioned and testable control flow. Orbit implements a bounded serial subset; broader composition is labeled directional below.

## Conceptual Model

A Processor Graph contains:

- named Processor nodes;
- typed or otherwise validated connections between node outputs and inputs;
- an entry node and explicit terminal outcomes;
- routers that select among declared outgoing edges;
- execution budgets and failure edges;
- immutable graph-version identity; and
- metadata needed for tracing, replay, policy, and evaluation.

Static edges express transitions known at graph construction time. A Router
selects among allowed edges at run time; it does not invent an undeclared
destination. Fan-out can schedule independent branches, fan-in can join their
results, and a composite node can encapsulate a subgraph. Cycles are permitted
only when they have explicit guards and budgets.

## Current Orbit Implementation

The managed Graph runtime compiles serial Agent/tool/transform stages and declared routers with finite visits. It retains one Run, one protected Session turn, one environment/catalog and one Skill snapshot. Agent nodes reuse the common model/tool loop; its internal iterations are not Graph nodes. Legacy OperatorSequence and ProcessorRegistry retain their behavior.

The public descriptor and private configuration are frozen separately. Journal v2 records the binding, acknowledged visits and selected routes, with keyed value digests rather than automatic restart checkpoints. Graph-specific values are published only after confirmed completion; an observed edge is not evidence of destination execution. See [Managed Processor Graphs](../processor-graphs.md) for the implemented API and migration contract.

## Directional Model

A future graph runtime should separate definition from execution:

1. A builder or loader constructs a candidate graph.
2. Validation checks identities, schemas, reachable terminal nodes, cycle
   budgets, required capabilities, and policy constraints.
3. The runtime freezes a graph version and binds a new run to it.
4. The executor invokes nodes and records edge choices against that version.
5. Replay and evaluation use the recorded graph, inputs, outputs, and policy
   results.

Runs should not observe an in-place topology mutation. A revised graph becomes
a new candidate version and affects only runs admitted under an explicit
promotion policy.

The first implementation reuses the existing bounded model/tool loop as a coarse Agent stage. General fan-out, joins, subgraphs and adaptive promotion remain unimplemented directions requiring separate evidence and adoption.

## Invariants

- A run is bound to one immutable graph version.
- All reachable destinations are declared and validated before execution.
- Every cycle has a finite budget or a terminating condition enforced by the
  runtime.
- Entry, success, failure, cancellation, and budget exhaustion are explicit.
- Edge choices are traceable to the responsible Router or deterministic rule.
- Graph composition preserves Processor policy and observability boundaries.
- Invalid or incompatible graphs cannot enter normal execution.

## Non-goals

- Letting an LLM emit an arbitrary node name and execute it immediately
- Mutating the graph underneath an active run
- Requiring a visual editor or general workflow DSL in the first runtime
- Modeling every internal function call as a graph node
- Assuming graph complexity is inherently better than a direct invocation or
  linear sequence

## Related Concepts

- [Processor Model](processor-model.md)
- [Agent Runtime](agent-runtime.md)
- [Adaptive Execution](adaptive-execution.md)
- [Glossary](glossary.md)

## Related Research and Decisions

- [Current Architecture](../architecture.md)
- [Adaptive Processor Graph Runtime research](../research/2026-09-02-adaptive-processor-graph-runtime.md)
- [Architecture Decision Records](../adr/README.md)

The [bounded execution research](../research/2026-09-12-bounded-processor-graph-execution.md) preserves the comparison with the earlier internal-loop-first direction. The [accepted Graph ADR](../adr/2026-09-12-managed-processor-graph.md) owns the chosen first scope and its implementation evidence. It does not adopt broader adaptive execution.
