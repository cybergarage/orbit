# Managed Processor Graphs

A compiled Graph composes serial Agent, managed tool, transform and router stages inside one managed Run. It shares one environment, model, tool catalog, conversation turn and selected Skill snapshot. It does not run an Agent inside a second supervisor. Existing OperatorSequence and ordinary Agent handles retain their contracts.

## Compile and submit

```typescript
import {Agent, compileProcessorGraph, Session, State} from 'orbit'

const graph = await compileProcessorGraph({
  id: 'inspect', entry: 'answer',
  nodes: [{id: 'answer', adapter: 'agent-v1'}],
  edges: [{id: 'finish', from: 'answer', to: 'done'}],
  terminals: [{id: 'done', outcome: 'completed'}],
}, [{
  id: 'agent-v1', version: '1', kind: 'agent',
  inputSchema: {type: 'string'}, outputSchema: {type: 'object'},
}])
const agent = new Agent({state: new State(new Session({formatVersion: 2}))})
try {
  const handle = await agent.startGraphRun(graph, 'Inspect the isolated target', {
    requestId: 'inspection-1', limits: {modelCalls: 3},
  })
  const result = await handle.finished
  const value = handle.value() // {graph, value}, only after acknowledged, quiescent completion
  const observation = agent.getGraphSnapshot(handle.id)
  // Handle result.outcome and recording independently; a snapshot is not success.
} finally {
  await agent.close()
}
```

Configure a provider and isolate the target before running this example. It is an API sketch, not a live-model quality test. `agent.bindGraph(graph)` offers the same typed start and observation methods. A terminal declared `failed` yields `failed / graph-declared-failure`; cancellation, unknown effects, unresolved ownership and required recording failure retain precedence. Ordinary `RunHandle<Message>.value()` is unchanged. Graph values are never fabricated from old conversation messages on replay.

`ThreadManager.startGraphRun` and `OrbitApplicationService.startGraphRun` accept a host-compiled graph and JSON input. Their handle exposes `admitted`, `id`, `threadId` and `completion: Promise<GraphValue>`; it rejects when there is no confirmed successful value, including observation-only replay. `graph-completed` is a distinct thread event, not an assistant message. Run cancellation, approval, deletion and observer delivery use the existing service. `createThread({formatVersion: 2})` explicitly creates a compatible new thread. An existing v1 thread must be migrated offline first. There is no executable graph upload endpoint or GUI graph editor.

## Values, routes and host responsibility

Adapters have explicit `id`, `version`, `kind`, input and output JSON schemas. Work nodes have one outgoing edge. Router callbacks return a declared label and forward their input unchanged; the label is not the next node's value. Connections require identical canonical schemas; insert an explicit transform when representations differ. Agent stages return a JSON projection containing `type`, `role`, `contents` and optional `payload`. Their private configuration accepts `instruction` and `maxToolIterations`; the latter cannot exceed the submitted outer cap. The initial input is recorded once; later stages append their input within the same turn.

Tool adapters bind `name` and the exact `ToolSource`, and declare the catalog's input schema. For generated schemas carrying non-JSON annotations, pass `structuredClone(tool.spec.inputSchema)` to obtain the plain JSON projection. The closed Graph vocabulary supports the common draft-07/2020-12 subset and numeric exclusive bounds used by builtins, without references, remote resolution, tuple schemas or unevaluated keywords. MCP's existing narrower schema profile is unchanged. Local bindings are checked before MCP discovery, and the complete catalog is checked again before ready. A missing, changed or conflicting tool never starts a node.

Only trusted host transform/router callbacks receive `{signal}` and immutable JSON input/configuration. They must be pure and cooperative: no filesystem, model or MCP effects and no captured privileged capability. Freezing a function reference is not a sandbox and cannot freeze its external closure; changing behavior requires a new adapter version. All application effects belong in managed tool or Agent stages. No dynamic JavaScript loader, parallel branch, join, subgraph or internal-loop graph expansion is provided.

Definitions, configuration and values reject cycles, accessors, hidden fields, nonfinite numbers, sparse arrays, class instances and reserved property names. JSON depth is limited to 32. The initial profile permits 64 nodes, 128 edges, 128 visits, a 256 KiB canonical descriptor and 64 KiB per encoded value. Positive finite overrides are submitted before admission. The existing 1 MiB journal record limit additionally bounds the complete binding. An oversized effect result stops forwarding but does not undo the effect. These are trial limits, not measured optima.

