# Agent Runtime

## Purpose

The Agent Runtime accepts new messages, assembles durable context, invokes a
model, executes requested tools, and produces a terminal response. It is the
bridge between application intent and concrete executable steps.

## Conceptual Model

An agent turn is a bounded state transition:

```text
new input -> context -> model -> route
                            |       |
                            |       +-> terminal response
                            +-> tools -> recorded results -> context -> model
```

The model proposes content and tool calls. Runtime code owns validation,
scheduling, persistence, cancellation, limits, and terminal outcomes. The
model therefore participates in control without becoming the sole authority
over execution.

## Current Orbit Implementation

`Agent.invoke()` owns the current turn lifecycle. It records turn metadata,
builds context from the session, creates a tool snapshot, invokes the selected
model, executes tool calls, and repeats until the model returns no tool calls
or the maximum number of tool iterations is exceeded.

`ThreadManager` gives applications a run identifier, cancellation, lifecycle
events, and one active run per managed thread. `Session` and
`SessionContextBuilder` provide the durable source for later model requests.
Structured diagnostics and logs observe model, tool, turn, and thread
boundaries.

This orchestration is implemented directly in `Agent`; it is not currently a
data-driven Processor Graph.

## Directional Model

The directional model decomposes the turn lifecycle into Processors such as
input admission, context assembly, model invocation, response normalization,
routing, tool execution, state reduction, and terminalization. A versioned
Processor Graph composes those steps while preserving the externally visible
turn contract.

Decomposition is valuable only when it makes policy, tests, replay, and
observation clearer. It must not fragment one coherent lifecycle into hidden
callbacks or let arbitrary nodes bypass persistence and cancellation.

## Invariants

- Each turn has an identity, a finite execution budget, and one terminal
  outcome.
- Every model request is derived from an explicit context snapshot.
- Tool input is validated before external effects occur.
- Model and tool results needed for continuation are recorded in order.
- Cancellation and failure produce observable terminal state.
- Provider-specific formats remain behind the model boundary.
- Runtime policy, not model text alone, authorizes execution.

## Non-goals

- Treating model output as trusted executable code
- Letting a provider adapter own general orchestration
- Hiding control decisions inside prompts when they can be explicit runtime
  rules
- Requiring graph execution for simple direct model or tool invocation

## Related Concepts

- [Concept Overview](overview.md)
- [Processor Model](processor-model.md)
- [Processor Graph](processor-graph.md)
- [Adaptive Execution](adaptive-execution.md)

## Related Research and Decisions

- [Current Architecture](../architecture.md)
- [Adaptive Processor Graph Runtime research](../research/2026-09-02-adaptive-processor-graph-runtime.md)
- [Session Persistence Design](../adr/2026-08-22-session-persistence.md)
- [Session History and Model Context Assembly](../adr/2026-08-23-session-context-assembly.md)
- [Session-scoped Logging Architecture](../adr/2026-08-25-session-scoped-logging.md)
