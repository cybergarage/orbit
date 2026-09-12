---
status: proposed
proposed-date: 2026-09-12
decision-date: null
implementation-status: not-started
implementation-completed-date: null
implementation-commits: []
superseded-by: []
---

# Evidence-based Workflow Evaluation

## Purpose

Compare outcomes and resources for the same versioned tasks without equating a completed Run, passing core tests or missing telemetry with successful application work. Preserve failed, cancelled, unknown and unexecuted trials in the comparison. The first application is a coding agent; the contract must also work for an ordinary Agent and a bounded Graph.

## Decision

**Proposed, not accepted.** Add a bounded, read-only evaluation evidence contract and pure validation/comparison functions to Orbit core. Applications define cases and trusted graders, provision isolated targets, run trials through the existing managed APIs and persist reports. Core checks supplied evidence and computes transparent counts; it does not execute trials or decide a task's expected behavior.

This is one decision about the first shared evaluation contract. Illustrative names `validateEvaluationPlan`, `inspectEvaluationEvidence` and `compareEvaluationReports` are proposed public APIs, not existing exports. They accept finite JSON and supplied evidence, return structured validation/comparison results and have no filesystem, network, model, tool, arbitrary callback or automatic replay effects. Loading evidence through existing authorized readers remains the host's responsibility. No second supervisor, scheduler, required journal revision, transcript revision, provider telemetry expansion, pricing lookup, ranking or candidate selection is included.

### Plan, identity and comparison

Freeze a plan before dispatch. It identifies the suite/cases and grader revisions, initial target fixture, declared variants and every ordered `(case, variant, repetition)` slot. Each case declares required checks, permitted runtime outcomes and forbidden changes; expected refusal is specified before execution, never inferred after failure. Keep development and held-out case roles explicit. A variant is a configuration under comparison, not a proposed production replacement.

In the initial contract, one attempt is one managed Run, ordinary Agent or Graph, against a fresh target and Session/journal pair. Multi-Run tasks are unsupported rather than silently merged. A retry is a new predeclared repetition; resubmitting the same request ID is the same attempt. Trial collectors must not invoke the runtime to repair missing evidence or count live/recovered handles as two samples. Admission rejection has an attempt row with no Run ID. A slot with no report remains `missing` with dispatch/execution unknown. Use `not-run` only when authoritative host evidence confirms it was never dispatched; report loss does not establish non-execution.

Record intended and resolved conditions: application/Orbit revision, target fixture and dependency lock, model/provider/options, Graph identity and submitted-configuration binding when applicable, tool catalog, ordered Skill selection/snapshot identity, input profile, Run limits, authorization policy and execution environment. Enumerate intended comparison dimensions; drift in another required condition makes the affected comparison incomparable. Unknown actual model/catalog/Skill identity is missing evidence, not an assumed match. Freeze any human approval protocol; a human decision remains an observed input, not repeatable model behavior.

A keyed Graph digest identifies a binding; it does not reconstruct private configuration. Use opaque host-issued identities or private authorized fingerprints for sensitive inputs. Public reports must not require raw credentials, private instructions or guessable secret hashes. Core verifies declared equality/structure, not that a host's identity claim is truthful. Resolved metadata must be linked to the same attempt, Session and Run using the existing evidence identities.

Stable report/attempt IDs and canonical content digests make identical imports idempotent. Conflicting content for the same ID is an error, never last-writer-wins. Revisions are new immutable report IDs with an explicit predecessor; comparison selects one revision, not multiple counts for the same slot. A sealed report lists every planned slot, materializing missing ones; the application's unfinished collection ledger is not a sealed success report. Unexpected/duplicate slots, undeclared repetitions and incompatible plan fingerprints are rejected. Unknown configuration fields must be rejected or explicitly versioned rather than silently omitted from fingerprints.

### Evidence and verdicts

