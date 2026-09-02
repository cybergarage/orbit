---
status: current
investigation-date: 2026-09-02
orbit-commit: ea34703b1f4111926b2480cebd298c4cd5e6b748
related-adrs: []
superseded-by: []
---

# Adaptive Processor Graph Runtime

## Purpose

This note records the point-in-time investigation behind a possible long-term
direction for Orbit: representing agent execution as a graph of typed
Processors and allowing evaluated, governed changes to graph routing and
topology.

The investigation asks whether that direction remains technically distinctive
and commercially meaningful while minimal agent harnesses, graph workflow
runtimes, plugin-oriented harnesses, and automated workflow optimization are
all advancing rapidly.

This note is research, not a decision. It does not approve a Processor Graph
architecture, authorize implementation, or change Orbit's current contracts.

## Research Questions

1. What parts of the Processor concept already exist in Orbit and what parts
   remain conceptual?
2. How does a Processor-centered execution model differ from Pi's minimal
   harness, DeepSeek Harness's plugin model, and explicit graph runtimes?
3. Does building another agent framework have commercial value?
4. What would make dynamic graph adaptation safe enough for a production
   system?
5. Which concepts should be central to Orbit and which should be delegated to
   standards or existing ecosystems?

## Investigation Scope and Revisions

The investigation was performed on 2026-09-02. Repository behavior claims are
bounded by the following full revisions.

