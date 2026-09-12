---
status: current
investigation-date: 2026-09-12
orbit-commit: 64f3cc1a31f194a0129efb511b3aa8dc7c029525
related-adrs:
  - docs/adr/2026-09-12-managed-processor-graph.md
superseded-by: []
---

# Bounded Processor Graph Execution

## Purpose

Establish a current baseline for composing investigation, editing and target-project verification through serial execution, declared branches and finite cycles. Compare a managed Agent as a graph node with converting its internal model/tool loop into graph nodes. This investigation is non-binding; it does not approve Graph, evaluation, promotion or implementation.

## Findings

**Verified:** Orbit still has a mutable linear sequence and a name/type registry, not an executable Graph. Since the earlier Graph investigations it has acquired managed Run admission, operation authorization, required journaling, registered storage, input budgeting/compaction and run-scoped Skills. A graph cannot safely obtain those guarantees merely by nesting public `Agent.startRun()` calls.

**Recommendation, not adoption:** use one managed Run for a bounded serial graph and an Agent node that reuses the existing loop through an internal managed execution seam. Keep a single conversation turn, resolved tool catalog, selected-Skill snapshot and resource owner for the graph's lifetime. This costs a deliberate refactor and required graph-evidence format; it is not a wrapper-only implementation. Do not move individual model/tool iterations into the graph in the first scope.

This updates the execution recommendation of the [2026-09-02 investigation](2026-09-02-adaptive-processor-graph-runtime.md). Its external comparisons and broader adaptive directions remain historical evidence. The [2026-09-03 LangGraph investigation](2026-09-03-langgraph-concepts-intermediate-representations.md) remains useful for terminology and representation boundaries; it does not settle integration with the subsequently accepted Run contracts. No equivalent Graph ADR exists in the inspected ADR index.

## Research Questions

1. Which existing Processor guarantees can composition reuse, and which are missing?
2. Can one owner, deadline, permission mechanism and required record stream cover every node and Agent iteration?
3. What can configuration validation and graph identity actually establish?
4. Which input, output, transition and failure evidence is necessary without storing every body or promising crash continuation?
5. What compatibility costs and confirmation conditions need an author decision?

## Orbit Baseline

Investigation date: 2026-09-12. The local working tree was clean at the full revision in metadata. Public `main` was `7b4903fb88db5ed53cac7ef5986c75e22a626897`. Local committed implementation is the evidence baseline; this is not a claim that every local change is published.

`git diff 8ee97144c20b006225db52efc482004200527e4c HEAD -- src/core/processor test/core/operator.test.ts test/core/processor.test.ts` is empty. The old A12 baseline therefore still applies to these primitives. The same comparison contains substantial changes to Agent, execution, Session, context and Skills.