Keep four axes separate: runtime outcome/stop reason, evidence validity/completeness, per-check quality, and metric availability. Preserve operation status, quiescence, recording status and unresolved ownership from `RunResult`. Inspect supplied journal and transcript through existing validators; retain invalid-prefix and missing-transcript findings. A structural digest match alone does not prove artifact provenance or correctness.

| Observed condition                                                                                                        | Required accounting                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Confirmed completion with artifact/check evidence                                                                         | Grade the case; completion alone is not a pass.                                                                                                                                   |
| Declared failure, admission refusal, cancellation or budget exhaustion                                                    | Keep the runtime category and planned denominator. A predeclared expected-refusal/stop case can pass only with the required behavior/effect checks and confirmed quiescence.      |
| Unknown operation effect, unresolved resource, uncertain termination                                                      | Keep the attempt as runtime incomplete and quality indeterminate unless a trusted check already proves failure. Do not grade a mutable target while candidate work may still run. |
| Required journal failure, invalid record prefix, transcript mismatch, lost required artifact or missing terminal evidence | Keep a required-evidence issue. Do not report an overall pass, even if a subset of target tests passed.                                                                           |
| Grader exception, timeout, cancellation or missing output                                                                 | The affected check is indeterminate with a grader-error reason; it is not a demonstrated defect in the candidate. Bound and own grader work separately.                           |
| Known required-check violation plus another unknown check                                                                 | Overall quality is fail; retain the unknown evidence/check flags rather than claiming complete evaluation.                                                                        |
| No attempt report                                                                                                         | Keep missing in the planned-slot denominator with dispatch unknown. Confirmed non-dispatch is separately not-run. Do not invent failure cause or measured zero resources.         |

An overall pass requires all required checks to pass, a permitted runtime outcome, required evidence that validates and confirmed quiescence. Otherwise a decisive valid required-check failure yields fail; without one, uncertainty yields indeterminate. An observed, disallowed runtime outcome is a failed predeclared check only when its evidence is reliable. Merely demonstrating that unknown-result handling worked may pass that specific test, but does not turn an unresolved task into an overall pass. Invalid evidence cannot supply a decisive trusted check.

Recovery itself is neither a quality failure nor confirmation: retained acknowledged terminal evidence can validate, but reconstructed values and placeholder counters cannot replace lost evidence. Report supplied versus validated versus missing evidence explicitly. Confirmed pre-admission refusal requires authoritative admission evidence and confirmation that no resources were acquired; do not fabricate a RunResult when no Run exists. A host claiming a check passed must identify its grader revision, artifact identity, result and observation scope. Independent expected results and grading code live outside the candidate's write authority. Model self-assessment and a candidate-modified test suite are not independent checks.

### Resource metrics

Every metric carries a unit, scope, method revision, provenance/source IDs and coverage (`complete`, `partial`, `unavailable`, `not-applicable`) with a reason. A value is present only when observed; zero is not the default for missing fields. A partial value states whether it is a lower bound. Unavailable/not-applicable carry no numerical value. Compare or aggregate only matching units, scopes and methods; expose measured sample counts alongside planned counts and refuse incompatible aggregation.

- Consumed `modelCalls`, `toolRequests` and `toolRounds` allowances are not SDK transport attempts or successful effects. A terminal live snapshot can report those counters when its provenance confirms final capture. The recovered snapshot's zero counters are unavailable historical usage. Graph visit-start counters are prefixes, not final totals.
- Normal model requests and summary requests share model allowance. Successful compaction `summaryUsage` is not a census of all summary attempts. Provider input/output/cache/reasoning fields are optional and may overlap. Preserve provider/model/method semantics; do not sum cache or reasoning subsets twice or treat an absent breakdown as zero.
- Optional diagnostics may be off, evicted or lost before persistence. Never infer a complete total from the absence of events. Deduplicate by stable IDs scoped to their source; text equality or equal timestamps are not event identity. Evidence without sufficient identity cannot establish a deduplicated complete total.
- The application measures elapsed time with a monotonic clock from attempt dispatch through confirmed quiescence. Preparation and grading intervals are separately labeled, and model request duration is not total latency. Unfinished intervals are right-censored lower bounds. Approval wait is included; subtract it only when separately and completely measured. Journal wall-clock timestamps alone do not establish monotonic elapsed time across restart.
- Estimated cost requires an explicit dated rate source, currency, model/version and nonoverlapping billing categories. Otherwise it is unavailable. Label an estimate separately from an invoice; this proposal adds neither a price service nor a claim about current prices.