| System                    | Revision                                                                                                                                      | Role in the comparison                                |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Orbit                     | [`ea34703b1f4111926b2480cebd298c4cd5e6b748`](https://github.com/cybergarage/orbit/commit/ea34703b1f4111926b2480cebd298c4cd5e6b748)            | Current baseline                                      |
| Codex                     | [`eb10d91e48ccbd0930427461fb392337addb1ac0`](https://github.com/openai/codex/commit/eb10d91e48ccbd0930427461fb392337addb1ac0)                 | Production coding-agent control loop and tool runtime |
| Pi                        | [`23842b1e693e09e9d596412c0be13036ec653e3a`](https://github.com/earendil-works/pi/commit/23842b1e693e09e9d596412c0be13036ec653e3a)            | Minimal agent harness and extension model             |
| DeepSeek Harness          | [`4e84901e6471b79ec0338099867ebb4606d12bb5`](https://github.com/deepseek-ai/deepseek-harness/commit/4e84901e6471b79ec0338099867ebb4606d12bb5) | Everything-is-a-plugin composition model              |
| LangGraph                 | [`11ee185999b86bfea2d8c0e69cef9a5e37acf686`](https://github.com/langchain-ai/langgraph/commit/11ee185999b86bfea2d8c0e69cef9a5e37acf686)       | Stateful graph execution model                        |
| Microsoft Agent Framework | [`1802dfb3dc619cd165ecb74ee6902ac1d2acc6a3`](https://github.com/microsoft/agent-framework/commit/1802dfb3dc619cd165ecb74ee6902ac1d2acc6a3)    | Typed graph workflows and production orchestration    |
| EvoAgentX                 | [`d77fd6b9a3e76c8dd83bebe3374c53a3f5d16f54`](https://github.com/ANative-Lab/EvoAgentX/commit/d77fd6b9a3e76c8dd83bebe3374c53a3f5d16f54)        | Automated workflow construction and evolution         |

Academic publications and dated protocol specifications in the references are
immutable point-in-time sources and are identified by publication or protocol
revision.

## Orbit Baseline

### Verified facts

Orbit already contains the beginnings of a uniform execution vocabulary:

- `Operator` defines an asynchronous `invoke(input, options)` contract.
- `Processor` extends `Operator` with a required name and type.
- `OperatorSequence` connects operators linearly by passing each output to the
  next input.
- `ProcessorRegistry` registers named Processors by type and name.
- models, tools, and `Agent` implement the `Operator` contract or adapt to it.

These abstractions are not yet a graph runtime:

- `ProcessorType` is currently an alias of `OperatorType` and includes only
  agent, model, sequence, and tool categories;
- `Processor` does not yet define state projection, state reduction,
  transition results, side-effect declarations, or checkpoint semantics;
- `OperatorSequence` supports only ordered linear composition;
- there is no Router, edge model, graph validator, graph version, or graph
  executor; and
- `Agent` owns a fixed model/tool loop implemented directly as a bounded
  `for` loop rather than executing a Processor Graph.

The current implementation therefore supplies useful naming and compatibility
seams, but the adaptive Processor Graph remains an architectural concept rather
than implemented behavior.

### Earlier concept material

The related book material describes a broader model in which an Agent owns a
State Pipeline, Processors combine a Projector, Operator, and Reducer, and a
Router chooses the next Processor. It also distinguishes entry, terminal, and
failure Processors. That material is useful design input, but it must not be
treated as the current Orbit API or runtime contract.

## External Systems Investigated

### Codex

Codex provides evidence for the operational requirements of a production
coding-agent harness: a controlled agent loop, tool dispatch, approvals,
sandboxing, resumable thread state, event delivery, and extensive diagnostics.
Its architecture demonstrates that execution policy, security boundaries, and
observability are first-class runtime concerns rather than optional wrappers
around model calls.

Codex is relevant to Orbit's runtime and safety requirements. It is not direct
evidence for a universal Processor Graph abstraction or automated graph
topology evolution.

### Pi

Pi separates a compact agent runtime from the coding-agent application and
provides tool calling, state management, event streaming, sessions, custom
tools, and lifecycle extensions. Extensions can intercept events and change
tool availability or context without requiring a general graph abstraction.

Pi demonstrates the leverage of a small, understandable loop with strong
extension surfaces. It also demonstrates that a new framework cannot justify
itself commercially merely by supporting multiple models, tool calls, a CLI,
sessions, or extension callbacks.

### DeepSeek Harness

DeepSeek Harness describes its architecture as "everything is a plugin." Its
Cordis foundation manages plugin contexts, dependencies, services,
lifecycles, reversible effects, and dynamic composition. Model adapters, tool
registries, session services, and the agent loop can be supplied through that
composition system.

The plugin is primarily a unit of capability composition and lifecycle. A
Processor, as considered for Orbit, is primarily a unit of execution and state
transition. The two concepts can coexist: a plugin may distribute or register
Processors, but plugin identity should not determine graph execution semantics.

### LangGraph

LangGraph explicitly models workflows through shared state, nodes, and edges.
Nodes perform logic and return state updates; edges determine which node runs
next. Conditional routing and cycles support agent loops, while checkpointing
supports durable execution and human interruption.

This is the closest established comparison to an Orbit Processor Graph. A
Processor Graph must therefore provide value beyond renaming nodes and edges.

### Microsoft Agent Framework

Microsoft Agent Framework workflows connect typed executors through edges and
conditions. The runtime supports fan-out, fan-in, events, state, checkpointing,
human input, nested workflows, and exposing a workflow through an agent
interface.

This reinforces that typed graph orchestration and durable workflow execution
are becoming baseline framework capabilities. They are not sufficient by
themselves to differentiate Orbit.

### MCP

The Model Context Protocol standardizes discovery and invocation of external
tools, resources, and prompts across hosts and servers. Its host is responsible
for orchestration, consent, authorization, and context aggregation.

Orbit should use MCP at integration boundaries instead of treating a
proprietary tool protocol as strategic differentiation. MCP tools can be
adapted into Processors when they participate in a graph, while their protocol
identity remains intact.

### Automated workflow optimization

GPTSwarm represents language-agent systems as optimizable graphs and changes
node prompts and graph connectivity. AFlow treats code-represented agentic
workflows as a search space and uses execution feedback to explore alternative
workflows. EvoAgentX combines workflow construction, evaluation, and
optimization facilities.

A detailed comparison of their contributions, architectures, evaluation
results, and limitations is preserved in
[Agent Workflow Optimization Papers](2026-09-02-agent-workflow-optimization-papers.md).

These systems provide evidence that graph structure can be an optimization
target rather than only a manually authored execution plan. They do not
establish that unrestricted live self-modification is safe, general, or
commercially reliable. Published results are typically bounded by selected
benchmarks, optimizers, models, and evaluation functions.

## Architectural Comparison

| System                    | Primary abstraction                                   | Primary variability                                |
| ------------------------- | ----------------------------------------------------- | -------------------------------------------------- |
| Codex                     | controlled agent loop and tools                       | policy, tools, prompts, runtime configuration      |
| Pi                        | minimal agent loop and extensions                     | tools, callbacks, context, application behavior    |
| DeepSeek Harness          | plugin, service, context, and fiber                   | capability composition and lifecycle               |
| LangGraph                 | state, node, and edge                                 | explicit workflow structure and routing            |
| Microsoft Agent Framework | executor, edge, workflow, and state                   | typed orchestration and durable execution          |
| Proposed Orbit direction  | Processor, state transition, route, and graph version | execution structure plus evaluated graph evolution |

The concise distinction is:

> DeepSeek Harness composes everything as plugins. Orbit may model every
> executable step as a Processor.

"Every executable step" is intentionally narrower than "everything." State,
events, traces, graph definitions, and policies are first-class data and
control structures; forcing them all into the Processor abstraction would hide
important semantics.

## Findings

### Finding 1: another generic agent framework is not enough

Model adapters, tool calling, sessions, CLI interaction, extension callbacks,
and basic agent loops are widely available. Reimplementing that feature list
does not create a durable commercial reason for Orbit to exist.

### Finding 2: graph execution is becoming a baseline

Stateful nodes, conditional edges, cycles, checkpointing, streaming, and human
interruptions are already present in established frameworks. A Processor Graph
that stops at those capabilities would be educationally useful but weakly
differentiated as a commercial runtime.

### Finding 3: one execution contract remains educationally valuable

A uniform Processor contract can make model calls, deterministic transforms,
tools, routers, policy checks, evaluators, approvals, checkpoints, and nested
graphs inspectable through the same execution vocabulary. This is especially
valuable for Orbit's stated purpose of exploring and understanding how agents
work.

The abstraction must preserve meaningful differences such as determinism,
side effects, permissions, cost, retry safety, and state access rather than
erasing them behind a minimal `invoke` method.

### Finding 4: evaluated evolution is the stronger differentiator

The more distinctive direction is not graph authoring alone, but controlled
improvement of graph configuration and topology from execution evidence. The
commercially meaningful assets would be evaluation datasets, traces, safe
optimizers, governance, domain-specific Processors, and reliable promotion and
rollback, rather than the graph data structure itself.

### Finding 5: execution and learning must be separate control planes

A production system should not let a live run mutate its own active graph
without validation. Execution should use an immutable graph version. A
separate control plane should analyze traces, propose candidates, evaluate
them, and promote a new version only after policy and approval gates pass.

## Analysis

### Candidate Processor contract

A useful Processor contract would eventually need to describe more than input
and output:

- typed input and output;
- readable state projection and emitted state patch;
- success, failure, retry, suspend, and transition outcomes;
- side effects and required capabilities;
- determinism, idempotency, and retry safety;
- time, token, monetary, and concurrency budgets;
- cancellation, checkpoint, and resume behavior;
- Processor implementation and configuration versions; and
- trace events and evaluation dimensions.

Candidate Processor categories include model, tool, transform, router, guard,
evaluator, human approval, checkpoint, and subgraph Processors. Static graph
edges should remain explicit even if a Router Processor dynamically selects
among allowed routes.

### Candidate graph evolution lifecycle

The safe unit of change is a graph version, not an in-place mutation:

1. execute an immutable graph version;
2. collect typed traces, outcomes, costs, and evaluation evidence;
3. generate one or more candidate graph versions;
4. validate schemas, capabilities, budgets, and safety invariants;
5. replay or evaluate candidates against held-out tasks;
6. compare quality, latency, cost, and failure behavior;
7. require policy or human approval where appropriate;
8. promote through shadow or canary execution; and
9. retain provenance and immediate rollback to an earlier version.

This lifecycle distinguishes execution-time dynamic routing from
configuration-time graph optimization. It also distinguishes workflow learning
from model-weight training.

### Commercial boundary

The framework core is unlikely to be the primary commercial moat. Potentially
defensible layers include:

- domain-specific Processor libraries and validated graph templates;
- trace, replay, simulation, and visual debugging;
- evaluation suites derived from real domain outcomes;
- constrained graph search and optimization;
- approval, audit, policy, and rollback controls;
- provider-neutral and on-premises execution; and
- managed operation of long-running, versioned agent workflows.

If Orbit does not pursue these layers, adopting an existing harness or graph
runtime is likely to be more economical for commercial application delivery.

## Implications for Orbit

The following implications are non-binding research recommendations:

1. Position Orbit as an educational runtime first and an adaptive Processor
   Graph runtime as the possible differentiated direction.
2. Use the phrase "every executable step is a Processor" rather than
   "everything is a Processor."
3. Preserve `Operator` as the smallest invokable computation only if its
   relationship to `Processor` remains necessary and explicit.
4. Convert the existing fixed Agent loop into a behavior-preserving built-in
   graph before adding topology optimization.
5. Establish typed events, immutable graph versions, replay, checkpoints,
   budgets, and policy boundaries before adding self-evolution.
6. Treat MCP and other interoperability protocols as adapters, not competing
   proprietary surfaces.
7. Add offline evaluation and candidate promotion before allowing any
   production graph to change from observed experience.
8. Record the actual architectural decision in one or more ADRs before
   changing the current runtime.

A concise concept statement for further evaluation is:

> Orbit decomposes agent loops into typed Processors, makes their execution
> observable as a versioned graph, and improves that graph through governed
> evaluation.

## Risks and Limitations

- A universal Processor abstraction can become too generic to enforce useful
  contracts.
- Explicit graph authoring can add ceremony to tasks served better by a small
  loop or ordinary language control flow.
- Graph search can overfit evaluation datasets, exploit weak evaluators, or
  increase cost while appearing to improve quality.
- Nondeterministic model behavior complicates replay and causal attribution.
- Dynamic topology expands the security review surface and can bypass intended
  approval paths unless routes are capability-constrained.
- Long-running graph versions create migration and compatibility obligations.
- Framework maintenance may divert effort from a concrete commercial product
  or domain-specific application.
- External implementations are evolving rapidly; this comparison is bounded
  by the revisions listed above.

## Open Questions

1. Is `Operator` a useful lower-level abstraction, or should `Processor` become
   the only public executable contract?
2. Should Processor state updates be returned as patches, events, commands, or
   a combination of these?
3. Which graph features belong in the first runtime: cycles, fan-out, fan-in,
   subgraphs, interrupts, or only conditional sequential execution?
4. What is the canonical persisted record: graph events, state checkpoints, or
   both?
5. How are side-effecting Processors made replay-safe?
6. Which evaluation signals are sufficiently independent of the generating
   model to approve graph changes?
7. What is the first domain where adaptive graph execution creates measurable
   value beyond an existing framework?
8. Which parts should be open-source infrastructure and which parts could form
   a commercial control plane?

## Related Decisions

No ADR had adopted or rejected this direction as of 2026-09-02. Any future ADR
must link this note but remain independently understandable.

Potential decisions should be separated rather than approved as one package:

- the Processor execution contract;
- the graph and routing model;
- persistence, replay, and graph versioning;
- evaluation and candidate promotion; and
- the boundary between open-source runtime and commercial services.

Related directional concept pages:

- [Concept Overview](../concepts/overview.md)
- [Processor Model](../concepts/processor-model.md)
- [Processor Graph](../concepts/processor-graph.md)
- [Adaptive Execution](../concepts/adaptive-execution.md)

## References

### Orbit

- [`src/core/processor/operator.ts`](../../src/core/processor/operator.ts)
- [`src/core/processor/processor.ts`](../../src/core/processor/processor.ts)
- [`src/core/processor/sequence.ts`](../../src/core/processor/sequence.ts)
- [`src/core/processor/registry.ts`](../../src/core/processor/registry.ts)
- [`src/core/agent.ts`](../../src/core/agent.ts)

### External implementations and specifications

- [Codex at the inspected revision](https://github.com/openai/codex/tree/eb10d91e48ccbd0930427461fb392337addb1ac0)
- [Pi at the inspected revision](https://github.com/earendil-works/pi/tree/23842b1e693e09e9d596412c0be13036ec653e3a)
- [Pi agent-core](https://github.com/earendil-works/pi/tree/23842b1e693e09e9d596412c0be13036ec653e3a/packages/agent)
- [Pi extensions](https://github.com/earendil-works/pi/blob/23842b1e693e09e9d596412c0be13036ec653e3a/packages/coding-agent/docs/extensions.md)
- [DeepSeek Harness at the inspected revision](https://github.com/deepseek-ai/deepseek-harness/tree/4e84901e6471b79ec0338099867ebb4606d12bb5)
- [LangGraph at the inspected revision](https://github.com/langchain-ai/langgraph/tree/11ee185999b86bfea2d8c0e69cef9a5e37acf686)
- [LangGraph Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api)
- [Microsoft Agent Framework at the inspected revision](https://github.com/microsoft/agent-framework/tree/1802dfb3dc619cd165ecb74ee6902ac1d2acc6a3)
- [Microsoft Agent Framework workflow concepts](https://learn.microsoft.com/en-us/agent-framework/concepts/workflows/)
- [EvoAgentX at the inspected revision](https://github.com/ANative-Lab/EvoAgentX/tree/d77fd6b9a3e76c8dd83bebe3374c53a3f5d16f54)
- [Model Context Protocol architecture, revision 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/architecture)

### Research publications

- [GPTSwarm: Language Agents as Optimizable Graphs](https://proceedings.mlr.press/v235/zhuge24a.html)
- [AFlow: Automating Agentic Workflow Generation](https://arxiv.org/abs/2410.10762)
- [Automated Design of Agentic Systems](https://arxiv.org/abs/2408.08435)
- [EvoAgentX: An Automated Framework for Evolving Agentic Workflows](https://aclanthology.org/2025.emnlp-demos.47/)
