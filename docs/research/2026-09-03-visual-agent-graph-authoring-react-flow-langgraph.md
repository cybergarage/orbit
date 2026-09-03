---
status: current
investigation-date: 2026-09-03
orbit-commit: 9e706f24817db4b65a7d046b1327fc78faba9333
related-adrs: []
superseded-by: []
---

# Visual Agent Graph Authoring with React Flow and LangGraph.js

## Purpose

This note investigates whether a future Orbit application could let users
define agent behavior visually with React Flow, including conditional branches,
and whether the resulting graph could be represented and executed through
Orbit's current public interfaces. It also compares React Flow's standard UI
primitives with the graph and routing primitives available in LangGraph.js.

This is point-in-time research, not an architecture decision. It does not adopt
React Flow, approve a graph schema, or authorize changes to Orbit's runtime or
GUI.

## Research Questions

1. Can Orbit's current `Operator`, `Processor`, `ProcessorRegistry`, and
   `OperatorSequence` interfaces represent a visually authored conditional
   workflow without application-specific control-flow code?
2. Which parts of a future visual editor could React Flow provide directly, and
   which execution semantics would remain Orbit's responsibility?
3. Which control-flow primitives does LangGraph.js provide for sequences,
   conditions, fan-out, joins, loops, tools, subgraphs, and suspension?
4. How do React Flow's standard nodes, handles, edges, validation callbacks, and
   UI components compare with LangGraph.js runtime primitives?
5. Which architecture decisions would be required before Orbit could safely
   execute a user-authored visual graph?

## Summary of Findings

1. **React Flow can provide the editor, but not Orbit's execution semantics.**
   Its built-in node and edge types are rendering and interaction primitives.
   A conditional node can be drawn as a custom React component with multiple
   source handles, but the application must define what a route means and how it
   executes.
2. **Orbit cannot currently execute a general React Flow graph through its
   public interfaces.** `OperatorSequence` supports only a non-empty linear
   chain. `ProcessorRegistry` resolves already-created Processors by a closed
   type/name pair. Orbit has no graph document, edge, Router, graph compiler,
   topology validator, general graph executor, graph version, or graph
   checkpoint contract.
3. **An application can emulate a condition today, but the condition remains
   hidden implementation code.** A custom `Operator.invoke()` can use an `if`
   statement and call another Operator. That does not make the branch
   serializable, inspectable, statically validatable, traceable as an edge, or
   reconstructible from React Flow JSON.
4. **Orbit's `Agent` already contains one useful behavioral reference.** It
   routes a model response with no tool calls to completion and a response with
   tool calls to `ToolRuntime`, then loops back to the model under an iteration
   limit. The branch and cycle are fixed inside `Agent`; they are not expressed
   as graph data.
5. **LangGraph.js provides the missing semantic category, not the missing visual
   editor.** Its `StateGraph`, nodes, fixed edges, conditional edges, `START`,
   `END`, reducers, `Send`, `Command`, `ToolNode`, `toolsCondition`, subgraphs,
   compilation, and checkpointing form an executable graph runtime. The
   inspected package does not provide React components for drag-and-drop graph
   authoring.
6. **A future integration should keep presentation state separate from the
   executable graph.** Node position, viewport, edge path style, selection, and
   grouping for layout should not silently change the semantic graph version.
   React Flow data should be translated into a separately validated Orbit graph
   definition.

## Investigation Scope and Revisions

The investigation was performed on 2026-09-03. Implementation claims are
bounded by these revisions.

