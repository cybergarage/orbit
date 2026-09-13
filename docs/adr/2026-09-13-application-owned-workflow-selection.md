---
status: proposed
proposed-date: 2026-09-13
decision-date: null
implementation-status: not-started
implementation-completed-date: null
implementation-commits: []
superseded-by: []
---

# Application-owned Workflow Selection

## Purpose

Allow a human to choose among finite, explicitly registered Graph candidates using existing evaluation evidence, apply that choice to future requests and later select an earlier candidate. Preserve already captured requests, Run ownership, exact replay, missing-evidence accounting and historical decisions. Do not make the model its own approver or conflate workflow rollback with undoing file edits.

## Decision

**Proposed recommendation; not accepted and not implemented.** Add pure core candidate/selection validation and a reusable Application Service coordinator with an application-owned store and authority provider. Use current Graph compilation, evaluation and managed execution. Offer an explicit nonpersistent memory profile and a transactional-host port; do not ship an unqualified persistent backend as part of this first proposal. A persistent application must supply and qualify the store described below before enabling that mode.

### Scope and responsibility

| Owner                                  | Proposed responsibility                                                                                                                                                                      | Existing mechanisms reused                                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Core, pure validation                  | Bounded candidate/selection JSON, identities, generation transitions, evidence-policy verdicts, and receipt consistency. No winner, filesystem access or callbacks in text validation.       | Evaluation parsing/digests and report inspection; existing Graph definitions are validated by their owning compiler. |
| Reusable Application Service extension | Prepare/confirm choices, capture requests, project actual prepared context, resolve registered executable bundles, reconcile observations and expose consistent library/UI results.          | `ApplicationService.startGraphRun`, `ThreadManager.startGraphRun`, ordinary resource owner and event lifecycle.      |
| Application/host                       | Human authentication/authorization, plan and policy provenance, semantic identity mapping, bundle retention, store transactions, evidence/export access and deletion, backend qualification. | Existing GUI access boundary and host configuration; no authority is inferred from model text or imported reports.   |
| Managed execution                      | One Run/turn/catalog/Skill snapshot, budget, permissions, cancellation, mandatory recording, cleanup and failure observation.                                                                | The accepted Run/Graph implementations remain the only execution path.                                               |

The selection scope is a stable host-issued ID bound to one application target and fixed runtime context, not implicitly a path string or every Session on the machine. Resumed/new Threads must be explicitly assigned to that scope. A receipt already assigned to a scope cannot be transferred to another. Ordinary explicit Graph APIs remain available outside a selection-managed scope; product routes inside the scope must not offer a bypass that silently skips selection policy.

First-scope candidates vary Graph descriptor/private node configuration and explicitly registered adapter versions. Model/options, tool and MCP configuration, ordered Skills, input policy, permissions, Run limits, workspace mapping and host environment remain fixed by the scope context. A change to those facts invalidates applicability and requires new evidence and explicit scope preparation; it does not mutate the existing Agent or its resources. No automatic migration from older transcript formats or old application processes is added.

### Candidate and evidence identities

A revision-1 candidate manifest contains a stable candidate ID, display label, immutable manifest digest, Graph descriptor identity and profile, versioned adapter references, private node-configuration identity, fixed-context identity, portable mapping-method version and retained bundle reference. Sensitive configuration and secrets remain host-owned; public manifests use opaque identities. Resolving a bundle never evaluates code embedded in JSON or fetches a package from a report URL. Only pre-registered, trusted versioned code can be resolved. Freezing data does not attest callback closures; the host must version changed behavior honestly.

Each evidence binding identifies the separately trusted plan digest, applicable variant, selected report IDs and digests with predecessor closure, candidate/configuration mapping and eligibility-policy ID/revision. Explicit mapping relates fresh evaluation targets/snapshots to runtime scope; neither journal HMAC nor public Graph digest substitutes for full configuration identity. A report revision correction requires a new binding/confirmation; previous decisions retain their original evidence. The application must mark withdrawn or known-invalid evidence unavailable for new choices and new captures, without rewriting prior decisions.

The conservative initial policy is: every scheduled slot is present, comparable, reliably graded, within permitted outcomes and free of disallowed/unknown effects or unmet required evidence. All slots must pass the case policy; expected refusals can pass only under the evaluation contract. `fail`, `indeterminate`, `not-run`, `missing`, invalid evidence and incomparable configurations prevent selection. Threshold policy is fixed before evaluation, never editable by a report. No manual override of unmet mandatory conditions is included.

