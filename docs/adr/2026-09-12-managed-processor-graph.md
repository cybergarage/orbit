---
status: proposed
proposed-date: 2026-09-12
decision-date: null
implementation-status: not-started
implementation-completed-date: null
implementation-commits: []
superseded-by: []
---

# Managed Processor Graph

## Purpose

Allow an application to declare serial work, select among declared branches and repeat work within a finite limit, while retaining Orbit's common execution, authorization, storage and input contracts. The first use is an investigation/edit/target-test workflow. The graph controls which stage runs next; it does not decide that model output is correct or authorize an operation merely because an edge reaches it.

## Decision

**Proposed recommendation; not accepted.** Add a validated programmatic graph whose entire invocation is one managed Run and one Session turn. Use the existing Agent model/tool loop as a coarse node through a shared internal execution seam. Do not graph-expand that loop, introduce a second Run owner, or implement while this record is proposed.

### Scope and responsibility

Core validates and freezes the graph, invokes one node at a time, checks values and route labels, enforces finite visits plus the existing Run budgets, and acknowledges required path evidence. The application supplies the workflow, versioned trusted adapters, schemas, task input and permitted environment. Operation policy is still enforced inside prepared execution, never by a graph node that can be bypassed.

Initial scope:

- Serial nodes, explicit router nodes, declared edges, explicit success/failure terminals and cycles subject to a global visit cap.
- One Session, workspace/policy, model configuration, resolved tool catalog, context policy and ordered Skill selection per graph Run. Agent nodes reuse that environment; tool nodes use its frozen catalog.
- Programmatic TypeScript construction with bounded JSON descriptors and runtime validation. No graph-file code evaluation or arbitrary module loading.
- Public proposed entry shape: a compiled graph's `startRun(newInput, options)` returns the existing `RunHandle<GraphValue>`; snapshot, stop, approval reply and close use the same supervisor ownership rules. Concrete exported names must be checked during implementation, but these behaviors are part of the proposed contract.
- A library/application-service entry accepts an explicit compiled graph; existing Agent/CLI/GUI requests keep their current default behavior. This does not include a graph editor, a GUI workflow picker or silently applying graphs to ordinary requests.

Exclude parallel fan-out/join, subgraphs, scheduling, autonomous topology generation, evaluation/promotion, per-node model/catalog changes and durable middle-node continuation.

### Validated definition and frozen identity

A graph descriptor contains a descriptor revision, graph ID, named entry, nodes, ports/schemas, edges and terminal labels. Each node references a trusted adapter ID and explicit implementation version. Node kinds are managed Agent, managed tool, pure transform and pure router. Router output is exactly one label from a declared finite set. The scheduler forwards a validated immutable copy of the router input along that edge; it does not replace the data value with the label. A separate transform is required to change data shape. For router evidence, the output digest covers this forwarded value and the transition records the selected label. An ordinary work/transform node has one successor; use an explicit router to branch. Terminals have no successors.

At compile/admission, reject duplicate or reserved IDs, unresolved adapters, unknown ports/endpoints, unknown fields, invalid schemas, missing entry/terminals, unreachable nodes and reachable nodes with no path to a terminal. Check both forward reachability and reverse reachability; merely having an incoming edge is insufficient. Require finite positive `maxNodeVisits` for every graph, including apparently acyclic graphs. Count every node visit, including routers, before invocation. No callback condition alone constitutes a loop bound.

Runtime values are plain finite JSON with no functions, class instances, cycles or lossy encoding. Validate graph input, every node input and output, and the final value. A node returns a whole value; pass an immutable copy to its successor. Use named transform nodes for shape changes. The initial schema compatibility rule is identical normalized schema identity at a direct connection, or an explicit transform declaring/validating both schemas. Do not pretend to solve general JSON Schema subsumption. Use the existing bounded tool-schema validation machinery where applicable; forbid remote schema fetching and implicit coercion/default insertion. Bound schema size/depth and reject recursive references and custom executable validators in the first profile; supported constraints require explicit conformance tests. No shared mutable graph-state object or general reducer/patch language is introduced.

Compile copies topology, configuration and schema data. Admission binds the compiled descriptor, adapter references and effective configuration before resource factories run; changes to caller arrays, registry entries, options or node names cannot affect the admitted Run. Capture live function references once, not by a later registry lookup. The host must not mutate closure behavior under a declared version. This is a trust requirement, not bytecode attestation or a sandbox guarantee.

