# Processor Model

## Purpose

The Processor Model gives executable steps one composable and observable
contract. It is intended to make model work, deterministic code, routing, state
changes, and composite workflows understandable through the same runtime
vocabulary.

The precise statement is: **every executable step is represented as a
Processor**. Configuration, messages, graph descriptions, stored artifacts,
and other passive data are not Processors merely because the runtime uses them.

## Conceptual Model

A Processor accepts an input and invocation context, performs one named unit of
work, and returns an output or a typed failure. The boundary should expose
enough metadata to trace the invocation and enforce policy without prescribing
how every Processor is implemented.

Useful conceptual roles include:

- **Projector**: derives a view or prompt from current state without committing
  a durable transition.
- **Operator**: performs work, including model or tool invocation, that may
  produce an effect or a proposed state change.
- **Reducer**: validates and commits a state transition from an event or result.
- **Router**: chooses an allowed outgoing edge from explicit state and output.
- **Composite Processor**: invokes a declared subgraph while presenting one
  external Processor boundary.

These roles describe semantics, not a required class hierarchy.

## Current Orbit Implementation

Orbit currently has an `Operator` interface with `getName()` and asynchronous
`invoke()`. `Agent`, `Model`, and `Tool` implement that interface.
`OperatorSequence` composes a non-empty linear list by passing each result to
the next operator.

`Processor` currently extends `Operator` with required `name` and `type`
properties. `ProcessorRegistry` stores Processors by type and name. The current
Processor types are aliases of the four `OperatorType` values: agent, model,
sequence, and tool.

The managed Graph adds versioned adapters, validated whole-value connections and routers alongside these legacy interfaces. Projector, Reducer, generalized graph context, named ports and general processor middleware remain unimplemented.

## Directional Model

A future Processor contract may add versioned identity, declared input and
output schemas, capabilities, effect classification, retry and timeout policy,
and trace context. Those additions require design decisions because they affect
public APIs, graph validation, persistence, and compatibility.

Processor registration should identify executable semantics. Packaging and
discovery mechanisms, including possible plugins, can supply Processors but
should not create a second execution contract that bypasses observation and
policy.

## Invariants

- A Processor has a stable identity within a graph version.
- Inputs and outputs cross an explicit boundary and are validatable.
- Invocation is observable with correlation to the containing run and step.
- Effects and required capabilities are discoverable before execution.
- Failure is data the runtime can classify and route, not only an uncaught
  exception.
- Composition does not bypass cancellation, budgets, policy, or recording.
- Equivalent deterministic inputs can be replayed without hidden mutable
  process state.

## Non-goals

- Making every class inherit from one base class
- Treating passive data and configuration as executable Processors
- Replacing domain-specific model and tool interfaces with untyped values
- Assuming every Processor is deterministic, pure, remote, or LLM-backed
- Freezing a public graph schema before runtime semantics are validated

## Related Concepts

- [Concept Overview](overview.md)
- [Agent Runtime](agent-runtime.md)
- [Processor Graph](processor-graph.md)
- [Glossary](glossary.md)

## Related Research and Decisions

- [Current Architecture](../architecture.md)
- [Adaptive Processor Graph Runtime research](../research/2026-09-02-adaptive-processor-graph-runtime.md)

## Bounded managed composition

The [managed Graph runtime](../processor-graphs.md) adds explicit versioned Agent/tool/transform/router adapters alongside these legacy Processor interfaces. Agent stages share the existing loop and Run ownership. General Projector/Reducer/composite roles remain directional; they are not implied by this first runtime.