Comparison returns per-slot rows, runtime/evidence/quality counts and compatible metric summaries with coverage. The default quality pass fraction is `confirmed passes / all planned slots`, accompanied by fail, indeterminate, confirmed not-run and missing-report counts. Do not silently filter to completed attempts. For example, two passes, one fail, one unknown attempt and one missing slot yield 2/5, not 2/3; runtime categories remain independently visible. Do not produce an overall weighted score, winner or adoption recommendation. Repeated trials support inspection of variability; no significance or population-quality claim follows from the arithmetic alone.

### Application and core responsibilities

| Application                                                                                | Core                                                                                                             |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Supply case oracles, change-scope checks, immutable grader identity and permitted outcomes | Validate plan/report structure and retain check/evidence distinctions                                            |
| Provision isolated targets, OS/network controls and fresh registered Session/journal roots | Continue existing storage registration, Run ownership, budgets and authorization without a second execution path |
| Invoke existing Agent/Graph services; control bounded graders after quiescence             | Read supplied evidence through existing validators without invoking adapters, tools or graders                   |
| Resolve authorized artifacts and capture measurements with provenance                      | Detect identity conflicts, missing slots, incompatible metrics and evidence issues; compute itemized counts      |
| Choose report storage, access, retention, redaction and deletion                           | Validate the immutable interchange format; never open embedded paths or authorize from a digest                  |

A copied directory alone is not an OS/network sandbox. Candidate processes must not modify the grader or target during grading. A grader invoking tools must use the applicable managed operation/ownership conditions; an evaluation label grants no exemption. An application test checks these orchestration conditions, a target test checks the edited project, and Orbit tests check core. Real-model task quality requires separate versioned cases and actual runs; fixed doubles do not establish it.

Reports are application-owned exports, not new Session records. Existing deletion/maintenance services retain their adopted scope and minimal deletion records. Deleting a Session does not automatically erase an exported report, nor authorize retaining full transcripts in it. Report producers must define export consent, access and retention, minimize sensitive data and handle removed artifacts as unavailable. Imports must not recreate deleted Sessions, restore backups or follow artifact paths automatically.

### Format and initial bounds

Use an independently versioned evaluation report format, initially revision 1. Strictly validate enums, finite numbers, IDs, unique slots, bounds and canonical content. Canonicalization sorts object keys but preserves array order and rejects non-JSON values; a format/method revision change cannot silently reuse an old identity. Newer unknown revisions are rejected explicitly. Existing journal v1/v2 and transcript v2 readers/writers remain unchanged; migration/stopping old processes remains necessary only under their existing contracts.

Proposed initial product limits are 16 MiB UTF-8 serialized report/plan-evidence bundle, 1,000 planned slots per comparison, 64 checks and 64 metric entries per attempt, 2,048 UTF-8 bytes per ordinary metadata string, JSON nesting depth 32 and 200,000 total JSON values. They bound synchronous validation rather than assert an optimal experiment size. Large transcripts/artifacts remain external; hosts extract bounded verified evidence and references, without treating omitted material as complete. Compatibility is tied to the revision-1 ceilings: reducing a product's creation limits must not reject earlier valid revision-1 reports on read. Raising format ceilings requires an explicit revision. Test both limits and actual small coding-agent case profiles after adoption; these values are unmeasured starting points.

## Consequences