For every required resource definition, require complete measurements for the same **entire planned slot set** and an explicit predeclared limit/comparison rule. Sum/mean over a subset cannot pass that requirement. Resources not required by policy remain visibly unmeasured rather than invented zero. Keep units, scope, method, source, accounting cells and rate metadata; no weighted score can offset a prohibited edit or missing evidence. Core supplies eligibility findings, not the human decision or statistical superiority claims.

### Prepare, confirm and commit

Proposed logical entry points are `inspectCandidates`, `prepareSelection`, `confirmSelection`, `startSelectedGraphRun`, `inspectSelectionHistory` and read-only reconciliation. Names and TypeScript packaging will be finalized at implementation review; the authority and ordering below are the proposed contract, not callable current APIs.

`prepareSelection` returns a bounded preview binding scope, expected generation/current candidate, target candidate digest, exact evaluation/policy/context identities, store mode, authenticated principal, authority revision, reason and expiry. Preparation is read-only with respect to the active pointer. The application presents the expected change, remaining unmeasured resources and captured requests that will keep their earlier candidate. Confirmation requires an explicit human action through the trusted host authority provider. A field such as `human: true`, an actor name in a report, or a model's response is insufficient.

`confirmSelection` revalidates authority and all bound facts, then atomically:

1. Looks up `(scope, selectionRequestId)` and compares the complete submitted confirmation; an identical committed request returns its existing receipt, a conflict rejects.
2. Checks the current scope generation/candidate, candidate availability and exact evidence/context/policy revisions against the preview.
3. Appends one immutable decision and advances the active pointer to generation `g + 1` in the same transaction. The decision stores old/new candidates, evidence, policy, principal/authority reference, reason, request digest and timestamp.
4. Publishes success only after the store acknowledges commit at its declared mode. A rejected selection does not change the pointer; rejection reasons are returned and host audit can retain them without presenting them as a committed generation.

Use generation CAS to reject concurrent stale choices, including A→B→A changes; candidate equality alone is insufficient. Returning to an earlier candidate is a fresh generation under the same rules, not deletion or rewind of history. After commit, an exact retry retrieves the receipt under current read authorization even if preview expiry has passed; expiry/revocation prevents a new commit. Do not reapply a previously committed choice merely to satisfy a retry.

### Capturing and dispatching a new request

Selection and request capture serialize through the same scope store. The cutoff is **committed request capture**, not the later first model call or Run-admitted record. A previously captured but not yet admitted request keeps its candidate when selection changes. The UI must display this state; do not describe it as newly taking the active candidate at admission.

For `(scope, Session, requestId)`, resolve an existing receipt before reading the active pointer, compiling/loading adapters, creating an Agent/model, or discovering MCP/Skills. Compare the complete caller submission (input, explicit limits/options and ordered Skills) independently from the active pointer. Return the existing live handle/observation for an identical request; reject conflicting input. Retained request mappings must not be silently evicted into new work.

For a fresh request, a transaction captures the then-current generation, candidate, evidence/policy/context references, complete submitted input and its canonical digest, plus a stable dispatch receipt ID. No implicit queue is introduced. The coordinator checks the target's ordinary availability first, but downstream busy/quarantined admission may still reject; record that observation without choosing another candidate. Later retries of an unresolved dispatch do not recapture current selection.

After acknowledged capture, use the trusted retained bundle and existing `startGraphRun` path. Add immutable selection expectations/receipt binding to the **submitted** managed options so replay covers them; do not place them only in unexamined ambient configuration. Extend Thread/Application/Agent forwarding consistently. The optional integration applies to selected calls; unchanged explicit Graph and ordinary Agent calls retain their existing contracts.

The expected-context check reuses the already owned preparation snapshots, before `run-ready` and before any Graph visit/model request/tool effect. It compares the actual frozen context, catalog and ordered Skill snapshot using a registered, versioned, side-effect-free host identity projector. No second discovery/read, nested Run, model loop or permission store is created. Initialization remains owned, budgeted and cancellable by the existing Run. Mismatch fails the Run through current terminal/cleanup paths and starts no visit. A preflight declaration alone cannot prove this check. Projector honesty remains host trust, not cryptographic attestation.

Existing journal v1/v2 and transcript v2 formats remain unchanged. Their input/configuration digests bind the supplied options; Graph records retain descriptor/path and lifecycle facts. The **application receipt** supplies the readable decision/generation-to-Run association. It stores Session/request IDs before dispatch and adds observed Run ID/original terminal later. This association is host-trusted, not a new signed journal record. Older product processes must be stopped or kept outside selected scopes; reject unsupported selection protocol at product entry instead of silently dropping expectations.

