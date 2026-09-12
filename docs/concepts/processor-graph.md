# Processor Graph

## Purpose

The Processor Graph is Orbit's directional model for composing Processors and
making agent control flow explicit, inspectable, versioned, and testable.

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

Orbit currently supports a linear `OperatorSequence` and a
`ProcessorRegistry`. The `Agent` contains one hard-coded cycle between model
invocation and tool execution. That cycle is observable and bounded, but it is
not represented as a graph definition.

Orbit does not currently provide a graph schema, graph builder, Router
Processor, graph validator, graph executor, graph persistence, graph migration,
or graph-version binding for runs.

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

An initial implementation should extract the existing bounded model/tool loop
without changing its behavior. General fan-out, joins, subgraphs, and adaptive
promotion can follow only when their semantics and evaluation are justified.

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

The [2026-09-12 bounded execution research](../research/2026-09-12-bounded-processor-graph-execution.md) and [Managed Processor Graph ADR](../adr/2026-09-12-managed-processor-graph.md) compare the earlier internal-loop-first direction with coarse Agent nodes under the implemented Run contracts. The author accepted the latter on 2026-09-12 with one Run/turn, the reviewed lifecycle conditions and explicit journal compatibility costs. See the [acceptance record](../adr/2026-09-12-managed-processor-graph.md#author-acceptance--2026-09-12). It is accepted / not-started; Graph is not implemented. The broader internal-loop-first direction above remains historical/directional and does not expand the adopted first scope; the current implementation section is unchanged.