| Inspected source / tests                                                                                                                             | Current fact                                                                                                                                                                                                    | Consequence for a proposal                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/core/processor/operator.ts`, `processor.ts`, `sequence.ts`, `registry.ts`; `test/core/operator.test.ts`, `processor.test.ts`                    | `invoke` is generic; sequence holds the supplied array and passes the same options object. A returned error-shaped value continues, a rejection stops. Registry retains live objects under their original keys. | Keep legacy APIs compatible; a new validated, frozen descriptor/catalog cannot be inferred from `readonly` or from `getName()`.                              |
| `src/core/agent.ts`, `startRun`, `invokeSessionWithTurn`; `test/core/agent.test.ts`                                                                  | Public admission creates its own supervisor context. Private turn execution records turn start/input, resolves Skills, discovers tools, records ready and executes the model/tool loop.                         | Calling public Agent admission at each graph node resets the ownership/budget scope. Extract setup/turn/loop responsibilities without copying the loop.      |
| `src/core/execution/run.ts`, `RunSupervisor`, `RunContext.ready`, `consume`, `wait`, `track`; `test/core/execution/run.test.ts`, `contracts.test.ts` | Busy/quarantined supervisors reject admission, one context owns counters and pending work, late work remains owned, ready binds a catalog.                                                                      | One graph must share this context; graph hops need an additional finite counter, not independent child Run allowances.                                       |
| `src/core/execution/journal.ts`, `validateNext`, `recovery.ts`                                                                                       | The required journal has a closed kind/field set, one ready per Run, a 1 MiB encoded record ceiling, strict ordering and no execution after terminal.                                                           | Graph identity and node/edge evidence need an explicit compatible reader/writer change. Optional diagnostic events or ignored extra fields are insufficient. |
| `src/core/execution/authorization.ts`, `src/core/tools/registry.ts`, `src/core/mcp.ts`                                                               | Prepared operations revalidate policy/target, await intent, dispatch and await result; resource reservations belong to the Run.                                                                                 | Graph validation cannot grant permissions. Direct tool nodes must use the same path and catalog as Agent tools.                                              |
| `src/core/session/context-policy.ts`, `context-builder.ts`, `entries.ts`, `codec.ts`; `test/core/execution/context-compaction.test.ts`               | Budgeted preparation protects the latest whole turn and freezes requests; transcript v2 carries durable compaction evidence.                                                                                    | A graph as one turn makes its entire ongoing work protected. It may reach the input limit before the hop limit; no silent partial-turn compaction.           |
| `src/core/skills/catalog.ts`, Agent Skill integration, `test/core/execution/skill-selection.test.ts`                                                 | Selection is ordered, resolved/saved once for an ordinary Run, applied to normal requests and excluded from summary-only requests.                                                                              | One graph-wide selection must not be re-read or reactivated from historical records at later nodes.                                                          |
| `src/core/session/writer-lease.ts`, `storage-registration.ts`, `src/core/execution/deletion.ts`                                                      | Registered Session/journal pairing, owner/lease checks and deletion evidence constrain persistence.                                                                                                             | No graph-specific writer or maintenance bypass.                                                                                                              |
| `src/core/diagnostics/diagnostics.ts`; book A09                                                                                                      | Optional event listeners are isolated; buffers can drop data. Some tool exception shapes can have misleading success classification.                                                                            | Use required evidence and authoritative operation results for routing; never route on optional log classification.                                           |

### Baseline execution, not Graph confirmation

On macOS arm64 / Node 26.5.0, headers and build succeeded. This targeted command passed **143 tests**:

```sh
TS_NODE_PROJECT=tsconfig.test.json npx mocha --forbid-only --reporter dot \
  test/core/operator.test.ts test/core/processor.test.ts test/core/agent.test.ts \
  test/core/execution/run.test.ts test/core/execution/contracts.test.ts \
  test/core/execution/context-compaction.test.ts \
  test/core/execution/skill-selection.test.ts