### Storage modes and crash boundaries

`memory` is an explicitly nondurable profile for a single-process lesson. It retains decisions/requests only for that process, declares loss on shutdown, starts a fresh scope identity after restart and cannot resume the previous scope's requests. It does not claim the same guarantees as persistent Session/journal storage. A product configured for persistence must refuse a memory store.

`transactional-host` requires a host-provided store that supports atomic CAS transactions, immutable decision/candidate/evidence history, unique request IDs, exact retry receipts, consistent reads and acknowledged durability under its declared storage level. The store must validate schema/continuity and distinguish absent data, unavailable reads, corruption and ambiguous acknowledgement. A store adapter's atomicity/durability claim requires its own conformance and interruption tests; implementing an interface or passing a memory double is not that proof. No default file log, SQLite dependency or copied Session lock/registration implementation is selected here. Qualifying a concrete backend waits for the target application; this limitation requires author acceptance.

| Interruption or failure                                             | Required interpretation and restart condition                                                                                                                                                                                     |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before selection/capture transaction commits                        | No pointer/receipt transition if rollback is verified; a read error is not proof of absence. Re-prepare only after authoritative state is readable.                                                                               |
| Commit succeeds but acknowledgement is lost                         | Mark affected scope unavailable for fresh capture/selection in the uncertain process; lookup by idempotency ID and verify state/durability exclusively. Do not append a second generation or dispatch on guessed success.         |
| Capture commits before Graph admission                              | Receipt is durable intent, not proof that a Run exists or did not run. Inspect existing journal through authorized readers. No automatic dispatch on restart.                                                                     |
| Run admission/effect occurs before application records Run ID/reply | Match retained Session/request and submitted digest to existing journal. Preserve original terminal/unknown ownership. Missing or unreadable journal requires external reconciliation; never call start as a mere existence test. |
| Process dies with an unresolved Run                                 | Existing owner/registration/reconciliation rules apply. Selection cannot close its resources, clear quarantine or start a replacement automatically.                                                                              |
| Journal evidence is deleted or candidate bundle becomes unavailable | Keep receipt/tombstone and mark historical verification unavailable. Block unresolved replay and incompatible new capture rather than substitute the current candidate.                                                           |
| Application store recovery/maintenance                              | Stop external selection/dispatch and automatic restart sources, exclude concurrent writers/read-modify-write clients, verify state and resynchronize according to the chosen backend. Do not infer safety from a timeout.         |

There is no cross-store transaction with the required Run journal and no exactly-once effects claim. A live coordinator can finish its originally owned dispatch after capture; a restarted coordinator cannot infer permission to do so from an unresolved receipt. Recovery is observational. A new explicit execution request after human reconciliation is distinct from retrying an uncertain request.

### Retention, rollback and bounds

Keep every active candidate, retained rollback target, decision's evidence references and unresolved dispatch binding available. A host may later remove payloads under an authorized retention policy, but retain minimal identity/tombstone data so absence never means a reusable request ID. Report export/retention remains application-owned; Session deletion and exclusive maintenance services keep their existing scope. This proposal grants no backup deletion or implicit report/transcript export permission.

Rollback rechecks current availability, authority, compatibility and evidence policy for the older candidate. An unavailable adapter or known-invalid evaluation blocks it. In-flight and captured requests retain their original choice and normal stop controls. Rollback never performs `git reset`, restores files, cancels Runs, releases leases or deletes journals as a side effect.

Use bounded revision-1 JSON text at pure/public serialized boundaries. Initial proposed creation limits are 64 candidates per scope, 64 KiB manifest/selection metadata, and 1,000 retained decisions/dispatch receipts per memory scope; stop new writes at capacity, do not silently prune idempotency/history. Persistent backends may page retained history but must prove complete continuity where needed. Graph and evaluation input limits are still checked by their existing validators; large raw evaluation evidence is passed separately under evaluation limits, not squeezed into the metadata cap. Unknown complete revisions fail explicitly; malformed/torn persistent input is not repaired by the coordinator. Preserve valid historical reader ceilings when reducing producer limits. These are unmeasured starting profiles to be tested, not optimal capacities.

## Consequences