## Shared management

Each direct tool visit consumes one `toolRequests` allowance before preparation. `toolRounds` counts Agent model/tool rounds, not direct nodes. Every Agent visit shares model calls, summary calls, request/round allowances and elapsed time. The entire current Graph turn remains protected during compaction; earlier visits cannot be summarized away as completed old turns. Selected Skills are resolved/saved once and included in each ordinary model request, including budget-disabled mode; dedicated summaries exclude them. A later Run does not reactivate a historical selection.

Unknown operations, cancellation, invalid values/routes and required save failures prevent successor dispatch. Known tool failures can be routed by their structured result (for example a target test's nonzero exit); denied/invalid/not-started direct calls stop the Graph. A callback that outlives cancellation remains owned and quarantines the Run until settlement. A timeout is not proof that work stopped. Retry does not repeat an uncertain external effect.

## Required evidence and replay

Graph Runs write journal version 2. Ordinary Runs continue to write version 1, including before and after a Graph in the same registered Session. Every record within one Run has the same version. Graph binding is acknowledged before resource preparation; ready follows synchronized initial entries/Skills and catalog validation. Each node start is acknowledged before dispatch. New transcript entries synchronize before node completion, followed by the selected transition. A transition proves selection, not that its destination started.

The public descriptor has a SHA-256 identity. Private configuration, submitted input and output values use keyed digests in required metadata. Raw private values are not journal checkpoints. Node evidence includes visit IDs, operation references, message IDs and acknowledged Session data-entry counts **excluding the transcript header**, as returned by `Session.synchronize`; these counts are not message counts. Initial failure may precede binding/ready, and interrupted visits may lack completion/transition. Successful or declared-failure terminals require a complete declared path.

Identical request IDs compare the full submitted graph identity, configuration, profile, input, tool options, ordered Skills and limits. Live replay returns the existing handle without re-preparing resources. After restart, it returns recorded observation without running adapters, models, MCP or Skill resolution. Changed input is rejected. No intermediate node resumes automatically.

`inspectExecutionJournal` preserves invalid/torn bytes and returns a validated prefix plus an issue. `inspectGraphRun(records)` checks one Run without user adapters and labels transcript verification `unavailable`. To cross-check it, pass `{sessionId, formatVersion, entries}` using `Session.getEntries()`, or `parseSessionFile(...).entries.slice(1)` plus its header identity/version. The result distinguishes verified, unavailable and mismatched evidence. `OrbitApplicationService.queryGraphRun(id)` performs this read-only saved-session observation. An inspection issue remains a failure even if its prefix is useful; never feed a rejected suffix into recovery as successful history.

## Migration and interrupted operation

Before the first Graph in a saved pair, stop old writers/readers and automatic restart sources, preserve evidence/backups and migrate the transcript explicitly to v2. Update every process using that Session/journal pair. Old v1 journal readers reject v2 records. A newline-terminated unknown/malformed journal record is invalid evidence; an unterminated journal suffix is preserved with an issue. Transcript decoding separately rejects syntactically complete unknown records even without a newline and only recovers an incomplete final JSON parse.

Storage registration, stable Session scopes, guard/owner cleanup and offline maintenance remain unchanged. No Graph-only store exists: deletion removes its journal through SessionDeletionService and keeps the existing minimal tombstone. On interruption, inspect transcript/journal and externally reconcile uncertain effects under the existing execution protocol; do not replay a selected node to obtain missing evidence. Keep external admission/restarters stopped whenever prior migration/maintenance success is unknown. This feature never authorizes deleting backups.

See [Managed execution](execution.md), [input budgets](context-compaction.md), [Skills](skills.md), and the [Graph ADR](adr/2026-09-12-managed-processor-graph.md) for retained decisions and validation evidence. Fixed-double core/application tests and an isolated target's test result do not establish real-model quality or an application's SLI/SLO.

## Human-selected candidates

Applications can register finite Graph candidates with trusted evaluation using [Workflow selection](workflow-selection.md). The coordinator retains the complete request and selection expectation, then uses this same managed Graph path. Selected calls check the fixed declaration and actual catalog/Skill snapshot before ready. Existing explicit Graph calls keep their behavior outside selection-managed product scopes; changing human selection never replaces a captured or running Graph.