- Positive: shared denominator and missing-evidence semantics prevent accidental success-only comparisons across CLI/library applications and ordinary/Graph trials.
- Positive: pure inspection reuses existing execution contracts without widening tool authority or storage formats.
- Negative: applications must still provide trusted graders, isolation, measurement collection and report lifecycle. Core validation cannot certify those host claims.
- Negative: historical cost, complete token totals and elapsed time can remain unavailable. A fuller measurement contract would need separate evidence and design rather than fabricated totals.
- Neutral: optional immutable reports add a public compatibility obligation, but do not change mandatory runtime recording. A report records comparison facts and does not select or promote a workflow.

## Context and Problem Statement

At `3505ec80d043cc3dfa84a9ea60d7bb7308e73862`, bounded Graphs and the seven preceding managed contracts are implemented with outstanding confirmation, unlike the book A16 baseline `8ee97144c20b006225db52efc482004200527e4c`. `RunResult` retains outcomes/ownership/recording, `graph-inspection.ts` validates paths and transcript links, and `ModelTokenUsage` has optional breakdowns. None defines a task grader or comparable evaluation report.

`recoveredRunSnapshot` initializes allowance counters to zero; terminal journal data lacks final budget/usage. Graph start counters precede visits. `DiagnosticEventBus` can be off or bounded, and normalized `LogUsage` is narrower than model metadata. Therefore current durable evidence does not support unconditional historical totals. The [research note](../research/2026-09-12-workflow-evaluation-evidence.md) gives source symbols, baseline deltas, external evidence and an executed missing-evidence probe.

The existing optimization-papers research supplies background on evaluation versus optimization; it is not an adopted evaluation API. This proposal reuses it without another paper survey or measured improvement claim. Existing eight ADRs remain accepted/partial, with their rationale, ownership, reader compatibility and confirmation requirements intact. None is superseded, and no acceptance of input budgets, Skill or Graph authorizes this proposal.

## Decision Drivers

- Compare the same declared tasks and preserve every planned trial, including failed admission and missing data.
- Separate correctness checks from execution completion and resource measurements.
- Reuse common managed execution, permits, budgets, persistence and interruption observation.
- Make incomplete historical evidence explicit without immediately changing the required journal.
- Keep trusted grading and environment policy with the application that understands the task.
- Support a small coding-agent example before broader evaluation or candidate-selection systems.

## External Implementation Research

Inspected on 2026-09-12: Codex `5adb68a49933ae446bf11935662c83dba55a0804`, [exec_events.rs](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/exec/src/exec_events.rs), separates completion, command status and usage. Pi `b79e4cc834970cca69daebffab7df1da7d1e52c4`, [types.ts](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/ai/src/types.ts), separates usage and stop/error states and identifies overlapping token breakdowns. Reuse these distinctions, not external types as proof of Orbit's complete measurement or task quality. External runtimes and benchmarks were not executed; the research records applicability and contrary evidence.

## Considered Options

| Option                                                                    | Benefit                                                             | Cost and recommendation                                                                                                                       |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Application-only harness and ad hoc reports                               | No new core API; domain freedom                                     | Repeated accounting/compatibility rules and inconsistent missing-slot handling. Viable if only one private application is intended.           |
| Shared pure evidence/report contract; application execution and grading   | Consistent comparison with bounded core scope and unchanged runtime | Host integration and partial metrics remain. **Recommended for author review.**                                                               |
| Full core experiment runner, grader plugins and mandatory final telemetry | Could standardize collection and timing more strongly               | New execution/authority/storage obligations and wider migration. Defer; no evidence here justifies this expansion for the first book example. |

Within the recommended option, accepting explicit unavailable historical metrics is preferred to adding a new journal version now. If complete post-crash counters or costs become mandatory, investigate collection/finalization separately; do not mark this contract as already providing them.

## Implementation and Confirmation

Implementation is **not started**. No evaluation API, grader, report schema implementation or chapter example accompanies this proposal. Existing-source tests establish its prerequisites only. A future implementation must include deliberate exports, types, current feature/architecture documentation, format migration notes and deterministic tests before the ADR can be recorded as implemented.