- **Positive:** selection remains a human-authorized, evidence-bound application operation; existing Graph/Run/evaluation behavior is reused. Captured work cannot silently change candidates when the active pointer changes.
- **Positive:** CAS generations and exact request receipts distinguish concurrent choices, retries, observation and rollback without copying tool approval or execution state machines.
- **Negative:** applications must supply honest identity projection, authority, artifact/evidence retention and a qualified transactional store for persistence. The memory lesson cannot demonstrate durable deployment.
- **Negative:** dispatch and Run journal commits have a failure gap; uncertain work requires explicit observation/reconciliation, not automatic restart. Required-resource missingness may prevent selection despite apparent quality gains.
- **Neutral:** a valid Graph, a passing evaluation and a committed human selection are three different facts. No optimization, candidate generation, automatic winner, canary or file undo is added.

## Context and Problem Statement

The inspected Orbit baseline is `a8947960b1dcdc14625c3b18ef337bad4423e468`, after Graph and evaluation implementation; public main is `1cb6f4f2abe3e89e27c1bdb32f1049183ef0e960`. A17's earlier `8ee97144c20b006225db52efc482004200527e4c` baseline predates per-Run Graph entry and evaluation. Its assumption that existing Threads cannot take another Graph is no longer current.

Source inspection and a bounded probe establish that old/new compiled Graphs can run on the same Agent/Session, an old running transform retains its original binding, changed-Graph replay rejects and original replay reuses the handle. Current application/thread/Agent entry points do not provide candidate stores, evaluation-bound human choice, generations or persistent dispatch receipts. Evaluation `selected` only identifies report revisions. Registry lookup and optional logs do not fill these gaps.

This ADR extends application control contracts and optionally adds prepared-expectation checking. It supersedes none of the nine accepted/partial ADRs and does not re-adopt their reasons. It adds no mandatory journal/transcript record kind, alternative authorization engine, resource owner or compaction/Skill pipeline. The research is [Human-selected Workflow Candidates](../research/2026-09-13-human-selected-workflow-candidates.md).

## Decision Drivers

- Preserve the actual evaluation denominator, evidence trust and missing-resource semantics.
- Bind explicit human authority to exactly the candidate/evidence/context reviewed.
- Preserve future-request selection and full-input replay under concurrent changes and restart.
- Keep deployment storage and grading policy with the application; no unnecessary native dependency.
- Provide an understandable bounded chapter example without pretending to deliver the finished application.

## External Implementation Research

Inspected on 2026-09-13; neither external suite was run.

- Codex at `5adb68a49933ae446bf11935662c83dba55a0804`, [tasks/mod.rs](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/core/src/tasks/mod.rs), receives an explicit turn context and aborts replaced tasks before spawning. Transfer context ownership; reject replacement-aborts as the semantics of selecting a future Orbit candidate.
- Pi at `b79e4cc834970cca69daebffab7df1da7d1e52c4`, [agent-session.ts](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/src/core/agent-session.ts), separates model change recording, optional global defaults and abort/idle waiting. Transfer explicit scope/history, not direct mutable model assignment as proof of evaluation-bound selection.

The existing optimization and Graph research supplies directional context only; no reported benchmark gain is imported as selection evidence.

## Considered Options

| Option                                                   | Benefit                                                             | Cost and disposition                                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Application-only ad hoc pointer/log                      | Minimal shared API and fits existing products                       | Repeated validation/replay mistakes across surfaces; insufficient as the recommended common contract.                       |
| Fully core-owned persistent selector and storage         | Uniform durability and stronger integrated provenance               | Adds storage/platform/authority ownership and migration burden before an application is fixed; not recommended now.         |
| Pure core validation plus Application Service/store port | Shared invariants, explicit host responsibility, existing Run reuse | Requires qualified host persistence and leaves an observable dispatch gap; recommended.                                     |
| Live registry/Agent mutation                             | Small apparent implementation                                       | Cannot preserve in-flight bindings, evidence identity or replay; rejected as a proposal.                                    |
| New journal version binding every selection record       | More self-contained durable provenance                              | Couples product policy/history to execution format and older readers; unnecessary for the first host-trusted receipt model. |

Within the recommended option, memory-only delivery is insufficient for durable claims; a required built-in database would increase scope and dependency cost. Recommend explicit memory and transactional-host modes with the qualification boundary above. This is an author decision, not an implicit approval of any backend.

## Implementation and Confirmation

No implementation has begun. Intended work is pure public types/validators, Application Service coordinator and store/authority ports, a clearly labeled memory reference store, expectation forwarding/checking in existing owned preparation, and consistent trusted product entry/inspection. Any future persistent host adapter needs separate concrete conformance evidence before enabling its mode. No finished application or chapter body is part of this proposal task.