```

The existing A12 memory-only reproduction still observes array mutation during iteration, shared options despite an aborted signal, error-value continuation, rejection stopping, and registry reference mutation. An additional memory-journal probe acknowledges `run-admitted` and one `run-ready`, rejects a second ready with `Duplicate ready record`, and rejects `graph-node-started` with `Unsupported execution metadata`. The poisoned append queue also makes journal close reject; the probe explicitly expects that rejection. Its first attempt overlooked close propagation and exited nonzero; correcting the assertion changed only the temporary diagnostic, not Orbit.

These checks establish the missing integration, not a successful new graph executor. No graph code or tests were added. `npm test` also passed all **517 tests** on the same macOS environment, including its format/lint pretest. No source changes resulted. Lint reported 0 errors and 30 existing warnings; Node loader/fs.Stats warnings also remained. No Linux or Windows rerun was performed for this documentation-only proposal; prior Unix evidence remains historical, not new Graph verification.

The additional rejection check can be reproduced from a built Orbit root without changing repository tests:

```js
import assert from 'node:assert/strict'
import {MemoryExecutionJournal} from './dist/index.js'
for (const [sessionId, kind, expected] of [
  ['graph-probe', 'run-ready', /Duplicate ready/],
  ['graph-probe2', 'graph-node-started', /Unsupported execution metadata/],
]) {
  const journal = new MemoryExecutionJournal(sessionId)
  await journal.append('probe', 'run-admitted', {requestId: 'probe'})
  await journal.append('probe', 'run-ready', {catalog: 'fixed'})
  await assert.rejects(journal.append('probe', kind, {}), expected)
  await assert.rejects(journal.close(), expected)
}
```

## External Systems Investigated

Sources below were re-read on 2026-09-12 at exact revisions. They are comparison snapshots, not claims about the newest release. External test suites and applications were not run.

| System / revision                                       | Inspected primary source                                                                                                                                                                                                                                                                                                                                                                                               | Verified observation                                                                                                                                                                                                                                                                          | Transfer and limit                                                                                                                                                                                                                        |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex `5adb68a49933ae446bf11935662c83dba55a0804`        | [`codex-rs/core/src/tasks/mod.rs`](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/core/src/tasks/mod.rs), `SessionTask`, `spawn_task`, `handle_task_abort`                                                                                                                                                                                                                     | Session owns tasks; task replacement requests abort. Abort signals cancellation, waits for completion or a grace timeout, aborts the task handle and invokes cleanup. Rollout flush errors in inspected abort/terminal paths are warnings.                                                    | Reuse the distinction between workflow work and its owner. Do not infer physical-effect termination from task abort or copy warning-only persistence into Orbit's mandatory journal. This file does not establish a generic graph engine. |
| Pi `b79e4cc834970cca69daebffab7df1da7d1e52c4`           | [`packages/agent/src/agent-loop.ts`](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/agent/src/agent-loop.ts), `runAgentLoop`, `runLoop`, `streamAssistantResponse`                                                                                                                                                                                                        | Entry/continue functions reuse an inner loop. Context transformation precedes conversion to model messages; tool results re-enter context. Error/aborted model outcomes terminate the loop. Event sinks are awaited.                                                                          | A reusable loop can remain an opaque work unit. Do not duplicate input transformation in a graph executor or infer Orbit-style required storage from awaited events.                                                                      |
| LangGraph.js `3609b35036f18c5a0cf9746910a45e0ab65ccf97` | [`libs/langgraph-core/src/graph/graph.ts`](https://github.com/langchain-ai/langgraphjs/blob/3609b35036f18c5a0cf9746910a45e0ab65ccf97/libs/langgraph-core/src/graph/graph.ts), `Branch._route`, `Graph.validate`, `compile`; [`state.ts`](https://github.com/langchain-ai/langgraphjs/blob/3609b35036f18c5a0cf9746910a45e0ab65ccf97/libs/langgraph-core/src/graph/state.ts), state channels and input/update validation | Builder compilation attaches nodes, edges and branches. Routing can map a result through declared destinations; unknown/null destinations reject. Validation checks edge endpoints and incoming targets, with broader conditional/error-handler cases. StateGraph adds channels and reducers. | Reuse explicit topology, constrained route labels and runtime value validation. Do not claim its incoming-target check proves every path terminates, or import parallel state merge/checkpoint semantics into the bounded serial scope.   |

A historical Codex `core/src/codex.rs` URL returned 404 at this revision and was not used as evidence. The inspected task module above is available. Existing broad Graph notes are reused for context; their un-reinspected framework/publication claims are not new findings here.

## Analysis

### Integration alternatives

| Alternative                                           | Benefit                                                                               | Cost / contrary evidence                                                                                                                                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep application orchestration outside core           | No new graph API, adequate for a single fixed script                                  | Does not provide the requested validated branches/finite cycles or shared graph evidence. Hand-written application ownership/budget logic is easy to duplicate.                                                 |
| Wrap independent `Agent.startRun()` calls             | Superficially small, leaves Agent internals untouched                                 | Resets counters and creates child admission/ownership boundaries. Aggregating estimates afterwards cannot enforce the original allowance. A safe hierarchical owner would require another substantial contract. |
| One Run, Agent as a coarse node                       | Keeps the existing model/tool loop; graph describes meaningful task stages            | Requires extracting a managed internal seam, one-time setup and turn finalization. Single-turn input protection can stop a long workflow earlier than a multi-turn design. Recommended.                         |
| One Run, model/context/tool operations as graph nodes | Internal path becomes explicit and closely matches the old directional recommendation | Couples graph evolution to compaction, Skills, pending tool messages, authorization and cleanup; larger parity surface with no demonstrated need for this scope. Defer.                                         |
| Adopt LangGraph as the executor                       | Mature graph/state infrastructure                                                     | A second scheduler, checkpoint model and control hierarchy need reconciliation with Orbit's already accepted owner/journal. No dependency addition justified by the narrow scope.                               |

### Definition, identity and value flow

Use a TypeScript builder over closed JSON descriptors plus a trusted host registry; do not load executable text from a graph file. Freeze topology, schema declarations, versioned adapter references and configuration at admission. Structural validation should require explicit endpoints, one selected successor, reachability from the entry and a path from every reachable node to a terminal. Even a valid cyclic graph can keep choosing the cycle, so a global visit limit must be enforced at runtime.

A descriptor digest identifies declared topology and adapter versions, not the contents of arbitrary JavaScript closures. The host is responsible for versioning injected implementations; static validation is not a sandbox. Require runtime JSON/schema validation even when TypeScript types match. Use immutable input/output values, an explicit router node returning a declared label, and named transforms for shape changes; omit general shared-state reducers in the first scope.

### Execution and storage compatibility

Keep one graph Run and one Session turn. Initialization resolves one environment/model/catalog and one ordered Skill selection. Agent visits reuse prepared resources and active Skills; they do not repeat public admission, ready or turn-start. They may append new step input to the same turn and run the unchanged model/tool loop. Per-visit loop allowances may only be tighter than the shared remaining counters. Direct tool nodes use managed authorization and report target failures as typed data.

Add required graph binding, node start/result and transition evidence under the same journal owner. Durable identity needs the bounded descriptor and version/configuration bindings, not just a display name. Preserve digests rather than raw state/output bodies, and retain the existing minimum deletion record. The current closed journal format cannot accept these fields/kinds; the ADR must make reader deployment, version recognition and torn-tail handling explicit. No new transcript record is needed for the proposed single-turn scope; the required journal maps visits to that turn and its message IDs.

Recovery observes an interrupted Run and reconciles unknown effects. It never automatically invokes the next node or repeats the last operation. Exact graph input/output bodies and executable closures are not persisted by this proposal, so complete replay and checkpoint continuation cannot be promised.

### Same-baseline proposal review — 2026-09-12

Review validation on macOS arm64 / Node 26.5.0: headers:check, build and the complete 517-test suite passed; lint retained 30 existing warnings and no errors, with existing Node warnings. No source/test/dependency changes resulted. The two lifecycle cases, three read-only prefix cases and original duplicate-ready/unknown-kind probe passed. These are baseline observations, not Graph implementation evidence or new Linux/live-model trials.

This review of `b2b8f445a4284c14f787ed80a895c8342ae1ea71` found no subsequent source/test/accepted-contract differences. Public main now matches that proposal commit. It preserves the original investigation above and the same coarse-node recommendation; the following corrections qualify the proposed integration rather than adopting it.

| Evidence checked                                                                                                    | Finding / non-binding implication                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/execution/run.ts`, `startRun`, `admit`, `execute`; `test/core/execution/run.test.ts`, `contracts.test.ts` | Live replay compares canonical `input`; recovered replay compares its HMAC from admission. Configuration is separately digested. Put all explicit Graph options in submitted input, so interruption before graph-bound cannot lose replay identity.                                                                                                                                                                                                  |
| Same finalizer, memory-only probe                                                                                   | A thrown declared failure produces reason runtime-failed. A body value of 42 followed by synchronization rejection produces failed recording but retains value 42 and reason completed. Thus the original ADR's ordinary-value claim was incorrect. Propose a Graph-only final-value publication wrapper and an internal body disposition, rather than changing ordinary handle compatibility or converting domain failure into a user cancellation. |
| `src/core/agent.ts`, `invokeSessionWithTurn`; `src/core/tools/registry.ts`                                          | The catalog exists only after managed MCP discovery. Compile-time definition checks cannot establish remote tool availability/schema. Bind declared names/sources/schemas once after discovery and before ready; failure has startup ownership but no graph visit or tool call.                                                                                                                                                                      |
| Agent counters and `src/core/execution/authorization.ts`, `executeManagedTool`                                      | Agent consumes toolRequests before calling the runtime; the managed helper does not. A direct tool node needs explicit one-request accounting. Retain Agent-only toolRounds; direct visits are bounded by request/visit limits, rather than redefining the adopted round meaning.                                                                                                                                                                    |
| `src/core/session/session.ts`, `synchronize`; `src/core/session/codec.ts`; `src/core/execution/recovery.ts`         | Synchronization returns an entry count, not a message count. Journal inspection reports invalid/torn prefixes without writing, while transcript parsing validates complete JSON even without a newline. Keep their tail policies distinct and mark unavailable cross-file evidence explicitly.                                                                                                                                                       |
| `src/core/execution/authorization.ts`, `notStarted`, preparation failure; journal validator                         | Denied/invalid/not-started results can have no intent. A strict v2 graph decoder must retain these legal records and failure prefixes; it must not require a successful node path for an initialization failure or cancellation.                                                                                                                                                                                                                     |