| Confirmation area            | Required evidence after adoption                                                                                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Accounting                   | Table-driven planned-slot examples across every runtime category, admission refusal, missing report versus confirmed non-dispatch, known fail plus unknown check, expected cancellation and invalid evidence; exact denominator/count assertions |
| Identity and fairness        | Same ID same bytes idempotent; conflicting report/Run bindings rejected; replay is not a repetition; undeclared config/model/catalog/Skill/target/grader drift yields incomparable; only selected report revision counts                         |
| Ordinary Agent and Graph     | Both use existing execution; terminal and interrupted/recovered evidence checked; no adapter/model/MCP/Skill work on report import; Graph digest does not stand in for artifact value                                                            |
| Ownership and graders        | Unresolved/late candidate work prevents grading; bounded grader failure/timeout distinguished from task failure; an extra forbidden file edit fails independent checks even when target tests pass                                               |
| Evidence integrity           | Required recording failure, invalid complete records, torn suffix, transcript mismatch, absent terminal and changed/missing artifact; preserve reader findings without truncation repair or automatic resume                                     |
| Metrics                      | Live-final versus recovered zero, visit-prefix versus totals, optional events off/evicted, duplicate event IDs, normal/summary scope, overlapping tokens, unavailable prices, censored time and incomplete approval timing                       |
| Resource aggregation         | Compatible units/scope/method only, no sums of unavailable values, no complete labels on partial coverage, sample counts visible; no weighted winner or promotion                                                                                |
| Format and limits            | Revision mismatch, JSON/nonfinite/depth/byte/value-count bounds, exact boundary and over-boundary inputs, product-limit reduction still reads valid older reports, deterministic canonicalization and mutation isolation                         |
| Effect-free core and storage | Filesystem/network/model/tool spies remain unused; embedded paths cannot load artifacts; Session deletion/maintenance unchanged; application export retention documented and missing exports do not recreate data                                |
| Unix and task quality        | Targeted checks plus headers:check/build/test on available Unix; fixed-double correctness separated from real-model case trials and their environment/configuration; timeout alone never counts as success                                       |

Before acceptance the author should judge: (1) shared pure contract versus application-only reporting; (2) unavailable historical resources versus a wider telemetry design; (3) application costs for independent graders/isolation/export lifecycle; (4) planned-denominator, expected-stop and indeterminate rules; and (5) the initial bounded profile and its compatibility cost. These are proposed choices, not inherited approvals.

## Follow-up Work

Review and explicitly decide this proposal before implementation. Then implement/verify only the accepted scope, record full source hashes in a later ADR evidence commit and produce chapter 16 after source/example verification. Do not infer measured model quality or optimal limits from deterministic tests.

All eight existing partial decisions retain their remaining confirmation. Windows, representative application/model trials, operational restart controls and physical storage faults remain author-deferred pending environment/application/SLI/SLO definition. The bounded managed MCP schema work already verified for coding-agent tools is preserved without claiming Everything-wide support. Backup deletion remains unauthorized. Candidate selection, autonomous generation/promotion and the finished application are outside this decision.

## References

- [Workflow evaluation investigation](../research/2026-09-12-workflow-evaluation-evidence.md)
- [Optimization papers investigation](../research/2026-09-02-agent-workflow-optimization-papers.md)
- [Managed Run lifecycle](2026-09-07-managed-run-lifecycle.md)
- [Prepared operation authorization](2026-09-07-prepared-operation-authorization.md)
- [Required execution journal](2026-09-07-required-execution-journal.md)
- [Writer recovery](2026-09-08-session-writer-recovery-guard.md)
- [Storage registration](2026-09-08-session-storage-registration-guard.md)
- [Budgeted compaction](2026-09-08-budgeted-session-compaction.md)
- [Run-scoped Skills](2026-09-09-run-scoped-skill-selection.md)
- [Managed Processor Graph](2026-09-12-managed-processor-graph.md)
