# Glossary

This glossary is the authoritative home for shared Orbit concept terminology.
Definitions describe the conceptual model; each entry states when the current
implementation is narrower.

## Terms

### Adaptive Execution

A directional control-plane capability that uses recorded evidence to propose,
evaluate, approve, promote, and roll back Processor Graph versions. It is not
currently implemented. See [Adaptive Execution](adaptive-execution.md).

### Agent

The current orchestration object that runs one bounded model/tool turn over a
Session. Conceptually, an agent exposes a goal-oriented runtime contract that
may later be implemented by a Processor Graph.

### Context checkpoint

A validated, synchronized record selecting an untrusted summary and retained
conversation suffix for model input. It preserves original Session messages and
does not replace execution journal evidence. Current budgeted preparation uses
transcript v2; see [Input budgets and compaction](../context-compaction.md).

### Control plane

The mechanisms that validate, evaluate, select, promote, and roll back runtime
configuration or graph versions. This is distinct from executing a user run.

### Directional

A design concept that guides investigation but is not an approved decision,
implementation claim, or delivery commitment.

### Edge

A declared, validated transition from one Processor output to another
Processor input. General graph edges are directional and not currently
implemented.

### Execution plane

The runtime that admits a run, invokes its fixed graph version, enforces
budgets and policy, records evidence, and produces a terminal outcome.

### Graph version

An immutable identity for a Processor Graph definition and the policies needed
to execute it. Graph versions are directional and not currently implemented.

### Operator

The current TypeScript contract for a named asynchronous `invoke` operation.
Agent, Model, Tool, and OperatorSequence use this contract.

### Processor

A named executable step with explicit input, output, invocation, policy, and
observation boundaries. The current TypeScript interface extends Operator with
required `name` and `type`; the richer contract is directional. Passive data is
not a Processor.

### Processor Graph

A versioned composition of Processor nodes and declared transitions with an
entry, terminal outcomes, budgets, and traceable routing. Orbit does not
currently implement a general Processor Graph. See
[Processor Graph](processor-graph.md).

### Projector

A conceptual Processor role that derives a view, context, or prompt from state
without committing a durable transition. It is not currently a distinct Orbit
interface.

### Reducer

A conceptual Processor role that validates and commits a state transition from
an event or result. It is not currently a distinct Orbit interface.

### Router

A conceptual Processor role that selects one of a graph node's declared
outgoing edges from explicit state and output. It cannot invent an undeclared
destination. Orbit does not currently implement Router as a runtime primitive.

### Run

One admitted execution with a run identifier, cancellation boundary, and
terminal outcome. The shared supervisor admits one Agent turn from CLI, GUI or
library. Its immutable result separates execution, quiescence and recording.

### Prepared operation

An immutable description binding parsed input, targets, environment, source and
policy to a trusted executor. A one-use approval authorizes that operation.

### Execution journal

Required, ordered admission, authorization, operation and terminal evidence. It
is separate from the transcript and optional logs; missing outcome records
never authorize replay. See [Managed Execution](../execution.md).

### Quarantine

Retained resource ownership after a bounded result while work or effects remain
unconfirmed. Late evidence does not replace the original terminal result.

### Session

The durable ordered record of messages, turn context, and turn events used to
reconstruct history and model context. Session records are distinct from
runtime logs.

### Skill selection

An ordered choice of catalog source IDs and expected content digests for one Run.
The current implementation validates and snapshots complete instruction sources
before use. It is neither tool authority nor a standing instruction. Historical
snapshots do not reactivate on resume. See [Skills](../skills.md).

### State

The durable and transient facts available to runtime decisions. The current
`State` class owns a Session; a general graph-state model is directional.

### Trace

Correlated evidence of node invocations, edge choices, inputs, outputs,
effects, timing, and terminal outcomes. Current Orbit logs and events provide
part of this evidence but are not yet a complete graph trace.

### Session writer scope

The canonical registered session/journal root pair, its stable v2 pair ID and
Session ID used to
coordinate ownership before and after transcript deletion. A guard protects
short owner transitions; the owner and delegated journal lease span active I/O.
Read-only lock inspection does not grant ownership. See [session storage](../session-storage.md).

### Storage registration guard

A persistent marker in each registered root that prevents writable admission
while offline registration changes or resynchronizes reciprocal bindings. It is
distinct from a Session's short ownership-transition guard. Its presence never
proves external administrative exclusion, and it is never reclaimed online.
Last guard removal establishes logical readiness after prerequisite syncs; API
success additionally requires final namespace synchronization. See
[session storage](../session-storage.md).

## Status qualifiers

- **Current:** implemented in the maintained repository.
- **Directional:** a non-binding concept under investigation.
- **Proposed:** a concrete decision candidate recorded in an ADR but not yet
  accepted.
- **Accepted:** approved by an ADR; implementation status is recorded
  separately.

See [Orbit Concepts](README.md) for document ownership and status rules.
