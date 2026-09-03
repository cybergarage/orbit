---
status: current
investigation-date: 2026-09-03
orbit-commit: 4280368ed7dc05900006e6a6fef946410a4c71b9
related-adrs: []
superseded-by: []
---

# LangGraph Concepts, Intermediate Representations, and Orbit Processors

## Purpose

This note investigates the concepts and graph-runtime capabilities exposed by
LangGraph.js, whether LangGraph has an intermediate representation beyond its
programmatic builder API, and how those concepts correspond to Orbit's current
and directional vocabulary. It then evaluates whether Orbit's current
`Processor` interface is sufficient for a graph runtime and sketches
non-binding implementation options, including an explicit condition node.

This is point-in-time research, not an architecture decision. The interfaces
and document shapes below are proposals for later ADRs. They do not authorize a
graph implementation or change Orbit's maintained contract.

## Research Questions

1. Which terms does LangGraph.js use for graph definition, routing, state,
   scheduling, persistence, suspension, and composition?
2. Which graph capabilities are available at the pinned LangGraph.js release?
3. Does LangGraph expose a portable intermediate representation from which an
   executable graph can be reconstructed without the original program code?
4. How do LangGraph concepts map to current and directional Orbit concepts?
5. Is Orbit's current `Processor` interface sufficient as a graph-node
   contract?
6. If a condition is represented as a Processor, what should it return and
   which responsibilities must remain in the graph executor?

## Summary of Findings

1. **LangGraph's central runtime vocabulary is State, Node, Edge, Channel, and
   super-step.** `StateGraph` is the main explicit graph builder. Nodes return
   state updates, reducers combine updates, edges activate later nodes, and the
   compiled Pregel runtime advances through message-passing super-steps.
2. **Control flow includes more than binary conditions.** Fixed edges,
   conditional edges, conditional entry, parallel fixed edges, `Send` for
   dynamic fan-out, `Command` for update-plus-routing, subgraphs, `START`, and
   `END` cover branches, loops, map/reduce, composition, and termination.
3. **Durable execution is part of the runtime model.** Checkpointers record
   channel state and version information at super-step boundaries. Threads,
   interrupts, resume commands, state history, retry, timeout, cache, and
   streaming build on that execution model.
4. **LangGraph has several useful representations, but no single public,
   portable, executable graph IR was found.** The `StateGraph` builder contains
   live functions and Runnable objects. `CompiledStateGraph` lowers them into
   Pregel nodes, channels, triggers, and writers. `getGraph()` and the
   `AssistantGraph` API expose a serializable topology for inspection. A
   checkpoint stores execution state. `langgraph.json` locates exported graph
   code. None of the latter three preserves enough executable semantics to
   rebuild the original graph independently of that code.
5. **Orbit's `Processor.invoke()` is a useful leaf-call shape, but the current
   Processor contract is not sufficient for an interoperable graph runtime.**
   It lacks standardized graph context, runtime input/output schemas,
   descriptor and factory metadata, route outcomes, capabilities, and stable
   versions. The registry also stores only live instances and does not expose a
   catalog suitable for validation or an editor palette.
6. **A graph should not be encoded inside Processor implementations.** Orbit
   needs a separate serializable graph definition, compiler/validator, compiled
   execution plan, executor, and run snapshot. Processors provide node
   semantics; graph data declares topology.
7. **A Condition can be a Router Processor, but it should return a closed route
   key rather than a destination node ID.** The graph executor resolves that
   key against predeclared outgoing edges. This keeps Processor implementations
   reusable, makes all destinations statically validatable, and prevents a
   Processor or model from inventing an executable target.

## Investigation Scope and Revisions

The investigation was performed on 2026-09-03. Implementation claims are
bounded by these revisions.

