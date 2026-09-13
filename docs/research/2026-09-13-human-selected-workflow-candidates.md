---
status: current
investigation-date: 2026-09-13
orbit-commit: a8947960b1dcdc14625c3b18ef337bad4423e468
related-adrs:
  - docs/adr/2026-09-13-application-owned-workflow-selection.md
superseded-by: []
---

# Human-selected Workflow Candidates

## Purpose

Investigate the smallest governed selection layer that can associate human-authored finite Graph candidates with evaluation evidence, select one for later Runs and return to an earlier candidate. This is non-binding research. It neither approves candidate selection nor extends earlier delegations for input budgets, Skills, Graphs or evaluation.

## Research Questions

- Which A17 assumptions changed after managed Graph and read-only evaluation implementation?
- How can a selection change coexist with in-flight work and the existing submitted-input replay contract?
- Which identity, evidence, authorization and storage responsibilities belong in the application?
- What can recovery prove when application decision storage and Run admission are separate transactions?

## Findings

1. **Verified:** a Graph can now be supplied to each Run on an existing Agent/Thread. Replacing a Thread's Agent to change only its Graph is unnecessary. The Agent's model and environment still have their existing lifetime.
2. **Verified:** replay compares the full submitted Graph/configuration/input and ordered Skill selection. Re-resolving an active candidate on retry can conflict with the original request. A current-selection pointer is insufficient as a dispatch record.
3. **Verified:** evaluation checks a separately trusted plan and keeps fixed denominators, missing evidence and metric coverage. Its `selected` field chooses report revisions, not a production workflow.
4. **Inference:** an application needs immutable candidate/evaluation references, an authorized compare-and-swap selection transaction and a request-to-candidate receipt before dispatch. These are application control records, not a second execution journal.
5. **Proposal:** keep generic bounded validation in core and selection, human authority, persistence and retention in a reusable Application Service extension with a host-supplied transactional store. The first candidate scope should vary Graph definition/private node configuration/registered adapter references, not silently replace model, tools, Skills or environment in an existing Agent.

## Orbit Baseline

A17 originally inspected `8ee97144c20b006225db52efc482004200527e4c` on 2026-09-07. Diff inspection through `a8947960b1dcdc14625c3b18ef337bad4423e468` covers `src`, `test`, `docs/research` and `docs/adr` (164 changed files). Public main remained `1cb6f4f2abe3e89e27c1bdb32f1049183ef0e960` at investigation. The working tree was clean. Evaluation implementation is local; no publication or latest-release claim is made.

| Inspected source                                                                           | Current evidence                                                                                                                                                         | Selection implication                                                                                                                                    |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/application.ts`: `startGraphRun`; `thread.ts`: `startGraphRun`, `startThreadRun` | Application Service forwards a compiled Graph for an individual Run. Thread submission identity includes Graph, configuration, profile, input and ordered Skills.        | Reuse the per-Run entry rather than mutable registry lookup or Agent replacement.                                                                        |
| `src/core/processor/graph-definition.ts`: `CompiledProcessorGraph`, `graphBinding`         | Graph data is copied/frozen and callbacks are held in trusted bindings. Honest adapter versioning and closure immutability remain host obligations.                      | A candidate digest cannot attest executable behavior or make serialized code safe.                                                                       |
| `src/core/agent.ts`: `startGraphRun`, `startManagedRun`                                    | Submitted input carries Graph/configuration/profile and explicit options; model construction precedes Runs. Normal preparation creates the owned catalog/Skill snapshot. | Separate fixed application context from candidate-varying Graph data. Validate expectations against the prepared snapshots, not a second discovery.      |
| `src/core/execution/run.ts`: `RunSupervisor.startRun`, `admit`, `recoveredRunSnapshot`     | Duplicate lookup precedes factories; recovered inspection compares request digests. Active/unreleased/quarantined work prevents a new Run in the same supervisor.        | Receipt lookup must precede active-selection lookup. Selection cannot release resources or turn absence of a response into permission to repeat effects. |
| `src/core/evaluation/{plan,evidence,comparison,metrics}.ts`                                | Trusted-plan validation, independent checks, host trust, planned slots, report history and missing measurements already exist.                                           | Reuse inspection results. Add explicit selection policy rather than interpreting completion or a single aggregate as eligibility.                        |
| `src/core/processor/graph-inspection.ts`, `execution/journal.ts`                           | Existing readers observe graph binding and required lifecycle records without executing adapters.                                                                        | Application receipts correlate a decision with a Run; journal HMAC is not a portable candidate identity.                                                 |
| `src/core/processor/registry.ts`, `logs/session-logger.ts`                                 | Registry registration and optional logging are not an atomic decision store.                                                                                             | Neither an object replacement nor an optional log call proves an authorized committed selection.                                                         |

### Reproducible baseline check

On macOS arm64 / Node 26.5.0, the following existing tests passed: **113**. These test current mechanisms, not the proposed selection service.

```sh
TS_NODE_PROJECT=tsconfig.test.json ./node_modules/.bin/mocha --forbid-only --reporter dot \
  test/core/thread.test.ts test/core/processor.test.ts \
  test/core/execution/graph.test.ts 'test/core/evaluation/*.test.ts'