The lifecycle probe can be repeated from a built Orbit root with `RunSupervisor` and `MemoryExecutionJournal`: create one Run whose execute callback awaits ready then throws `Error('graph-declared-failure')`; create another whose execute callback awaits ready and returns 42, with synchronize rejecting. Await each handle's finished result and assert the observations above, then close both supervisors. These are observed limitations of current composition, not implementations of the proposed correction.

For a read-only decoder probe, use an isolated temporary session journal and a valid admission prefix. Append (a) a newline-terminated version-2 ready record, (b) the same JSON without a final newline, and (c) malformed JSON with a final newline. `inspectExecutionJournal` returned one valid prefix record for every case, with an invalid-evidence issue for (a)/(c) and a torn-final-record issue for (b). The original bytes remained identical. This inspection does not approve repair, v2 support or redispatch. Current file writer and transcript codec source were separately inspected; journal inspection is not claimed to exercise those write/migration paths.

Alternatives remain meaningful: expose ordinary early values and force all consumers to interpret final status, or gate Graph values on acknowledged completion; throw a normal exception and accept runtime-failed, or preserve a typed declared-failure reason through the shared finalizer. The latter options are recommended for Graph, with explicit compatibility tests. The author must accept those costs alongside the one-turn input limit and journal-v2 migration; this review gives no Graph adoption authority. Existing seven partial ADRs and author-directed deferrals remain unchanged.