| System       | Release or baseline                                 | Full source revision                                                                                                                    | Scope                                                                                                                                                   |
| ------------ | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Orbit        | current local baseline                              | [`4280368ed7dc05900006e6a6fef946410a4c71b9`](https://github.com/cybergarage/orbit/commit/4280368ed7dc05900006e6a6fef946410a4c71b9)      | Processor and Operator contracts, registry, sequence, Agent loop, State, ThreadManager, and directional Processor concepts                              |
| LangGraph.js | `@langchain/langgraph@1.4.13`, published 2026-08-26 | [`3609b35036f18c5a0cf9746910a45e0ab65ccf97`](https://github.com/langchain-ai/langgraphjs/tree/3609b35036f18c5a0cf9746910a45e0ab65ccf97) | Graph and Functional APIs, compilation to Pregel, routing primitives, node policies, persistence types, graph inspection API, and deployment descriptor |

The official documentation pages referenced below are mutable. The source
revision above is the reproducible LangGraph.js implementation baseline.

Codex and Pi Coding Agent are not re-inspected in this note. Their agent-loop,
tool, policy, persistence, and extension behavior is already covered at pinned
revisions in
[Adaptive Processor Graph Runtime](2026-09-02-adaptive-processor-graph-runtime.md).
This investigation asks a narrower question about LangGraph terminology and
representation layers. Neither Codex nor Pi supplies additional evidence about
LangGraph's builder, Pregel compilation, drawable topology, or checkpoint
formats.

## Orbit Baseline

### Current executable contracts

The following facts are verified at the pinned Orbit commit:

- `Operator` declares `getName()` and asynchronous `invoke(input, options)`.
  Its TypeScript generics express compile-time input, output, and option types,
  but the interface does not require corresponding runtime schemas.
- `Processor` extends `Operator` with required `name` and `type` properties.
  `ProcessorType` is currently an alias of `OperatorType` and is limited to
  `agent`, `model`, `sequence`, and `tool`.
- `ProcessorRegistry` registers a live Processor instance by `type:name` and
  looks it up by that pair. It has no descriptor enumeration, version binding,
  factory, configuration schema, capability declaration, or compatibility
  check.
- `OperatorSequence` runs a non-empty array of live Operators in order, passing
  each output directly to the next input. It has no node IDs, edge IDs, entry
  marker, branch, join, or declared terminal result.
- `State` currently wraps a `Session`; it is not a schema-defined graph state
  with per-field merge semantics.
- `ThreadManager` provides one active run per thread, cancellation, terminal
  run events, and model/tool events. It does not expose generic Processor-step,
  edge-selection, graph-version, or checkpoint events.

### Existing graph-shaped behavior

`Agent.invoke()` contains a fixed cycle:

1. invoke the model;
2. inspect the returned message for tool calls;
3. return when no tool calls are present;
4. fail when the tool-iteration budget is exhausted;
5. otherwise execute the tool-call batch and loop back to the model.

This demonstrates three graph-runtime needs already present in Orbit: a
conditional route, parallel work within one model iteration, and a bounded
cycle. They are implemented as control flow inside `Agent`, not as a graph
definition that can be inspected, validated, versioned, or changed by a visual
authoring application.

### Directional Orbit vocabulary

The maintained concept documents already describe a future Processor Graph
with named Processor nodes, validated connections, entry and terminal results,
Routers, failure edges, budgets, subgraphs, and immutable graph versions. The
Processor Model names Projector, Operator, Reducer, Router, and Composite
Processor as semantic roles rather than a mandatory class hierarchy.

Those concepts are useful targets for comparison, but the current source does
not yet implement the graph schema, builder, Router, validator, compiler,
executor, persistence, migration, or graph-version binding.

## LangGraph Terminology and Capabilities

### Authoring vocabulary

| Term                      | Meaning at the pinned LangGraph.js revision                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Graph API                 | Explicit, declarative authoring with `StateGraph`, nodes, state, and edges                                                                                                                 |
| Functional API            | Imperative authoring with ordinary language control flow, `entrypoint`, and `task`; it shares the Pregel runtime but does not expose a statically visualizable graph                       |
| `StateGraph`              | Main stateful graph builder; records state channels, node specifications, fixed edges, waiting edges, and conditional branches before compilation                                          |
| State                     | Shared snapshot read by nodes and routers; nodes normally return partial updates rather than mutating it directly                                                                          |
| `StateSchema`             | Runtime/TypeScript schema definition for graph state and its value semantics                                                                                                               |
| Channel                   | Pregel communication and state-update path. State fields compile to channel implementations such as last-value or reducer-backed channels                                                  |
| Reducer                   | Per-state-key merge function that combines updates, especially when parallel nodes update the same key                                                                                     |
| Node / `GraphNode`        | Named executable function or Runnable that receives state and runtime configuration and returns an update, `Command`, or other supported result                                            |
| Fixed edge                | Declared transition from one named node to another; multiple fixed outgoing edges activate their targets in parallel in the next super-step                                                |
| Conditional edge          | Branch function evaluated after a source node. Its result is mapped to one or more destinations, `END`, or dynamic `Send` packets                                                          |
| `pathMap` / branch ends   | Closed mapping from route values to permitted destination nodes. Declaring destinations also improves validation and rendering                                                             |
| `START` / `END`           | Reserved virtual nodes for entry and termination                                                                                                                                           |
| `compile()`               | Validates the builder and lowers it into an invokable `CompiledStateGraph`/Pregel runtime                                                                                                  |
| `CompiledStateGraph`      | Executable compiled graph that retains its builder for inspection and contains Pregel nodes, channels, triggers, and writers                                                               |
| Pregel                    | Underlying message-passing runtime that activates nodes and advances through discrete super-steps                                                                                          |
| Super-step                | One scheduler iteration; nodes activated together may run in parallel, and their writes become visible according to channel semantics                                                      |
| `Send`                    | Dynamic packet containing a destination node and per-invocation input/state, used for runtime-sized fan-out such as map/reduce                                                             |
| `Command`                 | Structured control value combining state `update`, `goto`, graph scope, or `resume`. Declared node `ends` describe possible dynamic destinations for validation/rendering                  |
| Subgraph                  | A compiled graph used as a node or invoked within another graph; checkpoint namespace and state-schema choices govern composition                                                          |
| `ToolNode`                | Prebuilt node that executes tool calls found in message state                                                                                                                              |
| `toolsCondition`          | Prebuilt router returning `tools` when the latest AI message has tool calls and `END` otherwise                                                                                            |
| Node policy               | Per-node or default retry, cache, timeout, deferred execution, and error-handling behavior available on the builder                                                                        |
| Checkpointer / checkpoint | Persistence boundary for channel values, channel versions, and node-observed versions. Checkpoints are organized by thread and saved at super-step boundaries                              |
| Interrupt / resume        | Durable suspension from inside a node and resumption by invoking with `Command({ resume })`; the interrupted node restarts from its beginning, so effects before an interrupt must be safe |
| Store                     | Long-term memory separate from per-thread checkpoint state                                                                                                                                 |
| Streaming                 | Runtime projections including values, updates, messages, custom data, tools, events, and debug information                                                                                 |
| Drawable graph            | Inspection projection returned by `getGraph()`/`getGraphAsync()` and rendered as Mermaid or PNG; includes nodes, edges, labels, conditional markers, and optionally expanded subgraphs     |
| Assistant graph/schema    | Server/SDK inspection APIs exposing JSON nodes and edges separately from JSON Schemas for input, output, state, configuration, and context                                                 |
| `langgraph.json`          | Deployment/application descriptor that maps graph IDs to `<file>:<export>` code locations and configures environment or server concerns; it does not contain the graph topology            |

### Execution model

At a high level, LangGraph's explicit Graph API follows this lifecycle:

1. define the state schema and reducer behavior;
2. add named executable nodes;
3. add fixed edges and conditional branches from `START` through zero or more
   cycles to `END`;
4. compile and validate the builder;
5. lower nodes and edges into Pregel nodes, channels, triggers, and writers;
6. invoke or stream the compiled graph;
7. activate nodes when messages arrive on subscribed channels;
8. execute all active work for the super-step, then apply channel updates;
9. optionally persist a checkpoint and continue until no active work remains,
   an interrupt suspends execution, or an error/budget stops the run.

The Functional API is an alternate authoring surface, not a separate runtime.
It wraps functions as `entrypoint` and durable units as `task`, while ordinary
`if`, loop, and function-call syntax controls execution. Official documentation
states that its graph is dynamically generated at runtime and is not supported
for static graph visualization. That makes it less suitable than the Graph API
as a direct model for Orbit's future visual graph authoring, although its task
replay and idempotency guidance remains relevant.

### Control-flow behavior that matters to Orbit

| Behavior                  | LangGraph mechanism                                                                | Orbit implication                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Sequence                  | Fixed edge `A -> B`                                                                | Current `OperatorSequence` covers invocation order but not named topology or graph metadata                                      |
| Binary or multi-way route | Conditional edge plus route mapping, or `Command.goto` plus declared `ends`        | Orbit needs closed route keys and statically declared destinations                                                               |
| Conditional entry         | Conditional edge from `START`                                                      | Entry should be a normal validated routing position, not application-only pre-processing                                         |
| Parallel fan-out          | Multiple fixed outgoing edges or a list returned by a router                       | A scheduler and deterministic state merge rules are required                                                                     |
| Dynamic fan-out           | `Send(node, input)` packets                                                        | Runtime-created tasks must still target declared capabilities/nodes and carry bounded, valid input                               |
| Fan-in                    | Multi-source waiting edges and state reducers                                      | Topology alone is insufficient; join activation and merge semantics must be explicit                                             |
| Loop                      | Edge to an earlier node; recursion limit and application conditions stop execution | Orbit's directional invariant is stronger: every admitted cycle must have an explicit finite budget or enforced terminating rule |
| State plus route          | `Command({ update, goto })`                                                        | Convenient, but couples data transition and control; Orbit should decide whether Reducer and Router remain separately observable |
| Tool loop                 | `ToolNode` plus `toolsCondition`                                                   | Closely matches Orbit's current fixed model/tool loop and is a useful first extraction target                                    |
| Subgraph                  | Compiled graph used as a node with namespaced persistence                          | Matches directional Composite Processor, but state and checkpoint ownership need an ADR                                          |
| Human approval            | `interrupt()` plus checkpoint/thread and `Command.resume`                          | Cancellation alone is insufficient; suspension is a durable non-terminal run state                                               |
| Failure recovery          | Retry policy, timeouts, node error handlers, checkpoint replay                     | Exception handling must be separated into attempt policy, compensating route, run failure, and replay semantics                  |

## Does LangGraph Have an Intermediate Representation?

### Precise answer

The inspected LangGraph.js surfaces expose **several representations at
different lifecycle stages**, but not one public, language-neutral, portable
executable graph IR. Calling every representation “the LangGraph IR” would hide
important semantic differences.

| Representation                          | Purpose                                    | Serializable as useful JSON?                              | Contains executable semantics?                                                                   | Can independently rebuild the graph?                           |
| --------------------------------------- | ------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `Graph` / `StateGraph` builder          | Programmatic authoring                     | Not as a portable definition                              | Yes: stores live functions/Runnables, schemas, reducers, policies, and branches                  | Yes, while the original program objects remain available       |
| `CompiledGraph` / `CompiledStateGraph`  | Executable Pregel plan                     | Not exposed as a stable portable graph document           | Yes: Pregel nodes, channels, subscriptions/triggers, writers, branch writers, and policies       | It is already executable, but tied to runtime objects and code |
| Drawable `Graph` / SDK `AssistantGraph` | Inspection, visualization, and Studio APIs | Yes: node/edge topology, labels, metadata, condition flag | No node code, reducer implementation, route function, full policy, or faithful compiled channels | No                                                             |
| `GraphSchema`                           | Describe I/O, state, config, and context   | Yes: JSON Schema where generation succeeds                | Validation shapes only; no topology or node implementation                                       | No                                                             |
| Checkpoint / state snapshot             | Resume, history, recovery, and time travel | Stored through a serializer/checkpointer                  | Runtime channel values and version clocks, plus pending writes/metadata around the checkpoint    | No; it stores execution state, not the program                 |
| `langgraph.json`                        | Locate and deploy graph exports            | Yes                                                       | Contains `<file>:<export>` references, not nodes, edges, reducers, or router logic               | Only by loading and executing the referenced application code  |

### Builder as an in-memory high-level representation

`Graph` stores `nodes`, `edges`, and `branches`. Each node specification embeds
a Runnable created from the supplied action. Each branch embeds another
Runnable for the routing function. `StateGraph` additionally stores channels,
waiting edges, schemas, and node policies.

This resembles a compiler's high-level intermediate graph, but it is a mixed
code-and-data object graph. A closure capturing a client, a custom reducer, or
a Runnable with process-local dependencies cannot be reconstructed from the
topology alone. It is therefore unsuitable as Orbit's portable saved visual
document without another reference and instantiation layer.

### Compiled Pregel plan as an internal lower-level representation

`compile()` validates the builder, creates a `CompiledStateGraph`, and attaches
nodes, edges, and branches. Fixed edges become channel subscriptions and
triggers. Conditional branches install branch writers and branch-specific
ephemeral channels. State fields become channels whose implementations define
update behavior. The resulting object extends `Pregel` and contains executable
node and channel instances.

This is an effective internal execution plan. However, the inspected API does
not present it as a stable interchange format, and it still contains executable
objects. Orbit can borrow the **separation** between authoring graph and compiled
plan without copying its internal representation.

### Drawable graph as a lossy inspection projection

`CompiledGraph.getGraphAsync()` rebuilds a drawable graph from the retained
builder. It emits nodes and fixed edges, expands declared branch ends into
conditional labeled edges, includes destinations declared by `Command` node
`ends`, and can optionally expand subgraphs. The SDK's `AssistantGraph` shape
contains node IDs/data/metadata and edges with source, target, data, and a
conditional flag.

This representation is appropriate for rendering and inspection. It is not a
round-trip executable definition: the condition flag and label do not contain
the routing function, the node data does not guarantee an instantiable
Processor reference, and reducers, checkpoints, credentials, capabilities, and
complete policies are separate or absent.

### Checkpoint as execution state, not program IR

The pinned checkpoint format contains a format version, checkpoint ID,
timestamp, `channel_values`, `channel_versions`, and `versions_seen` per node.
The surrounding tuple can include configuration, metadata, parent
configuration, and pending writes. This is sufficient to determine which
channel updates a node has observed and to resume Pregel execution when paired
with the same executable graph.

It does not identify a self-contained graph definition. Orbit should therefore
bind every future run snapshot to an immutable graph version and refuse an
unsafe resume when the required compiled semantics are unavailable or
incompatible.

### Deployment descriptor as code lookup, not topology

At the pinned JavaScript CLI source, the `graphs` property in `langgraph.json`
is a record whose values are import strings in `<file>:<export>` form, with an
optional description wrapper. The runtime obtains graph semantics by importing
and executing that code. This is a deployment registry, not an authoring IR.

### Conclusion for Orbit

LangGraph validates the value of multiple representations but does not remove
Orbit's need for a canonical semantic graph definition. Visual authoring,
immutable graph versions, safe Processor discovery, and offline validation
require Orbit to define a serializable representation that references known
Processor semantics rather than embedding arbitrary JavaScript.

## LangGraph-to-Orbit Concept Mapping

The table distinguishes current implementation from directional terminology so
that conceptual similarity is not mistaken for shipped support.

| LangGraph concept               | Current Orbit implementation                                                                           | Directional Orbit concept                  | Assessment                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------ | ----------------------------------------------------------------------------------- |
| State                           | `State` wraps one `Session`; messages and turn data live in the Session                                | Explicit graph/run state                   | Name overlap only; merge and channel semantics differ                               |
| State schema                    | TypeScript generics on individual interfaces; concrete message/tool validation in places               | Validated Processor ports and graph state  | No common runtime graph-state schema                                                |
| Channel / reducer               | Direct return-value chaining; Session mutation; tool-result accumulation inside `Agent`                | Projector and Reducer roles                | No generic channel or deterministic concurrent merge contract                       |
| Node / node function            | `Operator` and `Processor`                                                                             | Every executable step is a Processor       | Strong conceptual match at the leaf invocation boundary                             |
| Runnable                        | `Operator.invoke()`                                                                                    | Processor invocation                       | Similar executable abstraction, but Orbit lacks a standard graph invocation context |
| Node identity                   | Processor `type:name`; sequence uses object position                                                   | Stable node identity within graph version  | Processor identity and graph-node instance identity are not yet separated           |
| Fixed edge                      | Implicit adjacency in `OperatorSequence`; fixed code flow in `Agent`                                   | Declared graph edge                        | No first-class current edge                                                         |
| Conditional edge / Branch       | `if` statements inside `Agent` or custom Operators                                                     | Router selecting declared edge             | Behavior is possible but opaque to the runtime                                      |
| `START` / `END`                 | Method call entry; returned value or thrown error                                                      | Entry and explicit terminal outcomes       | No graph-level sentinels or typed terminal outcomes                                 |
| `Send`                          | `ToolRuntime.executeAll()` is one domain-specific parallel batch                                       | General fan-out                            | Special case only; no general dynamic task packet                                   |
| Waiting edge / fan-in           | Awaiting a tool batch inside `Agent`                                                                   | Join plus Reducer                          | Special case only; no declared join semantics                                       |
| `Command.update`                | Processor output and direct Session mutation                                                           | Reducer-applied transition                 | No standardized state patch                                                         |
| `Command.goto`                  | Processor can call another object in application code                                                  | Router result plus declared edge           | No structured, validated route outcome                                              |
| Pregel super-step               | Model/tool iteration is the nearest analogy                                                            | Executor scheduling step                   | Not equivalent: Orbit has no general activation/channel barrier                     |
| Recursion limit                 | `maxToolIterations` for the fixed Agent loop                                                           | Per-cycle and run budgets                  | Useful precedent, but not graph-general                                             |
| Subgraph                        | `OperatorSequence` is a linear composite but does not implement `Processor`; `Agent` is composite code | Composite Processor                        | No generic nested graph or namespace                                                |
| Checkpointer / checkpoint       | Session repository and append-only session/turn records                                                | Graph-run checkpoint and replay            | Conversation durability is not graph execution durability                           |
| Thread                          | `ThreadManager` owns Agent runs and Session continuity                                                 | Run ownership and resumable graph context  | Partial lifecycle match                                                             |
| Interrupt / resume              | `AbortSignal` cancellation ends a run                                                                  | Durable suspension and resume              | Cancellation is terminal; no suspended Processor state                              |
| Node retry/cache/timeout        | Concrete model/tool behavior and errors; no generic node policy                                        | Processor policy                           | No graph-level uniform contract                                                     |
| Streaming / debug events        | Agent, thread, diagnostic, and log events                                                              | Per-step and per-edge observation          | Useful infrastructure, but events are model/tool-specific                           |
| Drawable graph                  | No runtime graph projection                                                                            | Inspectable graph                          | Not implemented                                                                     |
| Graph compiler/validator        | Empty sequence and duplicate registry key checks only                                                  | Candidate validation and immutable version | Not implemented                                                                     |
| `langgraph.json` graph registry | No equivalent executable-graph manifest                                                                | Graph version referencing Processors       | Skills manifest is not an executable graph definition                               |

## Is the Current Processor Interface Sufficient?

### Short answer

**It is sufficient only as the smallest asynchronous call primitive for a leaf
node. It is not sufficient as the complete graph-node, authoring, or execution
contract.**

An application can write a class that implements `Processor` and put an `if`
statement in `invoke()`. It can also write its own graph executor around a set
of Processor instances. Those facts demonstrate extensibility, not a stable
Orbit graph contract.

### Capability assessment

| Concern                                    | Current Processor or registry support                                    | Required for a first-class graph                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Invoke one unit of work                    | Yes, through `invoke()`                                                  | Retain this property                                                                         |
| Heterogeneous node input/output            | Compile-time generics only                                               | Runtime schemas and validated adapters                                                       |
| Cancellation                               | Possible only through concrete option types such as `AgentInvokeOptions` | Standard graph invocation context with `AbortSignal`                                         |
| Trace identity                             | Not required by `ProcessorOptions`                                       | Graph ID/version, run ID, step/task ID, node instance ID, attempt, parent/subgraph namespace |
| Processor discovery                        | Lookup of already-created instance                                       | Enumerated descriptors, versions, configuration schemas, factories, and availability state   |
| Condition semantic type                    | No valid `ProcessorType` for Router/Condition                            | A role/capability or type extension decided by ADR                                           |
| Closed set of route outcomes               | No                                                                       | Declared route keys validated against graph edges                                            |
| State update                               | Arbitrary output or hidden mutation                                      | Defined patch/reducer semantics                                                              |
| Failure/suspension outcome                 | Rejected Promise only; no suspension                                     | Classified failure, retryability, suspension token/payload, and terminal outcomes            |
| Side effects and capabilities              | Not declared                                                             | Preflight policy and authorization metadata                                                  |
| Stable semantics across graph versions     | `type:name` only                                                         | Immutable Processor implementation/config version binding                                    |
| Topology                                   | None                                                                     | Separate serializable graph definition                                                       |
| Scheduling, join, cycle, and budget policy | None                                                                     | Compiler and executor                                                                        |
| Checkpoint compatibility                   | None                                                                     | Run snapshot bound to graph and Processor versions                                           |

### Preserve, adapt, or replace

There is no evidence that Orbit must discard `Processor.invoke()`. A lower-risk
direction is to preserve it as the executable leaf boundary and add separate
contracts around it:

1. **Processor descriptor and factory** for discovery, versioning,
   configuration, schemas, roles, and capabilities;
2. **graph definition** for portable semantic topology;
3. **compiler and validator** that bind node definitions to concrete Processor
   implementations and construct an immutable plan;
4. **graph invocation context** supplied consistently to every Processor;
5. **structured route/state/failure conventions** used by built-in graph
   Processors or adapters;
6. **executor and checkpoint format** that own scheduling and durability.

Whether these become additions to `Processor`, companion interfaces, or a
versioned `ProcessorV2` is an ADR question. Adding every concern directly to
the current interface would make simple tools and models implement graph-only
metadata and would conflate executable behavior with catalog records.

## Non-binding Orbit Representation Proposal

### Separate five artifacts

Orbit should consider five explicit artifacts rather than one overloaded
“graph JSON” object:

| Artifact                   | Authority and lifetime                                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Semantic `GraphDefinition` | Canonical, serializable authoring IR; immutable once admitted as a graph version                                           |
| `CompiledGraphPlan`        | Internal runtime plan resolved against one Processor catalog/policy snapshot; reproducible from definition plus versions   |
| `GraphViewDocument`        | UI-only positions, groups, colors, viewport, collapsed state, and draft annotations; references semantic IDs               |
| `GraphRunSnapshot`         | Runtime state, pending tasks, attempts, selected routes, budget counters, and checkpoint lineage; binds to a graph version |
| Application manifest       | Which graph versions an application exposes and the environment/policy needed to load them                                 |

This separation follows the strongest lesson from LangGraph's builder,
compiled Pregel plan, drawable graph, checkpoint, and deployment descriptor.
Unlike the inspected LangGraph builder, Orbit's canonical authoring IR would
remain data-only so that a visual editor and a headless loader can round-trip it
without executing arbitrary code.

### Candidate semantic graph shape

The following TypeScript is illustrative and deliberately incomplete:

```ts
type JsonPrimitive = boolean | null | number | string
type JsonValue = JsonPrimitive | JsonValue[] | {[key: string]: JsonValue}

interface ProcessorReference {
  name: string
  type: string
  version: string
}

interface GraphNodeDefinition {
  config: JsonValue
  id: string
  processor: ProcessorReference
}

interface GraphEdgeDefinition {
  from: string
  id: string
  route?: string
  to: string | {terminal: 'cancelled' | 'failed' | 'succeeded'}
}

interface GraphDefinition {
  edges: GraphEdgeDefinition[]
  entry: string
  id: string
  nodes: GraphNodeDefinition[]
  schemaVersion: string
  stateSchema: JsonValue
  version: string
}
```

Properties intentionally absent from this semantic definition include React
coordinates, instantiated Processor objects, JavaScript closures, secrets, and
live service clients. A compiler resolves the `ProcessorReference`, validates
`config` and ports, checks reachability and route exhaustiveness, proves or
enforces cycle budgets, authorizes capabilities, and emits a compiled plan.

The exact state-schema language, port model, version grammar, and condition
expression language need separate decisions. `JsonValue` above only marks the
serialization boundary; it is not a proposal to accept arbitrary untyped JSON
at runtime.

### Graph node ID versus Processor identity

The proposal separates two identities that the current registry does not:

- `ProcessorReference` identifies reusable executable semantics and version;
- `GraphNodeDefinition.id` identifies one configured occurrence of those
  semantics in one graph version.

The same Processor can therefore appear in several nodes with different safe
configuration. Checkpoints and events refer to graph node IDs, while
compatibility and supply-chain records refer to Processor versions.

## Implementing a Condition Through Processor

### Recommended semantic rule

A condition is a specialized Router. It evaluates explicit input and returns a
route key from a declared finite set. It does **not** invoke the selected
destination and does **not** return an arbitrary node name.

```ts
interface RouteSelection<Route extends string> {
  route: Route
}

type BooleanConditionRoute = 'matched' | 'otherwise'

interface ConditionOptions extends Record<string, unknown> {
  signal?: AbortSignal
}

type RouterProcessor<Input, Route extends string> = Omit<
  Processor<Input, RouteSelection<Route>, ConditionOptions>,
  'type'
> & {
  readonly type: 'router'
}

class ConditionProcessor<Input> implements RouterProcessor<Input, BooleanConditionRoute> {
  readonly name = 'boolean-condition'
  readonly routes = ['matched', 'otherwise'] as const

  // Illustrative only: current OperatorType has no Router member.
  readonly type = 'router'

  constructor(private readonly evaluate: (input: Input) => boolean | Promise<boolean>) {}

  getName(suffix?: string): string {
    return suffix ? `${this.type}:${this.name}:${suffix}` : `${this.type}:${this.name}`
  }

  async invoke(input: Input, options?: Partial<ConditionOptions>): Promise<RouteSelection<BooleanConditionRoute>> {
    options?.signal?.throwIfAborted()
    return {route: (await this.evaluate(input)) ? 'matched' : 'otherwise'}
  }
}
```

`RouterProcessor` above is a proposed specialization that retains the current
Processor invocation shape. It cannot extend the **current** `Processor`
interface directly without a type-system change because `'router'` is not a
valid current `ProcessorType`.
Using `tool` or `sequence` merely to satisfy the type would make the catalog and
policy model misleading. An ADR should choose between extending the type set,
adding independent semantic roles/capabilities, or introducing a new versioned
contract.

### Executor behavior

The executor, not the Condition Processor, owns the transition:

```ts
const selection = await condition.invoke(conditionInput, invocationOptions)
const edge = compiledPlan.route(nodeId, selection.route)

if (edge === undefined) {
  throw new GraphExecutionError(`Node ${nodeId} returned undeclared route ${selection.route}`)
}

await scheduler.activate(edge.to)
```

Resolving `(nodeId, route)` against the compiled plan provides three safeguards:

- the Processor is reusable across graphs and does not know topology IDs;
- the compiler can check that every declared route is mapped exactly as the
  selected exhaustiveness policy requires; and
- a compromised or buggy Processor cannot name an undeclared executable
  destination.

### Example visual graph encoding

```json
{
  "schemaVersion": "orbit.graph/v1alpha1",
  "id": "approval-flow",
  "version": "7",
  "entry": "classify",
  "nodes": [
    {
      "id": "classify",
      "processor": {"type": "model", "name": "classifier", "version": "3"},
      "config": {}
    },
    {
      "id": "approved",
      "processor": {
        "type": "router",
        "name": "boolean-condition",
        "version": "1"
      },
      "config": {"predicate": "approval-present"}
    },
    {
      "id": "execute",
      "processor": {"type": "tool", "name": "perform-action", "version": "5"},
      "config": {}
    },
    {
      "id": "request",
      "processor": {"type": "agent", "name": "request-approval", "version": "2"},
      "config": {}
    }
  ],
  "edges": [
    {"id": "e1", "from": "classify", "to": "approved"},
    {"id": "e2", "from": "approved", "route": "matched", "to": "execute"},
    {"id": "e3", "from": "approved", "route": "otherwise", "to": "request"},
    {
      "id": "e4",
      "from": "execute",
      "to": {"terminal": "succeeded"}
    },
    {"id": "e5", "from": "request", "to": {"terminal": "succeeded"}}
  ],
  "stateSchema": {"$ref": "orbit://schemas/approval-flow-state/1"}
}
```

The value of `config.predicate` should identify a registered, reviewable
predicate or a policy-approved expression. Loading arbitrary JavaScript source
from a visual document would bypass skill/Processor discovery, capability
review, signing, and pre-execution validation.

### Explicit condition node versus conditional edge

Both models are legitimate and can coexist only after their semantics are made
unambiguous:

| Model                     | Benefits                                                                                  | Costs                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Router attached to source | Fewer visual nodes; close to LangGraph `addConditionalEdges`; routes on post-node state   | Router execution can be less visible; source node and route policy are coupled                              |
| Explicit Condition node   | Every executable step is visible and independently traceable/testable; natural UI element | Adds a node and state projection boundary; must specify what input the condition reads                      |
| Node returns route itself | Convenient analogue to `Command.goto`                                                     | Couples work, state update, and routing; requires declared `ends` and careful observation/failure semantics |

For Orbit's stated invariant that every executable step is a Processor, an
explicit Router/Condition Processor is the clearest first implementation. A
later optimization may compile a pure Router into an edge predicate without
removing its logical step identity from traces and checkpoints.

### State input and output

The minimal Boolean example hides an important design choice. A real Router
usually needs a read-only view of:

- graph state before the source node;
- the source Processor output;
- the state after any accepted reduction;
- run metadata such as budgets; and
- policy decisions or errors.

Orbit should define this view rather than pass an unconstrained mutable State
object. One possible conceptual lifecycle is:

1. Projector derives the node input from immutable current state.
2. Operator/Processor performs one unit of work and returns output.
3. Reducer validates and commits a state patch.
4. Router reads the resulting view and returns a route key.
5. Executor records the route and activates the declared target.

This preserves the directional Processor roles and avoids LangGraph's
`Command`-style coupling by default. An ADR may still approve an atomic
state-update-plus-route outcome when its replay semantics are specified.

## Proposed Graph Compiler and Runtime Responsibilities

### Loader and catalog

- parse a versioned data-only graph definition;
- reject unknown fields according to a defined forward-compatibility policy;
- resolve every Processor reference to an exact descriptor and factory;
- validate node configuration without instantiating unauthorized effects;
- verify schemas, ports, roles, capabilities, availability, and versions.

### Compiler and validator

- require a valid entry and explicit terminal outcomes;
- reject duplicate IDs, unknown nodes, reserved identifiers, and unreachable
  required nodes;
- validate route keys against the Router descriptor and outgoing edges;
- validate fan-in activation and state merge rules;
- require budgets for cycles and dynamic fan-out;
- classify retriable, failure-route, compensation, cancellation, and terminal
  behavior;
- produce an immutable compiled plan and content-addressed or otherwise stable
  graph-version identity.

### Executor

- supply a standard immutable invocation context and cancellation signal;
- invoke Processors through observation and policy middleware;
- apply validated state transitions through Reducers;
- schedule fixed edges, Router-selected edges, joins, and later dynamic fan-out;
- enforce run, cycle, step, tool, token, time, and concurrency budgets;
- emit graph, node, attempt, route, state, suspension, and terminal events;
- persist checkpoints bound to graph and Processor versions;
- refuse incompatible resume or require an explicit migration.

### View adapter

- translate semantic nodes and ports into React Flow nodes, handles, and edges;
- keep layout and viewport data outside the semantic version unless policy
  deliberately makes presentation reviewable content;
- translate edits back into a candidate definition;
- use client-side validation for feedback while treating backend validation as
  authoritative.

## Suggested Incremental Implementation Order

Each stage is a proposed ADR and implementation gate, not an approved roadmap.

1. **Identity and descriptor ADR:** separate Processor implementation identity
   from graph node identity; add catalog enumeration, exact versions,
   configuration schemas, roles, and capabilities.
2. **Graph definition ADR:** specify the data-only semantic IR, versioning,
   terminals, edge/route model, JSON/schema compatibility, and UI-view
   separation.
3. **Sequential compiler/executor ADR:** compile graphs with an explicit entry,
   sequential nodes, and terminal outcomes while preserving current
   cancellation, policy, and events.
4. **Router ADR:** add closed route keys and an explicit Condition Processor;
   extract the current Agent tool/no-tool decision without behavioral change.
5. **State/Reducer ADR:** define immutable state views, validated patches, and
   deterministic reducer behavior.
6. **Cycle and budget ADR:** represent the current model/tool loop as a bounded
   cycle and bind budget exhaustion to an explicit terminal outcome.
7. **Checkpoint ADR:** define run snapshots, attempt replay, graph-version
   binding, suspension, resume, and migration refusal rules.
8. **Parallelism ADR:** define static fan-out, join activation, deterministic
   merges, concurrency limits, and only then dynamic fan-out.
9. **Subgraph ADR:** define namespaces, state projection, budget inheritance,
   checkpoint ownership, and Composite Processor behavior.

The first executable slice should be deterministic sequential graphs plus an
explicit two-route Condition. It should not begin with general parallel Pregel
semantics, arbitrary expressions, live graph mutation, or dynamic node IDs.

## Risks and Limitations

- LangGraph.js evolves quickly. Node defaults, error handlers, stream modes,
  checkpoint versions, and server APIs at `1.4.13` must not be assumed stable in
  later releases.
- The comparison focuses on LangGraph.js. The Python package may expose similar
  concepts with different names, typing, or maturity.
- A drawable graph can imply greater round-trip fidelity than it provides.
  Declared branch destinations improve rendering but do not serialize the
  branch function.
- TypeScript generic correctness disappears when heterogeneous Processors are
  loaded from JSON. Runtime schemas and adapters are mandatory at that
  boundary.
- Adding `router` to `OperatorType` is not automatically the right design.
  Semantic roles, implementation kinds, effect classes, and registry namespaces
  may need separate axes.
- A declarative condition language creates its own security, determinism,
  versioning, and debugging surface. Choosing CEL, JSON Logic, a restricted AST,
  or registered code requires separate evidence and an ADR.
- “Exactly once” external side effects cannot be inferred from checkpointing.
  Retry and resume require idempotency keys, effect records, or compensation
  appropriate to the Processor.
- LangGraph allows application code to choose dynamic destinations in several
  places. Orbit's directional requirement that all reachable destinations are
  declared is intentionally stricter for validation and policy.

## Open Questions

1. Should `ProcessorType` remain a closed implementation-kind enum, become an
   extensible namespaced kind, or be separated from semantic `roles`?
2. What exact descriptor fields are required before a Processor can appear in
   an editor palette or be loaded from a graph definition?
3. Should the first Router read source output, reduced state, or an explicit
   projected view containing both?
4. Are route sets always closed and exhaustive, or may a default route cover
   unknown values?
5. Which state-schema and reducer model can validate concurrent writes without
   forcing all Processors into one global object shape?
6. Which graph-definition fields participate in immutable semantic version
   identity, and which live only in the view document?
7. How are Processor implementation versions resolved, signed, retained, and
   made available for checkpoint resume?
8. Does suspension become a structured Processor outcome, an executor effect,
   or both?
9. What is the minimum event record needed to reproduce a route choice without
   persisting sensitive state unnecessarily?
10. Should the existing `Agent` remain a composite leaf initially, or should
    its model/tool loop become the first built-in graph?

## Related Decisions

No ADR currently adopts the proposals in this note. Any public Processor
change, graph definition, compiler, Router semantics, checkpoint format, or
visual authoring contract requires a linked ADR before implementation.

## References

### Orbit

- [Operator contract](../../src/core/processor/operator.ts)
- [Processor contract](../../src/core/processor/processor.ts)
- [Processor registry](../../src/core/processor/registry.ts)
- [Operator sequence](../../src/core/processor/sequence.ts)
- [Agent model/tool loop](../../src/core/agent.ts)
- [State](../../src/core/state.ts)
- [Thread manager and events](../../src/core/thread.ts)
- [Processor Model](../concepts/processor-model.md)
- [Processor Graph](../concepts/processor-graph.md)
- [Visual Agent Graph Authoring with React Flow and LangGraph.js](2026-09-03-visual-agent-graph-authoring-react-flow-langgraph.md)
- [Adaptive Processor Graph Runtime](2026-09-02-adaptive-processor-graph-runtime.md)

### LangGraph.js official documentation

- [LangGraph overview](https://docs.langchain.com/oss/javascript/langgraph/overview)
- [Graph API overview](https://docs.langchain.com/oss/javascript/langgraph/graph-api)
- [Use the Graph API](https://docs.langchain.com/oss/javascript/langgraph/use-graph-api)
- [Pregel runtime](https://docs.langchain.com/oss/javascript/langgraph/pregel)
- [Functional API overview](https://docs.langchain.com/oss/javascript/langgraph/functional-api)
- [Choosing between Graph and Functional APIs](https://docs.langchain.com/oss/javascript/langgraph/choosing-apis)
- [Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- [Interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)
- [Subgraphs](https://docs.langchain.com/oss/javascript/langgraph/use-subgraphs)
- [JavaScript application setup](https://docs.langchain.com/langsmith/setup-javascript)
- [LangGraph CLI and configuration](https://docs.langchain.com/langsmith/cli)

### LangGraph.js pinned source

- [`Graph`, `Branch`, `CompiledGraph`, validation, and drawable graph](https://github.com/langchain-ai/langgraphjs/blob/3609b35036f18c5a0cf9746910a45e0ab65ccf97/libs/langgraph-core/src/graph/graph.ts)
- [`StateGraph`, state channels, node policies, and compilation](https://github.com/langchain-ai/langgraphjs/blob/3609b35036f18c5a0cf9746910a45e0ab65ccf97/libs/langgraph-core/src/graph/state.ts)
- [Pregel runtime](https://github.com/langchain-ai/langgraphjs/blob/3609b35036f18c5a0cf9746910a45e0ab65ccf97/libs/langgraph-core/src/pregel/index.ts)
- [Pregel validation](https://github.com/langchain-ai/langgraphjs/blob/3609b35036f18c5a0cf9746910a45e0ab65ccf97/libs/langgraph-core/src/pregel/validate.ts)
- [`Send`, `Command`, and control constants](https://github.com/langchain-ai/langgraphjs/blob/3609b35036f18c5a0cf9746910a45e0ab65ccf97/libs/langgraph-core/src/constants.ts)
- [`ToolNode` and `toolsCondition`](https://github.com/langchain-ai/langgraphjs/blob/3609b35036f18c5a0cf9746910a45e0ab65ccf97/libs/langgraph-core/src/prebuilt/tool_node.ts)
- [Checkpoint and checkpointer types](https://github.com/langchain-ai/langgraphjs/blob/3609b35036f18c5a0cf9746910a45e0ab65ccf97/libs/checkpoint/src/base.ts)
- [SDK graph, schema, assistant, and thread shapes](https://github.com/langchain-ai/langgraphjs/blob/3609b35036f18c5a0cf9746910a45e0ab65ccf97/libs/sdk/src/schema.ts)
- [SDK assistant graph and schema endpoints](https://github.com/langchain-ai/langgraphjs/blob/3609b35036f18c5a0cf9746910a45e0ab65ccf97/libs/sdk/src/client/assistants/index.ts)
- [JavaScript CLI deployment configuration schema](https://github.com/langchain-ai/langgraphjs/blob/3609b35036f18c5a0cf9746910a45e0ab65ccf97/libs/langgraph-cli/src/utils/config.mts)