| Confirmation             | Required test/evidence                                                                                                                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Candidate identity       | Edited graph/private config/adapter version changes digest; changed closure under same version remains explicitly host-trust violation; unknown bundle and arbitrary serialized code reject.                                        |
| Evidence eligibility     | Missing plan/report/slot, required resource, invalid verifier, incomparable configuration, subset-only metrics and corrected/withdrawn evidence cannot approve. Optional unmeasured metrics remain visible.                         |
| Human authority          | Forged actor/report flag, tool-origin confirmation, revoked principal and expired preview reject; exact committed retry uses read authority and creates no new decision.                                                            |
| CAS selection            | Two choices from one generation produce one commit; A→B→A still invalidates a stale preview. Pointer and decision never commit separately.                                                                                          |
| Scope/context            | Same target alias does not create accidental scope equality; incompatible model/catalog/Skill/policy blocks. Session resume requires explicit scope assignment.                                                                     |
| Preparation expectation  | Actual prepared catalog/Skill/context mismatch starts no visit/model/tool; initialization and projector failure/cancellation retain current ownership and recording rules. No second discovery.                                     |
| Active/captured requests | Hold old work while committing new selection; old captured request stays old, capture after commit uses new. Same-Session next Run reuses existing Agent ownership.                                                                 |
| Replay                   | All library/service/UI entries compare the full submission before active resolution or factories. Changed input rejects; exact retry reuses receipt. Restart does not dispatch as an existence check.                               |
| Storage and interruption | Faults before/after transaction, acknowledgement loss, capture/admission/reply gaps, concurrent owners, corruption and capacity. Memory tests prove only memory; each persistent adapter must prove its actual declared durability. |
| Original results         | Failure/cancel/unknown/recording failure and later settlement keep original terminal; rollback does not clear quarantine or repeat effects.                                                                                         |
| Retention/deletion       | Active/unresolved references protected; missing payloads retain tombstones, never recycle request IDs. Existing Session deletion and maintenance unchanged.                                                                         |
| Product surfaces         | Preview generation/candidate/evidence, scope/mode, outstanding captures and commit status agree across library/CLI/GUI; disconnected acknowledgement remains uncertain.                                                             |
| Compatibility/bounds     | Unknown revision/fields, malformed JSON, oversized metadata/evaluation and historical limits; unsupported old product entry rejects selected mode. No new journal version.                                                          |
| Verification             | Existing targeted suites plus headers:check/build/test on Unix for future implementation. Fixed doubles are not real-model quality or optimal limits.                                                                               |

Proposal-time evidence: the existing Thread, Processor, Graph and evaluation suites passed **113 tests** on macOS arm64 / Node 26.5.0. The current-API probe produced old/new/old values and exact replay behavior with three transforms. This is baseline evidence, not confirmation of any new row above. Markdown formatting, metadata, links and unchanged accepted ADRs are checked separately.

## Follow-up Work

Author judgment is required for (1) Graph-only variation within a fixed context, (2) explicit memory plus a transactional-host port with no supplied persistent backend, (3) conservative eligibility without mandatory-evidence override, (4) capture as the selection cutoff, and (5) host-trusted receipts and manual reconciliation of cross-store ambiguity without a new journal version. Review these choices before adoption or implementation.

Specify a real application's backend, authority and retention policy before claiming persistent selection. Windows, representative real-model/application trials, operational restart controls and physical storage fault qualification retain their existing deferred status and restart conditions. The nine existing ADRs stay accepted / partial. Backup deletion is still awaiting an answer; this proposal grants no deletion permission. Input-budget delegation and Skill/Graph/evaluation acceptance do not authorize this decision.

## References

- [Selection research and pinned evidence](../research/2026-09-13-human-selected-workflow-candidates.md)
- [Graph API](../processor-graphs.md)
- [Evaluation API](../workflow-evaluation.md)
- [Managed Run lifecycle](2026-09-07-managed-run-lifecycle.md)
- [Prepared operation authorization](2026-09-07-prepared-operation-authorization.md)
- [Required execution journal](2026-09-07-required-execution-journal.md)
- [Storage registration guard](2026-09-08-session-storage-registration-guard.md)
- [Managed Graph](2026-09-12-managed-processor-graph.md)
- [Evidence-based evaluation](2026-09-12-evidence-based-workflow-evaluation.md)