## Implications for Orbit

The [proposed ADR](../adr/2026-09-12-managed-processor-graph.md) specifies the recommended contract and confirmation matrix. It extends the managed Run and required journal for graph evidence while preserving operation authorization, registered storage, input budgeting and Skill rules. The old internal-loop-first recommendation is a non-binding direction, not an accepted decision to undo.

Keep current architecture and feature docs describing the existing implementation until adoption and implementation. Add retrieval links to the directional concept without declaring Graph implemented. Leave old Operator/Processor signatures and mutable behavior compatible; graph registration is a separate explicit adapter contract.

## Risks and Limitations

- A single protected turn may exhaust the input budget before a long graph finishes. That is an explicit trade-off, not permission to compact active work differently.
- Caller-declared adapter versions cannot prove a callback has no side effects or that two deployments run identical code.
- Schema compatibility should be conservative; arbitrary JSON Schema subsumption is not established by matching TypeScript generics.
- Optional diagnostics are unsuitable for mandatory routing evidence. Known logging limitations remain recorded in A09.
- No new dependency, performance benchmark, physical storage failure, real-model quality measurement or production trial was performed.
- Windows, operational restart control, physical failures and representative application trials remain author-deferred; backup deletion is still awaiting separate authorization. Existing accepted/partial ADRs remain partial.

## Open Questions

The author must judge the Agent-as-node granularity, one Run/one turn cost, initial single environment/catalog restriction, frozen adapter trust model and graph-journal compatibility cost. Finite profile values are proposed test starting points, not measured optima. These questions do not prevent preparing or reviewing the proposal; they do prevent treating it as accepted.

## Related Decisions

- [Managed Run Lifecycle](../adr/2026-09-07-managed-run-lifecycle.md)
- [Prepared Operation Authorization](../adr/2026-09-07-prepared-operation-authorization.md)
- [Required Execution Journal](../adr/2026-09-07-required-execution-journal.md)
- [Session Writer Recovery Guard](../adr/2026-09-08-session-writer-recovery-guard.md)
- [Session Storage Registration Guard](../adr/2026-09-08-session-storage-registration-guard.md)
- [Budgeted Session Compaction](../adr/2026-09-08-budgeted-session-compaction.md)
- [Run-scoped Skill Selection](../adr/2026-09-09-run-scoped-skill-selection.md)

## References

- [Current processor primitives](../../src/core/processor/)
- [Agent implementation](../../src/core/agent.ts)
- [Common execution and required journal](../../src/core/execution/)
- [Current execution guide](../execution.md)
- [Current context policy](../context-compaction.md)
- [Current Skill guide](../skills.md)
- [Directional Processor Graph](../concepts/processor-graph.md)
- External fixed-revision source links are listed in the comparison table above.
