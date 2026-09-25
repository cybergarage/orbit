# Concept Overview

## Purpose

Orbit is a TypeScript agent framework for building agent applications. It makes
execution, state transitions, tool use, and control decisions explicit so that
application developers can compose, observe, and test agent behavior.

Orbit's central directional idea is that every executable step is represented
as a Processor. Model calls, tool calls, routing, validation, state reduction,
and composite workflows can then participate in one observable execution
model. This statement is a design direction, not a description of the complete
current implementation.

## Conceptual Model

Orbit separates five concerns:

1. **Intent** enters through an application surface such as the CLI, GUI, or
   library API.
2. **Execution** transforms typed input through named steps.
3. **Control** chooses the next step and enforces budgets and policy.
4. **State** records the durable facts needed to resume, evaluate, and explain
   a run.
5. **Evidence** connects traces and evaluations to later engineering or
   adaptation decisions.

The Processor abstraction belongs to execution. Processor Graphs make control
flow explicit. Adaptive Execution proposes a separate, guarded control plane
that can evaluate and revise graph versions without letting a live run rewrite
itself invisibly.

## Current Orbit Implementation

Orbit currently provides a reusable TypeScript runtime, an oclif CLI, and a
local GUI. The `Agent` runs a bounded model/tool loop over persisted sessions.
Models and tools implement a shared `Operator` invocation contract. A
`Processor` interface, registry, and linear `OperatorSequence` exist, but the
agent loop is not represented as a general Processor Graph.

See [Current Architecture](../architecture.md) for the implemented module and
runtime boundaries.

## Directional Model

The directional runtime treats a workflow as a versioned graph of Processors.
Explicit edges and routers determine legal transitions. A run is bound to an
immutable graph version and emits enough evidence for replay and evaluation.
A separate adaptation process may propose a different graph, but promotion
requires validation, evaluation, policy checks, and rollback support.

This direction intentionally differs from treating a small plugin API as the
primary architecture. Plugins may remain useful packaging or discovery
mechanisms, but executable semantics should cross the Processor boundary so
that observation, policy, testing, and composition are consistent.

## Invariants

- Current and directional behavior are labeled separately.
- Executable steps have stable identity, explicit inputs and outputs, and an
  observable invocation boundary.
- Durable state is not hidden inside incidental call-stack state.
- A live run has configurable aggregate budgets, unlimited by default, and explicit terminal outcomes. Approval and cleanup remain bounded.
- External effects pass through policy-aware boundaries.
- Adaptation never promotes a graph solely because an LLM proposed it.
- Documentation and traces must make the active behavior explainable.

## Non-goals

- Claiming that all application objects or data structures are Processors
- Building a universal workflow language before the core semantics are tested
- Replacing useful standards such as MCP with Orbit-specific transport
- Allowing unbounded recursive execution or self-modification
- Promising autonomous optimization before evaluation and safety foundations
  exist
- Matching every general-purpose agent framework feature

## Related Concepts

- [Agent Runtime](agent-runtime.md)
- [Processor Model](processor-model.md)
- [Processor Graph](processor-graph.md)
- [Adaptive Execution](adaptive-execution.md)
- [Glossary](glossary.md)

## Related Research and Decisions

- [Adaptive Processor Graph Runtime research](../research/2026-09-02-adaptive-processor-graph-runtime.md)
- [Architecture Decision Records](../adr/README.md)