Store a SHA-256 identity for the normalized public descriptor (sorted IDs/keys, explicit route ordering where meaningful) and journal-keyed digests for effective private configuration. Versioned adapter references identify the supplied implementations; the host owns honest version changes. Public descriptors must contain no credentials, instruction bodies, environment values or private resource paths. Keep those in frozen private configuration represented by digests. Graph identity is unrelated to chapter commits or tags.

The submitted replay identity includes the graph descriptor identity, explicit adapter/configuration bindings, canonical new input, ordered Skill selections and caller limits. Same request ID with the same submission returns the existing Run without reloading adapters/Skills or restarting budgets. A conflicting graph or explicit configuration under that ID rejects. Resolve duplicate requests before effectful initialization, preserving ordinary Run replay semantics when ambient configuration changes. A fresh request freezes the then-current environment.

### One Run, one turn, reusable Agent work

Graph admission reuses `RunSupervisor`, registered Session/journal ownership and the existing initialization clock. Extract Agent's current setup, turn lifecycle and iteration body into one internal managed execution implementation. Ordinary Agent invocation remains a single-use adapter of that implementation and must pass existing behavior tests.

Graph setup creates one MCP manager, resolves one catalog, reads selected Skills once, records the exact Skill snapshot once, synchronizes the initial turn/input at the journal storage level, and acknowledges one `run-ready`. The graph's initial new messages enter one Session turn once. An Agent visit appends only its newly projected step input to that same turn, then invokes the shared model/tool iteration body. It does **not** call public `Agent.startRun`, open another writer, create a nested supervisor, repeat `turn_context`/turn-start, emit a Run terminal or call ready again. Graph-owned finalization writes the one turn terminal and one Run terminal. Use a monotonic model-iteration ordinal across Agent visits for transcript/diagnostic correlation, keeping the per-visit loop counter separate. Preserve model tool-call IDs in conversation messages and disambiguate operation evidence by visit/invocation and unique operation IDs. Visit identity is separate required evidence, not a replacement for Run/turn identity.

This requires a real refactor: the current private `invokeSessionWithTurn` combines all these responsibilities and currently uses turn ID as Run ID in diagnostics. Do not expose an unrestricted public `executionContext` escape hatch. Internal capability objects must verify their owner and lifetime. The existing loop, authorization calls, input assembly and cleanup remain one source of behavior rather than a second Graph implementation of them.

All normal model requests across all visits apply the single active Skill snapshot and the current context policy. Summary-only requests exclude Skill instructions exactly as today. Previously saved Skill snapshots are never activated by walking old graph records. A new graph Run needs a new explicit selection; same-ID replay performs no selection I/O.

**Explicit cost:** all visits remain part of the latest protected turn. Budgeted compaction may compress earlier completed turns, but cannot compress earlier visits of the active graph turn. If protected input cannot fit, stop under the current input-budget contract even when visits remain. Do not silently move visits to separate turns, summarize active work, or reset limits to make a long graph succeed. A multi-turn graph would require a separate decision about Skills, context protection and recovery.

### Node invocation, permission and failure

Each visit has a monotonic visit number plus a unique invocation ID, even on repeated node IDs. Before starting it, check the Run state/deadline, consume a visit allowance, validate input and acknowledge `graph-node-started`. Invoke its managed adapter only after that acknowledgement.

Managed tool nodes resolve through the frozen tool catalog, consume the existing tool request allowance, and use the same preparation, confirmation, last-moment revalidation, intent acknowledgement, execution and result acknowledgement as Agent tools. Assign unique call/operation IDs and include the active visit ID on version-2 operation-intent/result records. Initialization MCP operations have no active visit. Validate these references against the active graph visit and list them in its completion record. Direct tool results are graph values; do not fabricate an assistant tool call in the conversation. A later Agent input may explicitly project that value into a new user/task message through a trusted transform.