| System       | Release or baseline                                 | Full source revision                                                                                                                    | Scope                                                                                                                    |
| ------------ | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Orbit        | current local baseline                              | [`9e706f24817db4b65a7d046b1327fc78faba9333`](https://github.com/cybergarage/orbit/commit/9e706f24817db4b65a7d046b1327fc78faba9333)      | Current Processor, sequence, registry, Agent loop, thread API, and package exports                                       |
| React Flow   | `@xyflow/react@12.11.6`, published 2026-09-01       | [`0a1f9575b25679f2880175de8d3eae21aedde921`](https://github.com/xyflow/xyflow/tree/0a1f9575b25679f2880175de8d3eae21aedde921)            | React node-editor data types, built-in node and edge renderers, handles, connection validation, and save/restore support |
| LangGraph.js | `@langchain/langgraph@1.4.13`, published 2026-08-26 | [`3609b35036f18c5a0cf9746910a45e0ab65ccf97`](https://github.com/langchain-ai/langgraphjs/tree/3609b35036f18c5a0cf9746910a45e0ab65ccf97) | JavaScript/TypeScript graph builder, routing, execution, state, prebuilt tool routing, and persistence contracts         |

The official documentation pages referenced below are mutable. The source
revisions above are the reproducible implementation baseline.

Codex and Pi Coding Agent are not re-inspected in this note. Their agent-loop,
tool, policy, and extension behavior is already covered at pinned revisions in
[Adaptive Processor Graph Runtime](2026-09-02-adaptive-processor-graph-runtime.md).
This investigation is narrower: it compares an embeddable visual graph editor
with an explicit JavaScript graph runtime. Codex and Pi do not supply evidence
needed to distinguish React Flow presentation primitives from LangGraph.js
graph semantics.

## Orbit Baseline

### Current public execution interfaces

The following facts are verified at the pinned Orbit commit:

- `Operator` has `getName()` and asynchronous `invoke(input, options)` methods.
  Its input, output, and options are TypeScript generic types and do not provide
  runtime schemas.
- `Processor` extends `Operator` with required `name` and `type` properties.
- `ProcessorType` is an alias of `OperatorType`. The allowed values are
  `agent`, `model`, `sequence`, and `tool`; there is no `router`, `guard`,
  `reducer`, or `subgraph` type.
- `ProcessorRegistry.register()` stores a live Processor instance by
  `type:name`, rejects duplicate keys, and `lookup()` returns a matching
  instance. It has no public descriptor enumeration, constructor/factory,
  configuration schema, version, or capability metadata.
- `OperatorSequence` accepts a non-empty array of live Operator instances. It
  invokes them in order and passes each result directly to the next Operator.
  It has no named nodes or edges and cannot select among alternative next
  Operators.
- The public package exports `OperatorSequence`, `ProcessorRegistry`, and the
  related types. It does not export a graph definition, builder, validator,
  executor, or Router.

### Existing conditional behavior

`Agent.invoke()` implements a fixed model/tool loop:

1. invoke the selected model;
2. extract tool calls from the model message;
3. complete the turn if there are no tool calls;
4. fail if the tool-iteration limit has been reached;
5. otherwise execute the tool-call batch and return its messages to the next
   model iteration.

This is conditional behavior, and tool calls within one iteration can execute
in parallel. However, neither the condition nor its destinations are public
graph data. A visual editor cannot inspect or replace the branch without
changing `Agent` or introducing another application-specific executor.

`ThreadManager` contributes reusable run lifecycle behavior: it starts one run
per thread, emits typed events, forwards cancellation through `AbortSignal`,
and reports completion, cancellation, or failure. These are useful facilities
for a future graph executor, but current thread events identify model and tool
activity rather than arbitrary Processor nodes and selected edges.

### Direct feasibility answer

| Requested capability                                                  | Current Orbit interface                                                                | Assessment                                  |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------- |
| Display Processor-shaped boxes and connections in a React application | React Flow can do this without an Orbit graph API                                      | Possible as UI only                         |
| Invoke one registered Processor                                       | `ProcessorRegistry.lookup()` plus `Processor.invoke()`                                 | Possible                                    |
| Execute a linear series of live instances                             | `OperatorSequence`                                                                     | Possible                                    |
| Put an `if` statement inside one custom Processor                     | Ordinary TypeScript inside `invoke()`                                                  | Possible, but the branch is opaque to Orbit |
| Load nodes and edges from React Flow JSON and execute them            | No graph document, factory, edge, or executor                                          | Not supported                               |
| Represent a condition as declared routes                              | No Router result or allowed-destination contract                                       | Not supported                               |
| Validate an executable topology before a run                          | Only duplicate registry keys and an empty sequence are rejected                        | Not supported                               |
| Execute general fan-out and fan-in                                    | Tool batches are one special case; there is no general scheduler or reducer            | Not supported                               |
| Execute a declared cycle with a budget                                | The Agent loop is bounded but fixed in code                                            | Not supported as a graph                    |
| Persist and resume a graph version                                    | Sessions persist conversation and turn data, not graph definitions or node checkpoints | Not supported                               |
| Populate an editor palette from Processor metadata                    | Registry does not enumerate descriptors or configuration schemas                       | Not supported                               |

The precise conclusion is that conditional behavior is implementable **behind**
the current interface, but a conditional graph is not constructible **through**
the current interface as a first-class, data-defined Orbit workflow.

## React Flow 12.11.6

### Standard graph primitives

React Flow describes and renders a collection of nodes and edges. Its standard
primitives are suitable for building an editor:

- A `Node` has an ID, position, arbitrary `data`, an optional rendering `type`,
  and interaction and layout fields.
- The built-in node types are `default`, `input`, `output`, and `group`.
- A `Handle` is a source or target connection point. Custom nodes can have
  multiple handles, and handle IDs can distinguish routes or data ports.
- An `Edge` identifies source and target nodes and optional source and target
  handles. The built-in edge renderers are bezier/default, smooth-step, step,
  and straight.
- `isValidConnection` can reject a connection while the user edits the graph.
- Custom React components can implement domain-specific nodes and edges.
- Controlled or uncontrolled state APIs manage the editor's node, edge, and
  viewport state. `toObject()` can support save and restore of that editor
  state.

React Flow also supplies `Background`, `Controls`, `MiniMap`, `Panel`, node and
edge toolbars, resize controls, labels, and viewport helpers. These components
improve authoring and navigation. They do not define workflow execution.

### Conditional branching is an application convention

React Flow's computing-flows guide demonstrates a conditional branch by adding
two source handles and placing a value on one route while setting the other
route's value to `null`. The guide describes this as one possible convention.
The condition, propagation rule, stop interpretation, and scheduling behavior
are implemented by the surrounding React application.

This distinction matters for Orbit:

- multiple handles can **display** named outcomes such as `true`, `false`, and
  `error`;
- edge labels can **display** predicates or route names;
- `isValidConnection` can prevent obviously invalid editing operations; but
- none of those UI elements guarantees that a backend can instantiate the
  selected Processor, validate its configuration, authorize its capabilities,
  merge concurrent state updates, stop a cycle, or replay an execution.

React Flow's connection validation must therefore be treated as editor
feedback, not as the authoritative Orbit graph validator. A saved graph is
untrusted input when it reaches the runtime.

## LangGraph.js 1.4.13

### Graph and state primitives

At the pinned revision, LangGraph.js provides the following runtime concepts:

- `StateGraph` defines a stateful graph whose nodes read state and return state
  updates.
- State keys can define reducers that combine updates, including updates from
  parallel nodes.
- `addNode()` adds executable node functions or Runnable values.
- `addEdge()` declares fixed transitions. `START` and `END` represent graph
  entry and termination.
- `addConditionalEdges()` invokes a routing function after a source node. The
  function can return a route value, node name, node-name list, or `Send`
  values. An optional path map translates route values into destinations.
- Multiple outgoing fixed edges schedule their destinations in the same
  super-step. Reducers define how concurrent state updates combine.
- `compile()` validates the builder and produces an invokable compiled graph.
  The inspected implementation rejects unknown edge sources and targets,
  unreachable nodes, invalid interrupt nodes, duplicate nodes, and several
  reserved-name violations.

### Routing and control-flow components

| LangGraph.js primitive                         | Behavior relevant to visual authoring                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `addEdge(source, target)`                      | Declares a fixed transition that maps directly to a semantic edge                                            |
| `addConditionalEdges(source, router, pathMap)` | Runs a router and maps its result to one or more next nodes or termination                                   |
| `START` / `END`                                | Gives the visual graph explicit entry and terminal markers                                                   |
| State reducers                                 | Define how updates to a shared state field combine, which is required for deterministic fan-in               |
| `Send(node, state)`                            | Creates dynamic fan-out with a destination and per-invocation state, commonly for map/reduce                 |
| `Command({update, goto})`                      | Combines a state update with routing from a node                                                             |
| `Command.PARENT`                               | Routes from a subgraph to its parent graph                                                                   |
| `Command({resume})`                            | Supplies a value when resuming an interrupted graph                                                          |
| `ToolNode`                                     | Executes a set of tools as a reusable graph node and handles tool-result integration                         |
| `toolsCondition`                               | Routes an AI message containing tool calls to `tools`; otherwise routes to `END`                             |
| Subgraph as a node                             | Encapsulates a compiled child graph behind one parent node                                                   |
| `recursionLimit`                               | Bounds the number of graph super-steps and raises `GraphRecursionError` when exceeded                        |
| Node retry and cache policies                  | Associate operational behavior with individual executable nodes                                              |
| Checkpointer                                   | Persists graph state at super-step boundaries for resume, fault recovery, time travel, and human interaction |
| `interrupt()`                                  | Suspends execution, exposes a JSON-serializable request, and resumes through `Command`                       |

`ToolNode` plus `toolsCondition` is the closest direct analogue to Orbit's
hard-coded Agent branch. LangGraph.js expresses the model node, tool node,
condition, loop-back edge, and terminal destination as graph construction
operations. Orbit performs similar model/tool behavior but does not expose that
topology as data.

### Limits of the comparison

LangGraph.js is an execution runtime, not an embeddable node editor. Its graph
drawing facilities produce representations such as Mermaid or PNG for
inspection. The inspected `@langchain/langgraph` package does not supply a
React Flow palette, draggable node components, handles, viewport state, or a
saved visual-layout format.

LangGraph.js graphs are normally assembled with executable functions and
Runnable instances. That is not the same as loading an untrusted JSON document
created by an end user. A visual Orbit application would still need a safe
catalog of permitted Processor implementations and configuration schemas; it
must not deserialize arbitrary JavaScript functions.

## React Flow, LangGraph.js, and Orbit Comparison

| Concern                  | React Flow standard capability                                | LangGraph.js capability                                             | Current Orbit capability                                                  |
| ------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Node                     | `default`, `input`, `output`, `group`, and custom React nodes | Executable node function or Runnable in `StateGraph`                | Live `Operator` or `Processor`; no graph node definition                  |
| Port                     | Source and target `Handle` values with optional IDs           | State schema and graph edges; no React-style visual handle contract | Generic TypeScript input/output only; no runtime port schema              |
| Fixed edge               | Visual edge between node and handle IDs                       | `addEdge()` executes a transition                                   | Implicit adjacency inside `OperatorSequence` only                         |
| Edge appearance          | Bezier/default, smooth-step, step, straight, or custom        | Graph drawing metadata; execution is independent of SVG path style  | None                                                                      |
| Conditional branch       | Custom node/handles and application-owned data convention     | `addConditionalEdges()`, path maps, or `Command.goto`               | Fixed conditions inside `Agent` or custom code only                       |
| Entry and terminal       | Can be drawn with built-in or custom nodes                    | `START` and `END`                                                   | Method entry/return and turn outcomes; no graph markers                   |
| Parallel fan-out         | Multiple visible edges; no standard execution scheduler       | Multiple edges in a super-step or dynamic `Send` values             | Parallel tool batch only                                                  |
| Fan-in                   | Multiple target handles can be drawn                          | State reducers merge parallel updates                               | No general join or reducer contract                                       |
| Cycle                    | Cyclic edges can be drawn                                     | Cycles execute under a recursion limit                              | Fixed bounded Agent loop only                                             |
| Subgraph                 | `group`/`parentId` provides visual nesting, not execution     | Compiled subgraph can execute as a node                             | No subgraph contract                                                      |
| Edit-time validation     | `isValidConnection` and application callbacks                 | Not an editor concern                                               | None                                                                      |
| Runtime graph validation | Not provided by standard UI components                        | `compile()` checks graph structure and runtime setup                | No graph validator                                                        |
| Save/restore             | `toObject()` or application-owned nodes and edges             | Checkpointers persist execution state, not React layout             | Sessions persist conversation and turn state, not graph topology          |
| Interrupt and resume     | UI can display controls, but semantics are application-owned  | `interrupt()`, checkpointer, and `Command.resume`                   | Run cancellation and session resume exist; no node-level graph suspension |
| Tool loop                | Can draw custom model and tool nodes                          | `ToolNode` plus `toolsCondition`                                    | Implemented inside `Agent`, not as graph data                             |
| Visual authoring         | Primary purpose                                               | No embedded React editor in the inspected package                   | Existing GUI is conversational; no graph editor                           |

Three pairs that look similar must remain distinct:

1. A React Flow `group` is layout containment; a LangGraph.js subgraph is an
   executable and potentially checkpointed graph boundary.
2. A React Flow handle is a connection attachment point; a LangGraph.js reducer
   defines how concurrent state updates combine.
3. React Flow `isValidConnection` validates an editing action; LangGraph.js
   `compile()` validates an executable graph. A future Orbit runtime needs its
   own authoritative validation after loading saved editor data.

## Candidate Integration Boundary for Orbit

The following model is a non-binding research proposal.

```text
React Flow editor state
  nodes + edges + positions + viewport + visual groups
                  |
                  v
Application-owned translator and editor validation
                  |
                  v
Orbit semantic GraphDefinition
  processor references + configuration + declared routes + budgets
                  |
                  v
Orbit core validator/compiler
                  |
                  v
Immutable GraphVersion -> graph executor -> trace/checkpoint evidence
```

### Separate semantic and presentation documents

A future Orbit application should preserve two related but different records.

| Record            | Candidate contents                                                                                                                                                | Versioning consequence                                             |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Semantic graph    | Node IDs, Processor references, validated configuration, entry and terminal outcomes, declared routes, state schemas, capabilities, budgets, and failure behavior | Changes create a new executable graph version                      |
| Presentation view | Positions, dimensions, viewport, colors, edge renderer, collapsed groups, labels, and selection state                                                             | Pure layout changes need not create a new executable graph version |

Without this split, moving a box can change a graph hash even though execution
is identical, or visual metadata can accidentally become trusted runtime
configuration.

### Candidate visual mapping

| Visual element            | Candidate Orbit meaning                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| Processor node            | Stable node ID plus a reference to a registered Processor descriptor and validated configuration |
| Router node               | A Processor whose output is one route key from a declared finite set                             |
| Router source handle      | A route key such as `approved`, `rejected`, `retry`, or `error`                                  |
| Edge from a router handle | One allowed transition for that route key                                                        |
| Entry node                | One graph entry marker, not an executable user-supplied function                                 |
| Terminal node             | A typed terminal outcome such as success, failure, cancellation, or budget exhaustion            |
| Group                     | Presentation-only grouping unless explicitly linked to a semantic subgraph node                  |
| Edge label                | Human-readable route description; not executable expression text by default                      |

An editor should not initially accept arbitrary expressions on edges. A safer
first design is to register a finite Router Processor with a configuration
schema, expose its declared route keys as source handles, and require each
destination to be an existing semantic node or terminal outcome.

### Candidate load and validation sequence

Before execution, a backend boundary would need to:

1. parse the saved document with size and shape limits;
2. discard or isolate presentation-only fields;
3. resolve each Processor reference through an allow-listed descriptor catalog;
4. validate each Processor configuration and input/output contract;
5. reject missing IDs, duplicates, unknown Processors, unknown handles, and
   undeclared route destinations;
6. validate one entry, explicit terminal outcomes, reachability, and failure
   paths;
7. validate schema compatibility and state merge rules;
8. require a finite budget for every reachable cycle;
9. aggregate capabilities and apply policy before execution;
10. freeze the semantic definition as an immutable graph version; and
11. bind trace, cancellation, checkpoint, and resume records to that version.

React Flow's `isValidConnection` can mirror part of this logic for immediate
feedback, but the backend must repeat authoritative validation because client
state can be stale or modified.

## Analysis

### Why the current Processor interface is insufficient

The `Processor` interface is callable, but visual authoring requires a
serializable description of how to obtain and configure a callable value. The
current registry stores instances rather than descriptors or factories. It
cannot answer the editor questions "which Processors are available?", "which
configuration fields are required?", "which handles are legal?", or "which
capabilities will this node request?".

The generic input and output types also disappear at runtime. A visual edge
cannot be validated from TypeScript generics after loading JSON. Runtime schema
or port metadata is needed if Orbit intends to reject incompatible
connections before execution.

Finally, `ProcessorType` is currently a closed alias of four legacy
`OperatorType` values. A Router could be hidden under one of those types, but
that would misrepresent its semantics and would not create a routing contract.

### What Orbit can reuse

Several current capabilities remain useful building blocks:

- `invoke()` is a minimal execution boundary that a future graph executor can
  call.
- required Processor `name` and `type` values are a starting point for stable
  references, though they need version and descriptor semantics.
- `ProcessorRegistry` demonstrates duplicate-key rejection and explicit lookup.
- `OperatorSequence` provides a behavioral baseline for linear graph execution.
- `AbortSignal`, thread run IDs, session recording, diagnostics, and terminal
  events can inform graph-wide cancellation and correlation.
- the Agent's model/tool loop is a concrete behavior that can test whether an
  initial graph executor preserves existing semantics.

### Smallest useful implementation slice

A first implementation does not need all LangGraph.js features. A useful
learning-oriented slice would contain:

1. a serializable semantic graph with one entry, fixed edges, explicit terminal
   outcomes, and stable Processor references;
2. a descriptor or factory catalog separate from live Processor instances;
3. runtime input/output or configuration schemas;
4. a Router result restricted to declared route keys;
5. a validator for identity, references, reachability, route completeness, and
   acyclic or explicitly bounded topology;
6. a sequential executor with cancellation and node/edge trace events; and
7. a React Flow adapter that maps semantic IDs and routes to nodes, handles, and
   edges while storing layout separately.

General fan-out, reducers, joins, subgraphs, checkpointing, and graph migration
can follow as separate decisions. Implementing them together would combine too
many execution and persistence contracts into one change.

### Lessons from LangGraph.js without copying its API

LangGraph.js supplies evidence that conditions require more than a visual
diamond:

- route selection needs declared destinations or a path map;
- parallel branches need deterministic state merge rules;
- cycles need an enforced execution bound;
- suspension needs persistent state and replay-safe node behavior;
- graph construction and graph execution should be separated by validation;
  and
- prebuilt patterns such as `toolsCondition` are useful after the general
  routing semantics are defined.

Orbit's directional Processor Graph model is intentionally stricter about a
Router selecting from declared outgoing edges. LangGraph.js can infer a broad
set of possible destinations when a conditional branch has no explicit path
map, and `Command.goto` uses node names. For untrusted visual authoring, Orbit
should prefer a closed route set that is validated before a run. This is an
inference and requires an ADR before it becomes an Orbit contract.

## Non-binding Implications for Orbit

1. Treat React Flow as a possible adapter for authoring and inspection, not as
   the canonical execution model.
2. Define the semantic graph, Processor descriptor catalog, and validator in
   `src/core/`; keep React Flow components and layout persistence in an
   application package.
3. Do not make React Flow node `data` the trusted Processor configuration
   object without server-side schema validation.
4. Do not equate handles with typed runtime ports until the Processor contract
   defines runtime schemas and compatibility rules.
5. Model conditional routing as a finite result set with declared outgoing
   edges. A custom visual Router node can expose one source handle per route.
6. Preserve presentation separately so layout-only edits do not create new
   semantic graph versions.
7. Extract the existing model/tool loop as a compatibility test before adding a
   general visual workflow.
8. Split future ADRs by decision boundary: Processor descriptors and schemas;
   graph definition and validation; Router and conditional execution; visual
   adapter and persistence; then fan-out, joins, cycles, checkpoints, and
   versioning.

## Risks and Limitations

- React Flow and LangGraph.js are evolving. Findings are bounded by the pinned
  releases and commits.
- The investigation did not build a prototype adapter, so it does not measure
  editor performance, graph size limits, type-generation ergonomics, or
  round-trip fidelity.
- The official documentation is mutable and may describe changes made after a
  pinned source release. Source links are pinned where implementation behavior
  matters.
- A visual graph can suggest false safety. Valid arrows do not prove that a
  tool is authorized, a retry is idempotent, a join is deterministic, or a
  cycle terminates.
- React Flow's computing-flow examples run application logic in browser state.
  That pattern is not sufficient evidence for durable or server-side agent
  execution.
- LangGraph.js is a mature runtime with a larger state, persistence, and
  scheduling surface. Matching its feature list would increase Orbit's scope
  without necessarily improving Orbit's educational purpose.
- User-supplied Processor configuration or executable code expands the security
  boundary. A visual editor should initially select from trusted descriptors,
  not upload arbitrary JavaScript.
- Separating semantic and visual documents introduces synchronization and
  migration obligations that need explicit ownership.

## Open Questions

1. Should `ProcessorType` become extensible, or should semantic roles such as
   Router and Reducer be separate metadata on a smaller set of executable
   types?
2. What is the stable Processor reference: type and name, a package-qualified
   identifier, or an identifier plus implementation version?
3. Should one node expose a single input/output schema or named typed ports?
4. Should conditional logic live only in Router Processors, only on edges, or
   in both with different constraints?
5. Which route result is canonical: a route key, an edge ID, a terminal
   outcome, or a structured transition result?
6. How does the runtime prove that every cycle has a finite budget or enforced
   terminating condition?
7. Which state model is appropriate for the first graph executor: direct value
   passing, shared state with patches and reducers, or explicit events?
8. Does a layout-only edit retain the semantic graph version, and how are view
   revisions associated with it?
9. Which graph changes invalidate existing checkpoints or require migration?
10. How should the editor expose capabilities, approval requirements, retry
    safety, and side effects before a user activates a graph?
11. Is React Flow a runtime dependency of Orbit's current GUI application, a
    separately distributed editor package, or only one replaceable adapter?
12. What is the first compatibility target: rendering an Agent's fixed loop,
    authoring a conditional sequential workflow, or editing a persisted graph
    version?

## Related Decisions

No ADR had adopted a visual graph editor, executable graph schema, Router
contract, or React Flow dependency as of 2026-09-03.

Potential decisions should remain separate:

- Processor descriptor, factory, schema, and version metadata;
- semantic graph definition and validation;
- Router result and conditional-edge semantics;
- graph execution, cancellation, budgets, and trace events;
- semantic graph versioning and checkpoint compatibility; and
- React Flow adapter, visual document format, and application ownership.

Related directional material:

- [Processor Model](../concepts/processor-model.md)
- [Processor Graph](../concepts/processor-graph.md)
- [Adaptive Processor Graph Runtime](2026-09-02-adaptive-processor-graph-runtime.md)
- [LangGraph Concepts, Intermediate Representations, and Orbit Processors](2026-09-03-langgraph-concepts-intermediate-representations.md)
- [Current Architecture](../architecture.md)

## References

### Orbit

- [`src/core/processor/operator.ts`](../../src/core/processor/operator.ts)
- [`src/core/processor/processor.ts`](../../src/core/processor/processor.ts)
- [`src/core/processor/registry.ts`](../../src/core/processor/registry.ts)
- [`src/core/processor/sequence.ts`](../../src/core/processor/sequence.ts)
- [`src/core/agent.ts`](../../src/core/agent.ts)
- [`src/core/thread.ts`](../../src/core/thread.ts)
- [`src/core/index.ts`](../../src/core/index.ts)
- [`package.json`](../../package.json)

### React Flow

- [`@xyflow/react@12.11.6` release](https://github.com/xyflow/xyflow/releases/tag/%40xyflow/react%4012.11.6)
- [`@xyflow/react` package at the inspected revision](https://github.com/xyflow/xyflow/blob/0a1f9575b25679f2880175de8d3eae21aedde921/packages/react/package.json)
- [Node and built-in node types at the inspected revision](https://github.com/xyflow/xyflow/blob/0a1f9575b25679f2880175de8d3eae21aedde921/packages/react/src/types/nodes.ts)
- [Edge and built-in edge types at the inspected revision](https://github.com/xyflow/xyflow/blob/0a1f9575b25679f2880175de8d3eae21aedde921/packages/react/src/types/edges.ts)
- [Default node implementation at the inspected revision](https://github.com/xyflow/xyflow/blob/0a1f9575b25679f2880175de8d3eae21aedde921/packages/react/src/components/Nodes/DefaultNode.tsx)
- [React Flow component props and connection validation at the inspected revision](https://github.com/xyflow/xyflow/blob/0a1f9575b25679f2880175de8d3eae21aedde921/packages/react/src/types/component-props.ts)
- [React Flow concepts](https://reactflow.dev/learn/concepts/terms-and-definitions)
- [Built-in components](https://reactflow.dev/learn/concepts/built-in-components)
- [Custom nodes](https://reactflow.dev/learn/customization/custom-nodes)
- [Handles](https://reactflow.dev/learn/customization/handles)
- [Connection validation](https://reactflow.dev/examples/interaction/validation)
- [Save and restore](https://reactflow.dev/examples/interaction/save-and-restore)
- [Computing flows and conditional branching](https://reactflow.dev/learn/advanced-use/computing-flows)

### LangGraph.js

- [`@langchain/langgraph@1.4.13` release](https://github.com/langchain-ai/langgraphjs/releases/tag/%40langchain/langgraph%401.4.13)
- [`@langchain/langgraph` package at the inspected revision](https://github.com/langchain-ai/langgraphjs/blob/3609b35036f18c5a0cf9746910a45e0ab65ccf97/libs/langgraph-core/package.json)
- [`Graph`, fixed edges, conditional edges, and compile validation at the inspected revision](https://github.com/langchain-ai/langgraphjs/blob/3609b35036f18c5a0cf9746910a45e0ab65ccf97/libs/langgraph-core/src/graph/graph.ts)
- [`StateGraph` and reducer-aware state at the inspected revision](https://github.com/langchain-ai/langgraphjs/blob/3609b35036f18c5a0cf9746910a45e0ab65ccf97/libs/langgraph-core/src/graph/state.ts)
- [`Send` and `Command` at the inspected revision](https://github.com/langchain-ai/langgraphjs/blob/3609b35036f18c5a0cf9746910a45e0ab65ccf97/libs/langgraph-core/src/constants.ts)
- [`ToolNode` and `toolsCondition` at the inspected revision](https://github.com/langchain-ai/langgraphjs/blob/3609b35036f18c5a0cf9746910a45e0ab65ccf97/libs/langgraph-core/src/prebuilt/tool_node.ts)
- [LangGraph.js Graph API](https://docs.langchain.com/oss/javascript/langgraph/graph-api)
- [LangGraph.js Graph API examples](https://docs.langchain.com/oss/javascript/langgraph/use-graph-api)
- [LangGraph.js persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- [LangGraph.js interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)
- [LangGraph.js subgraphs](https://docs.langchain.com/oss/javascript/langgraph/use-subgraphs)
- [LangChain.js ToolNode and `toolsCondition`](https://docs.langchain.com/oss/javascript/langchain/tools)