```

A bounded, memory-only probe compiled two single-transform Graphs. It held the old transform behind a Promise, changed a host variable to the new compiled Graph, released the old Run, then started a new Run on the same Agent/Session. It observed `old:one`, then `new:two`. Resubmitting the first request with the new Graph was rejected; using the original Graph reused the original handle without another transform. Explicitly passing the old Graph under a fresh request produced `old:three`. Exactly three transforms ran; no model or remote MCP was called. The first probe assertion incorrectly treated `handle.value()` as the payload rather than `{graph, value}`; it was corrected before the successful run. This is not a prototype selector, persistence test or evidence of a rollback API.

## External Systems Investigated

Sources were inspected on 2026-09-13 at existing research snapshots, not moving latest versions. No external test suite or application was executed.

| System                                           | Pinned primary source                                                                                                                                                                      | Observation and limited transfer                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Codex `5adb68a49933ae446bf11935662c83dba55a0804` | [tasks/mod.rs](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/core/src/tasks/mod.rs), `spawn_task`, `start_task`                                   | Task start receives an explicit `Arc<TurnContext>`. `spawn_task` first aborts existing tasks as replaced. Reuse explicit ownership/context capture as a comparison; do not copy replacement-aborts into selection of future Orbit Runs. This file does not establish an evaluated-candidate store.                 |
| Pi `b79e4cc834970cca69daebffab7df1da7d1e52c4`    | [agent-session.ts](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/src/core/agent-session.ts), `setModel`, `abort`, `waitForIdle` | `setModel` checks auth, updates model state and records a model change; global persistence is opt-in. Abort has a separate idle wait. Reuse separation of local selection, defaults and cancellation. These methods do not supply evaluation-bound CAS selection or prove the proposed in-flight Graph guarantees. |

The initial Codex monolithic-file URL was absent at this revision. The verified modular task source was retrieved separately; no conclusion relies on the missing URL.

### Reused research and contrary evidence

The [historical adaptive runtime](2026-09-02-adaptive-processor-graph-runtime.md), [bounded Graph investigation](2026-09-12-bounded-processor-graph-execution.md), [evaluation investigation](2026-09-12-workflow-evaluation-evidence.md) and [optimization-papers comparison](2026-09-02-agent-workflow-optimization-papers.md) already cover broad optimization and execution/evaluation separation. Their publication results were not remeasured here. None specifies the current request-binding and decision-store protocol, so a distinct selection investigation is warranted rather than rewriting their baselines.

An application-only implementation has lower core API cost and can fit an existing database. A fully core-owned persistent selector would give more uniform durability and provenance but expand storage, security and migration ownership. A live registry switch is simpler but cannot preserve full candidate identity, evidence or replay. These costs argue for an explicit host storage contract rather than pretending a pure reducer is durable.

## Analysis

### Candidate identity and eligibility

A candidate needs an immutable manifest: Graph descriptor identity/profile, private configuration identity, ordered/versioned adapter references, fixed-context identity, evaluation variant mapping and mapping-method version. Display names are labels. A host must retain the executable bundle and inspect the actual frozen configuration; a hash over declarations is not proof of physical isolation or code provenance.

The first scope can keep one application target/context fixed and vary only Graph-associated data. A model/Skill/catalog/policy/environment change makes the context incompatible, requiring new evidence and a separately prepared scope; do not mutate an active Agent. The existing setup must compare expected identities with its actual owned snapshots before the first visit/model/tool execution. This expectation check is a **proposed integration**, not an existing guarantee.

Selection eligibility is application policy evaluated over the existing core comparison. A conservative first policy requires every scheduled slot's reliable required checks, no disallowed outcomes/effects, comparable configurations, and complete same-slot measurements for every metric the policy requires. Metrics explicitly not required remain visibly unmeasured. Missing report or mandatory evidence is insufficient, not a success or permission for an override. There is no winner computation or automatic promotion.

### Selection, dispatch and recovery

A stable application scope has a monotonic generation. Preparing a choice binds old generation/candidate, target candidate, exact plan/report revisions, policy, context and actor authority. Committing checks them again and atomically stores the human decision and new active pointer. A stale generation or changed evidence requires a new confirmation.

Dispatch must look up `(scope, Session, requestId)` before resolving the active pointer. For a new request, a store transaction captures the chosen generation/candidate, complete submitted input, mapping and readiness policy. Later selection cannot rewrite that receipt. The existing Run path receives the frozen Graph and request; no parallel runner or fresh supervisor is introduced.

The application store and required Run journal are not one transaction. A receipt may exist without a Run; a Run may exist without a recorded reply. Recovery therefore requires read-only reconciliation, not a blind call to `startGraphRun` that could execute if no journal match is found. A terminal observation can return an historical receipt; unresolved dispatch remains blocked pending external inspection. The distinction is an unavoidable cost of the recommended boundary, not exactly-once execution.

### Storage modes and open product ownership

Recommend an explicit memory mode for a bounded lesson and a transactional-host mode for persistent application use. Memory mode provides no restart history and may not claim persistence. It starts a new scope identity after restart and never resumes old request IDs automatically. Persistent mode must atomically retain pointer, ordered decision history, request bindings and idempotency receipts, with verified commit acknowledgement and exclusive recovery. No concrete persistent backend is selected by this proposal; the application is currently unspecified. Supplying and qualifying that backend is an explicit host integration requirement and author judgment point, not a completed core feature.

A volatile store cannot stand in for a persistent scope. Ambiguous commit response freezes affected selection/new dispatch until read-only lookup and exclusive verification establish the committed state. External admission/restart shutdown remains required during unsafe maintenance. Ordinary selection affects new captures only; it does not stop in-flight work.

## Implications for Orbit

Propose reusable pure core validation plus an Application Service coordinator/store port, with explicit immutable expectations passed through the existing managed preparation. This changes public control-plane contracts and merits an ADR. Keep the nine earlier accepted reasons, shared Run/journal/transcript formats and ownership controls; do not fork budgets, authorization, Graph interpretation or evaluation.

Returning to an older candidate is a fresh authorized generation with current eligibility/availability checks. It neither undoes target edits nor deletes traces, releases quarantine, resumes interrupted nodes or grants new tool permissions. Retention of bundles, evidence and dispatch mappings is separate from Session deletion and must support safe historical inspection.

## Risks and Limitations

Host identity projection, authority and storage honesty remain trust dependencies. A memory-only lesson cannot validate durable application deployment. Snapshot equality does not establish semantic equivalence or optimal limits. Windows, representative real-model/application trials, operational restart controls and physical storage faults remain author-deferred. Backup deletion remains unauthorized. The nine existing ADRs remain accepted / partial.

## Open Questions

- Does the author accept Graph-only variation within one fixed application context for the first increment?
- Is explicit memory mode plus a required transactional-host port sufficient, leaving backend selection and durability qualification to a specified application?
- Should any unknown required evidence permit a separate exceptional workflow? The recommendation is no override in this first scope.
- Are the failure-closed dispatch gap and manual reconciliation costs acceptable without a new cross-store transaction or journal version?

## Related Decisions

The [application-owned selection ADR](../adr/2026-09-13-application-owned-workflow-selection.md) is proposed / not-started. It supersedes no accepted decision.

## References

- [Current Graph API](../processor-graphs.md)
- [Current evaluation API and trust boundary](../workflow-evaluation.md)
- [Managed Run lifecycle](../adr/2026-09-07-managed-run-lifecycle.md)
- [Managed Graph decision](../adr/2026-09-12-managed-processor-graph.md)
- [Evaluation decision](../adr/2026-09-12-evidence-based-workflow-evaluation.md)