A typed known failure (for example a target command's nonzero exit with confirmed completion) can become validated output routed through a declared label. A model's statement that tests passed cannot replace the actual managed command result. Router/transform nodes have no tool executor capability and must be trusted, bounded, cooperative computations. Declaring a JavaScript callback pure cannot prevent it using ambient Node APIs; unsupported/untrusted executable nodes are rejected, and the proposal makes no isolation guarantee against malicious host code.

Arbitrary exceptions, invalid values, unknown route labels, policy denial requiring termination, cancellation, recording failure, budget exhaustion and unknown effects stop scheduling. They cannot follow an ordinary retry edge. No implicit catch-all retry or automatic compensation is added. Known domain failures can follow only an explicitly declared, validated route while the Run is still usable.

Await node completion, validate and freeze its result, synchronize any newly appended conversation/Skill records at the journal storage level, acknowledge `graph-node-completed`, compute/validate the one successor, and acknowledge `graph-transition` before starting that successor. A successor never starts if result or transition acknowledgement fails. Pure router decisions are recorded just like work nodes and count toward the cap.

An explicit success terminal yields `completed` and a bounded `GraphValue` containing the final value and graph identity. An explicit failure terminal yields `failed` with reason `graph-declared-failure`; preserve the typed last result in a proposed graph-specific `getGraphSnapshot(runId)` view so it can be inspected in the live process. Keep `RunHandle.value()` undefined on failed execution as today; recovery exposes the recorded outcome/digest, not an invented missing body. Neither completed nor a route named `passed` is a quality score. Existing `RunResult.operations`, recording status, quiescence and unresolved resources remain authoritative. Cancellation/budget/unknown effects keep the existing outcome mapping, regardless of the last route label.

### Budget, cancellation and resource ownership

Share the existing monotonic elapsed deadline from admission, modelCalls, toolRequests and toolRounds across every visit, including summary and MCP preparation work under their current accounting. Agent per-visit iteration limits may only tighten shared limits; they never replenish the Run counters. Keep graph visit accounting distinct from Agent tool rounds. A graph cannot buy another allowance by branching back to an Agent node.

Use `RunContext.wait/track` for asynchronous adapter work, schema/configuration preparation that can await, recording and cleanup. Check stop before and after each awaited transition and immediately before dispatch. A stop while a node or router ignores cancellation stops later scheduling but leaves started work owned. The bounded caller result may be incomplete; do not close or reuse the Session/workspace merely because a graph edge was not selected. Retain quarantine and late-settlement/reconciliation behavior. Pending approval remains addressed to its original Run/operation/digest and expires normally.

Only Graph/Agent setup owns shared resources. Nodes borrow the model, MCP manager, catalog, Skill reader, Session writer and journal and cannot close or release them. Close once at the common owner after final synchronization/cleanup. Keep resources reserved through pure/router gaps between effects. Deletion, storage migration and maintenance use existing services and external stop/restart conditions; Graph has no alternate lock or deletion API.

These limits do not preempt synchronous non-yielding JavaScript. That existing in-process trust limitation also applies to trusted transforms/routers. Do not claim a hard wall-clock guarantee against a blocked event loop; confirmation includes asynchronous non-cooperation and reports the synchronous limitation separately.

### Required graph evidence and compatibility

Introduce **journal envelope version 2 for Graph Runs**. Keep version 1 ordinary Run records readable and leave ordinary Run writers on their existing version until they use Graph. A journal may contain old version-1 Runs followed by version-2 Graph Runs; every record within one Run uses its admitted version. This is a proposed persistent-format extension, not an already supported field addition.

A version-2 Graph Run contains the existing admission/ready/operation/stop/terminal/settlement semantics plus:

| Record                 | Required data and barrier                                                                                                                                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `graph-bound`          | Descriptor revision/identity, bounded public descriptor, adapter version bindings, private configuration digests, graph profile and Session turn ID. Exactly once after admission, before invoking graph resource factories, and before ready. |
| `graph-node-started`   | Graph identity, node ID, visit/invocation ID, input digest, remaining visit/call budget, and current message high-water reference. Before invoking the adapter.                                                                                |
| `graph-node-completed` | Same visit identity, typed outcome, output digest, operation IDs and conversation message range produced by that visit. After result validation and all visit-owned required evidence; before routing.                                         |
| `graph-transition`     | Completed visit, declared route/edge ID, destination or terminal, and output digest. After route validation; before the next visit or graph terminal.                                                                                          |

Use the existing journal HMAC for private value digests. Do not add raw input/output or Skill bodies to graph journal records. The descriptor is bounded and contains only the permitted metadata above; full bodies remain in conversation/Skill records only where those contracts already require them. Optional diagnostics can mirror visit IDs and progress but cannot acknowledge these barriers.

The decoder validates the state machine, descriptor identity, unique invocation IDs, sequence, matching node result/transition, operation references, message references and allowed destinations. No duplicate binding/ready/terminal, unmatched completion, jump to an undeclared node, graph action after terminal or mixed envelope versions within a Run. A recording failure after an external effect preserves the operation's known/unknown result and stops; it does not retry the effect. Late settlement can resolve owned work after an incomplete result without rewriting the original terminal or scheduling another node.

Keep the 1 MiB encoded journal-record ceiling and existing deletion tombstone contract. Reject an oversized binding before graph initialization. Reject oversized runtime values before forwarding; an already performed effect is not undone by rejecting its output. Do not weaken the existing Skill revision-1 4 MiB record limit or reject old valid Skill records when graph/product limits are lower.

Current version-1 readers reject complete unknown versions/kinds rather than treating them as a recoverable torn tail. Before the first version-2 Graph Run in a saved Session, stop old writers/readers and automatic restart sources; update every process using that Session/journal pair. Preserve evidence and backups. No new transcript type is needed for this one-turn profile: retain transcript v2 and current Skill record revision, and correlate visits in the journal. Do not imply that a transcript-only old reader can verify the new journal.

New recovery scans may inspect mixed historical Runs, but must reject malformed complete graph records and preserve truncated tail bytes under the current recovery rules. Missing binding, ready, completion or transition after interruption is observed as incomplete/failed evidence, never interpreted as an instruction to execute. Same-request replay returns a recovered observation; no automatic mid-node continuation, model reinvocation or effect repetition. The minimal deletion record survives deletion through the existing service; new graph evidence is removed with its owning journal, not from a separate graph store.

### Initial profile proposed for measurement

Propose 64 nodes, 128 edges, 128 node visits, a 256 KiB canonical descriptor and 64 KiB for each encoded graph value as a starting coding profile. These give explicit finite metadata/route bounds within the existing 1 MiB record ceiling; they are not performance or usability optima. Schema/configuration parsing must have bounded depth/size and no remote resolution. Validate actual encoded record size as well as each component; component limits do not guarantee their sum fits.

Keep existing finite Run defaults; a caller may choose other valid finite limits before admission. Measure at least a serial success, one failed target test followed by correction, visit exhaustion, input-budget exhaustion and slow cooperative operations. Record observed constraints and any required adjustments rather than silently loosening the accepted profile during implementation. Wider application/SLI/SLO and real-model quality trials remain deferred under author policy.

## Consequences

- Positive: one owner and record stream cover the workflow, and application stages become explicit without duplicating Agent reasoning/tool behavior.
- Positive: declared routes, validated values and finite visits make mistakes reproducible with fixed doubles.
- Negative: setup/turn/loop extraction and journal version 2 are real compatibility work; a wrapper around today's sequence or public Agent API is insufficient.
- Negative: one protected turn, one model/environment/catalog and bounded values limit long or heterogeneous workflows. This is an explicit first profile, not support for arbitrary multi-agent orchestration.
- Neutral: legacy Operator/Processor/Sequence/Registry APIs retain their semantics. New graph adapters are explicit; function identity and purity remain host responsibilities.
- Negative: stopping old processes before new journal records and preserving interrupted effects requires deployment work even when the first application is local.

## Context and Problem Statement

Baseline: `64f3cc1a31f194a0129efb511b3aa8dc7c029525`, investigated 2026-09-12. Operator/Processor primitives and their 14 tests have no diff from A12's `8ee97144c20b006225db52efc482004200527e4c`. Agent, Run, storage, input budgets and Skills changed substantially. `OperatorSequence` still shares arrays/options and has no routing, validation or ownership contract.

`Agent.startRun` currently owns initialization and calls private `invokeSessionWithTurn`, which resolves Skills and records ready on each invocation. Journal validation rejects duplicate ready and undeclared metadata. A memory-only probe reproduces both rejections, including close failure from a poisoned queue. These facts rule out pretending the proposed graph is already available through existing composition.

The prior directional graph concept recommended extracting the internal model/tool cycle first. A12 recommended Agent as a node. Neither is an accepted Graph decision. The [new research](../research/2026-09-12-bounded-processor-graph-execution.md) compares them against the updated baseline; this proposal recommends the latter with an explicit shared managed seam.

### Relationship to accepted decisions

This proposal extends [Managed Run Lifecycle](2026-09-07-managed-run-lifecycle.md) with graph visits and extends [Required Execution Journal](2026-09-07-required-execution-journal.md) with a versioned graph record state machine. It retains one admission/ready/terminal, shared budgets, ownership and failure semantics. The literal closed journal version/kind set changes only upon acceptance and implementation of this ADR; existing adoption reasons and records are not rewritten or marked superseded by a proposal.

[Prepared Operation Authorization](2026-09-07-prepared-operation-authorization.md), [writer recovery](2026-09-08-session-writer-recovery-guard.md) and [storage registration](2026-09-08-session-storage-registration-guard.md) remain controlling for each effect and persisted resource. [Budgeted compaction](2026-09-08-budgeted-session-compaction.md) and [Skill selection](2026-09-09-run-scoped-skill-selection.md) remain controlling for every model request. Graph's single turn intentionally avoids broadening those adopted lifetimes. All seven accepted/partial records retain their status, rationale, evidence and deferred checks.

## Decision Drivers

- Explain task-level branches and bounded correction loops without redesigning the successful common Run.
- Prevent graph construction, routing, replay or a new node from bypassing permission, budget or required persistence.
- Distinguish declared topology, executable host behavior and the actually observed path.
- Make crash evidence useful without promising automatic continuation of effects.
- Keep future Graph evaluation and autonomous promotion outside this decision.

## External Implementation Research

Re-read on 2026-09-12; none was executed:

- Codex `5adb68a49933ae446bf11935662c83dba55a0804`, `codex-rs/core/src/tasks/mod.rs`: Session-owned task lifecycle separates work, cancellation and cleanup. Adopt the ownership lesson, not warning-only rollout failure behavior or a claim that task abort proves external effects stopped.
- Pi `b79e4cc834970cca69daebffab7df1da7d1e52c4`, `packages/agent/src/agent-loop.ts`: public loop entry/continue reuse a loop with context transformation and tool feedback. Preserve one reusable loop; awaited event emission is not evidence of Orbit-style durable journaling.
- LangGraph.js `3609b35036f18c5a0cf9746910a45e0ab65ccf97`, `libs/langgraph-core/src/graph/graph.ts` and `state.ts`: explicit builders, declared destinations, compiled graph and runtime state validation inform this design. Its broader channels/reducers/parallel control are not required here; endpoint/incoming-edge checks do not establish finite execution.

Pinned primary links and contrary evidence are in the [source table](../research/2026-09-12-bounded-processor-graph-execution.md#external-systems-investigated). No dependency is selected by this comparison.

## Considered Options

| Option                                           | Assessment                                                                                                                                           |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep only hand-written application orchestration | Smallest for one script, but leaves the requested shared graph contract unimplemented.                                                               |
| Independent Agent Runs wrapped by a graph        | Easy to call, but counters reset and ownership/recording need a new hierarchy. Reject as the recommended first implementation.                       |
| Single Run with Agent as coarse node             | Recommended. Requires setup/lifecycle extraction but preserves the inner loop and makes application steps visible.                                   |
| Graph-expand Agent's internal loop now           | Matches old directional text; much larger compatibility surface around context, Skills and incomplete tool calls. Defer.                             |
| General LangGraph-backed executor                | Reuses mature features, but introduces scheduler/state/checkpoint semantics needing reconciliation with Orbit. Not justified for this bounded scope. |

For values, prefer whole immutable validated outputs over in-place shared mutation or general reducers. For persistence, prefer mandatory bounded path evidence over optional logs or complete checkpoints. For graph authoring, prefer TypeScript with closed descriptors over an executable JSON/JavaScript loader. These choices form the one bounded execution contract and remain proposed together.

## Implementation and Confirmation

No Graph implementation is authorized or present. `implementation-status` remains `not-started`; there are no implementation commits or completion date. Headers/build and 143 focused baseline tests passed on macOS; these are evidence for existing behavior, not confirmation of any item below.

| Area                              | Required post-adoption confirmation                                                                                                                                                                                                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Invalid definitions               | Duplicate/unknown IDs, reserved names, bad ports, schemas, non-JSON/oversized values, forward/reverse unreachable nodes, invalid cap and undeclared routes reject. Prove adapter/model/tool factory counts are zero before admissible binding; configured MCP discovery occurs only under normal managed initialization. |
| Frozen identity and replay        | Mutate caller arrays/options/registry after compile and during a blocked visit; live graph does not change. Change adapter version, ordered Skills, graph or explicit limits under a replay ID and reject. Identical replay performs no reread/reload/dispatch; restart returns observation only.                        |
| Serial/branch/cycle behavior      | Fixed doubles verify exact visit IDs, input/output values, declared routes, success/failure terminals, one failed real isolated target test followed by one correction, and cap exhaustion before the next invocation. Separate target, application and core test results.                                               |
| Single owner and Agent parity     | One admission/ready/turn-start/turn-terminal/Run-terminal, one catalog/Skill snapshot, one MCP close. Ordinary Agent normal/error/stop/replay behavior passes unchanged through the same loop. No nested supervisor or independent allowance.                                                                            |
| Budgets and context               | Shared counters include all visits and existing summary accounting. Active graph-turn messages remain protected; oversized protected input stops with no extra model call. Budget-disabled input mode still has finite Run/visit limits. Skills affect normal requests only, once, and never reactivate on resume.       |
| Permission and effects            | Denial, expired/mismatched/late approval, changed target and policy revocation do not dispatch. Direct tool nodes and Agent tools use the same prepared path. Unknown outcomes cannot take retry edges. Use isolated Unix targets.                                                                                       |
| Cancellation/ownership            | Stop before node start, during approval, model, tool, pure asynchronous callback, recording and cleanup. Await actual completion or report incomplete/quarantine. Late settlements cannot schedule successors. Competing Run/deletion remains refused while owned resources survive. Timeout alone is never success.     |
| Required records and interruption | Fail/intercept before and after admission, graph binding, ready, every node/result/transition and terminal append/sync. No effect before required start/intent acknowledgements; no successor after failed result/transition acknowledgement. Preserve partial evidence and response-loss distinctions.                  |
| Readers and migration             | Mixed v1 historical and v2 Graph Runs load with new readers; old readers reject complete v2. Reject corrupted full lines and preserve torn-tail evidence separately. Verify replay, deletion service and minimum tombstone, registered roots and interrupted maintenance. Never delete backups without authorization.    |
| Metadata/privacy                  | Descriptor/whole-record/value limits checked at exact byte boundaries; no secret configuration or input body in required metadata. SHA identity and keyed digests validated. Do not lower historical Skill record acceptance to graph product bounds.                                                                    |
| Documentation/API                 | Export and type tests, library/service entry tests, architecture, concepts, execution and graph feature/migration docs reflect only implemented behavior. No speculative GUI editor. Unix headers/build/full test and fixed-double success are recorded separately from live quality.                                    |

Initial numeric profile trials measure constraints, not optimum values. Windows, representative application/model trials, deployment stop/restart and physical-fault trials remain deferred until their environments, application and SLI/SLO conditions are specified. Deferred items cannot be silently counted as completed.

## Follow-up Work

Author decision points before acceptance:

1. Agent as one stage with internal setup/loop reuse, rather than graph-expanding the model/tool loop.
2. One Run/one protected turn and one environment/catalog/Skill selection, including possible earlier input-budget exhaustion.
3. Explicit trusted adapter versions and immutable JSON value flow with conservative schema matching; no sandbox or arbitrary executable graph loader.
4. Required journal version-2 Graph records, old-process shutdown/migration cost, digest-only value evidence and no automatic checkpoint continuation.
5. The finite starting profile and confirmation matrix, with initial values subject to measured trials rather than optimality claims.

After review and explicit adoption, implementation can follow technical dependencies: descriptor validation and reader compatibility; shared managed Agent seam; graph scheduling/required evidence; application-service integration and parity/fault tests; maintained documentation. This is not an implementation authorization or chapter gate. Keep backup deletion pending and the seven earlier partial decisions unchanged. New material contradictions need their own rationale rather than rewriting adopted reasons.

## References

- [Bounded Processor Graph Execution research](../research/2026-09-12-bounded-processor-graph-execution.md)
- [Earlier adaptive Graph research](../research/2026-09-02-adaptive-processor-graph-runtime.md)
- [LangGraph representation research](../research/2026-09-03-langgraph-concepts-intermediate-representations.md)
- [Current Agent implementation](../../src/core/agent.ts)
- [Current Processor primitives](../../src/core/processor/)
- [Current Run](../../src/core/execution/run.ts) and [journal validator](../../src/core/execution/journal.ts)
- [Current execution guide](../execution.md)
- [Directional graph concept](../concepts/processor-graph.md)
