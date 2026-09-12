---
status: current
investigation-date: 2026-09-12
orbit-commit: 3505ec80d043cc3dfa84a9ea60d7bb7308e73862
related-adrs:
  - docs/adr/2026-09-12-evidence-based-workflow-evaluation.md
superseded-by: []
---

# Workflow Evaluation Evidence and Comparable Trials

## Purpose

Establish which current Orbit evidence can support a comparison of the same tasks under different application configurations, without interpreting runtime completion as task correctness. The recommended first increment is a bounded, read-only evaluation contract and comparison library. Applications own trial execution, isolated targets, independent graders and report storage. This is a non-binding investigation, not approval of evaluation or candidate selection.

## Research Questions

1. What changed since the book's A16 baseline, and what is still absent?
2. Which execution, artifact and resource facts remain available after restart?
3. How should rejection, cancellation, unknown effects, grader errors and missing evidence affect denominators?
4. What belongs in core rather than a coding-agent application's test harness?

## Findings

- Managed Runs, authorization, durable registration, budgeted compaction, explicit Skills and bounded Graphs now exist. Their eight accepted/partial ADRs are prerequisites, not an approval of evaluation.
- A Graph inspection validates execution structure and transcript references. It does not grade the task or reproduce an output from its keyed digest.
- Current evidence cannot produce universally complete cost or timing totals. A recovered snapshot's zero budget counters are placeholders, not measured zero consumption. Terminal journal records do not contain final budget counters or usage.
- A fixed plan of trial slots, separately graded checks, explicit evidence availability and metric provenance can prevent silent removal of failed/missing cases. It cannot prove that an application supplied honest evidence or that a grader captures all requirements.
- No distinct evaluation ADR, dataset/report API or common comparison implementation was found in the inspected `src/core`, `test/core` and ADR index. Existing optimization research is reusable context, not an equivalent implemented contract.

## Orbit Baseline

The local checkout is `3505ec80d043cc3dfa84a9ea60d7bb7308e73862`, clean before this work. Public `main` was checked with `git ls-remote` and remains `b2b8f445a4284c14f787ed80a895c8342ae1ea71`; the local Graph implementation has not been assumed published. Paths below refer to the local baseline. The original book A16 inspected `8ee97144c20b006225db52efc482004200527e4c` on 2026-09-07. Diff inspection covers source/tests/research/ADRs between those revisions; no changes followed the Graph implementation record.

| Source and symbols inspected                                                                                                                                           | Current fact                                                                                                                                                                             | Evaluation implication                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/execution/run.ts`: `RunResult`, `RunSnapshot`, `RunSupervisor`, `recoveredRunSnapshot`                                                                       | Outcome, quiescence, operation statuses, recording and unresolved ownership are distinct. Live snapshots carry consumed allowances; recovered snapshots initialize the counters to zero. | Preserve all result axes. Do not copy recovered zeros as historical measurements.                                                                                |
| `src/core/execution/journal.ts`, `run.ts` terminal append                                                                                                              | The closed journal records necessary lifecycle evidence; ordinary terminal data has no final budget or usage.                                                                            | An evaluation extension cannot pretend absent fields are measured. No new mandatory journal format is needed for a first incomplete-but-explicit report.         |
| `src/core/processor/graph-execution.ts`, `graph-inspection.ts`, `execution/graph-journal.ts`                                                                           | Version 2 identifies Graph/visits/edges, checks prefixes and transcript high-water references. Graph values publish only after confirmed completion.                                     | Correlate trial to one Run, graph binding and transcript; digest-only recovery does not recreate the graded artifact. Visit-start counters are not final totals. |
| `src/core/agent.ts`, `session/context-policy.ts`, `compaction.ts`                                                                                                      | Agent stages share the loop and counters. Summaries consume model allowance. Successful compaction records may retain `summaryUsage`; failed attempts need not.                          | Count normal and summary scope separately when observable. A stored summary count alone does not establish all summary attempts.                                 |
| `src/core/models/model.ts`, `models/adapters/openai.ts`                                                                                                                | `ModelTokenUsage` includes optional input/output/total, cached/cache-creation input and reasoning. OpenAI maps provider breakdowns when present.                                         | A16's narrow `LogUsage` observation is not the whole current model contract. Cache/reasoning may overlap base counts; do not add every field together.           |
| `src/core/logs/records.ts`, `diagnostics/diagnostics.ts`                                                                                                               | Normalized log usage is narrower; optional events can be disabled or evicted, with isolated listeners.                                                                                   | Use logs as optional evidence, not a complete census. Distinguish no event from a measured zero.                                                                 |
| `src/core/application.ts`: `queryGraphRun`; `execution/recovery.ts`, `session/deletion-service.ts`                                                                     | Saved Graph observation and deletion use existing readers/storage. Interrupted or invalid evidence remains visible.                                                                      | Evaluation must not resume nodes, perform reconciliation or create another writer from a report reference.                                                       |
| `test/core/execution/graph.test.ts`, `graph-interruption.test.ts`, `run.test.ts`, `test/core/logs.test.ts`, `diagnostics.test.ts`, `model-response-projection.test.ts` | Deterministic checks cover the evidence-producing contracts.                                                                                                                             | These are core correctness tests, not model-quality benchmarks.                                                                                                  |

### Diagnostic execution

On macOS arm64 / Node 26.5.0, the six test files listed above passed **63 tests**. The required headers:check, build and full test suite also passed (550 tests). Lint retained 39 existing warnings and no errors. No implementation/test edits, live model calls, price lookup or Linux rerun were performed in this investigation. These are baseline checks, not a successful evaluation implementation.

A memory-only diagnostic consumed one `modelCalls` allowance in a Run body and returned a value. It observed live counter 1, recovered counter 0, no budget/usage fields in the terminal record, an evicted diagnostic prefix, and no event when capture is off. This consumed an allowance synthetically; it did not call a provider. Reproduce against a built checkout:

```javascript
import assert from 'node:assert/strict'
import {RunSupervisor, MemoryExecutionJournal, recoveredRunSnapshot, DiagnosticEventBus} from './dist/index.js'
const journal = new MemoryExecutionJournal('evaluation-probe')
const supervisor = new RunSupervisor()
try {
  const handle = await supervisor.startRun({
    sessionId: 'evaluation-probe',
    requestId: 'probe',
    configuration: {},
    input: {},
    journal: async () => journal,
    async execute(run) {
      await run.ready([])
      run.consume('modelCalls')
      return 42
    },
  })
  await handle.finished
  assert.equal(handle.getSnapshot().budget.modelCalls, 1)
  const terminal = journal.records().find((record) => record.kind === 'run-terminal')
  assert.equal('budget' in terminal.data, false)
  assert.equal('usage' in terminal.data, false)
  const recovered = recoveredRunSnapshot(handle.id, 'evaluation-probe', journal.records(), {
    mode: 'memory',
    level: 'memory',
  })
  assert.equal(recovered.budget.modelCalls, 0)
  const bus = new DiagnosticEventBus({maxEvents: 1})
  bus.emit({type: 'first'})
  bus.emit({type: 'second'})
  assert.deepEqual(
    bus.list().map((event) => event.sequence),
    [2],
  )
  assert.equal(new DiagnosticEventBus({capture: 'off'}).emit({type: 'missing'}), undefined)
} finally {
  await supervisor.close()
  await journal.close()
}
```

This is evidence of missing historical measurement, not a reason to change the adopted recovery behavior in this documentation task.

## External Systems Investigated

Primary source was inspected on 2026-09-12 at the revisions below, reused from the earlier Graph comparison. These are comparison snapshots, not newest-release claims. External applications and test suites were not executed.

| System                                           | Primary source                                                                                                                                                                   | Verified observation and limited transfer                                                                                                                                                                                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex `5adb68a49933ae446bf11935662c83dba55a0804` | [exec_events.rs](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/exec/src/exec_events.rs), `ThreadEvent`, `Usage`, `CommandExecutionItem` | Turn completion, item status and command exit code are distinct; usage includes cache/reasoning breakdowns. Reuse separate result axes. These event types do not establish task correctness, durable completeness or a generic benchmark API.                     |
| Pi `b79e4cc834970cca69daebffab7df1da7d1e52c4`    | [types.ts](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/ai/src/types.ts), `Usage`, `AssistantMessage`, `ToolResultMessage`        | Usage/cost, stop reason and tool error remain separate. Reasoning is documented as a subset of output; optional breakdowns must not be double-counted. Transfer typed provenance, not its cost fields as proof of Orbit's invoice costs or complete measurements. |

### Reused investigations and contrary evidence

The [optimization-papers investigation](2026-09-02-agent-workflow-optimization-papers.md), especially its evaluation/limitations and cross-paper sections, already compares GPTSwarm, AFlow and EvoAgentX. Its reported benchmark numbers and publication verification are **not remeasured or independently reverified here**. Reuse only the recorded distinction between task-specific evaluation and candidate optimization; do not create a duplicate literature survey or import benchmark gains.

The [historical adaptive runtime](2026-09-02-adaptive-processor-graph-runtime.md) and [bounded Graph investigation](2026-09-12-bounded-processor-graph-execution.md) separate execution from evaluation/promotion. Their earlier no-Graph baseline is historical. Neither specifies the proposed missing-evidence accounting contract.

A full experiment runner could standardize timing and isolation more strongly than a read-only contract. Conversely, application-only reporting avoids a new public core schema. These are substantive alternatives: the recommendation buys consistent evidence/denominator validation, while accepting application integration work and incomplete historical metrics.

## Analysis

### Four independent validation targets

A target-project test measures that project's checked assertions. An agent-application test measures request handling, authorization, UI/reporting and orchestration. Orbit core tests measure shared mechanisms. A task-quality evaluation grades artifacts/behavior on versioned cases under stated model/environment conditions. None substitutes for all others. A refused modification may be the correct task result; a completed Graph can still fail an independent target or change-scope check.

### Trial comparability

Freeze a case suite, all planned case/variant/repetition slots, the initial target and independent grader definitions before dispatch. Separate training/development and held-out roles. A variant is an application configuration identity for comparison, not an approved replacement for production. A new trial uses a fresh target, Session/journal pair and request ID; resending an existing ID observes the same attempt and never adds a trial.

Keep environment, provider/model configuration, tools/catalog, Skill selections, context profile, limits, dependency lock and approval policy in the declared comparison profile. Variant changes must be enumerated comparison dimensions; unplanned drift makes the affected pair incomparable. Actual provider model identity and dynamically resolved catalog/Skill metadata must be checked, not just intended configuration. Exact model outputs need not be repeatable.

A private copy of a directory is not an OS or network sandbox. The host must provision independent evaluation code and expected artifacts outside the candidate's authority, bound execution and prevent lingering candidate processes from modifying a target during grading. Do not grade live, incompletely stopped work. Each executed grader also needs bounded ownership, logs and exit classification; target/grader work must not bypass authorization merely because it is an evaluation.

### Missing evidence and resource semantics

Use a planned-slot denominator, runtime outcome, evidence availability, per-check verdict and metric coverage independently. Keep early admission failure and absent results. Missing reports leave dispatch unknown; they are not proof that a trial never ran. Expected refusal/cancellation can satisfy case checks while remaining visible as runtime refusal/cancellation. Unknown effects, unresolved ownership and invalid required evidence prevent an overall pass; known check violations remain visible even when another check is unknown.

A resource metric needs unit, scope, source IDs, method revision and coverage, not only a number. Live consumed allowances, provider-reported tokens, SDK transport attempts, measured host elapsed time and invoice cost are different metrics. Count summaries as part of overall model allowance; retain their separate scope when measured. Do not reconstruct a complete total from Graph visit-start snapshots, optional logs or the zero counters in recovered snapshots. Price calculations require an explicit dated rate table and nonoverlapping billing categories; otherwise cost is unavailable. No price recommendation is made here.

## Implications for Orbit

**Non-binding recommendation:** add a bounded pure core module validating plans, supplied execution evidence and immutable reports, then producing itemized comparisons. Applications run and grade trials through existing managed APIs and store authorized reports. Do not add an experiment scheduler, a second Run supervisor, automatic grader execution, a new required journal version, mandatory telemetry or candidate promotion in this increment.

Proposed details and acceptance costs are in the [evaluation ADR](../adr/2026-09-12-evidence-based-workflow-evaluation.md). The need for a distinct contract follows from missing evidence and denominator semantics, not from a claim that core can decide task quality.

## Risks and Limitations

Hashes identify supplied bytes; they neither prove provenance nor authorize artifact access. Ordinary evidence may be irretrievably incomplete after a crash. Application-owned report storage needs retention/deletion and access control separate from Session deletion. Some metrics will remain unknown in the first implementation. Existing Unix verification does not settle Windows, production controls, physical faults or representative real-model trials.

## Open Questions

The author must decide whether to adopt a read-only shared contract now, accept incomplete historical resource measurements, and retain application ownership of trusted graders/isolation/report persistence. Review the exact verdict rules, compatibility profile and confirmation matrix before acceptance. No ranking thresholds, improvement claims or promotion design are approved.

## Related Decisions

All eight accepted/partial lifecycle, authorization, required-journal, recovery, registration, compaction, Skill and Graph decisions remain unchanged. The new ADR is proposed/not-started and has no supersession relationship. Input-budget delegation and previous Skill/Graph acceptance are not evaluation approval. Backup deletion remains unauthorized; author-deferred trials remain deferred.

### Same-source proposal review — 2026-09-13

Reviewed local and public main `1cb6f4f2abe3e89e27c1bdb32f1049183ef0e960`. Public main has advanced from the original investigation; no source/test/dependency or accepted-contract changes followed the proposal. All eight accepted/partial ADR bodies remain unchanged. The 2026-09-12 baseline and external-source comparison above are retained as historical evidence, not relabeled as a new external investigation. Evaluation remains unimplemented.

The review supports the pure core/application split, with the following additional source evidence and corrections:

| Evidence inspected                                                                                                                                                     | Finding                                                                                                                                                                                                         | Non-binding implication                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `execution/journal.ts`: `MemoryExecutionJournal.key`, `digest`, `canonicalJSON`; `processor/graph-definition.ts`: descriptor hash; `graph-execution.ts`: `graph-bound` | Journal HMAC keys differ across storage pairs, whereas compiled descriptor identity is unkeyed. The existing JSON helper reads object properties.                                                               | Separate within-journal binding from cross-trial semantic identity. Restrict the proposed effect-free entry to bounded JSON text, not caller objects with getters/Proxy traps. Do not change the existing helper. |
| `execution/run.ts`: `recoveredRunSnapshot`; `test/core/execution/run.test.ts`: noncooperative work and replay cases                                                    | Late settlement can release quarantine without changing the original incomplete terminal result; recovered counters remain zero. A request ID is Session-scoped, and live replay compares submitted input.      | Preserve terminal and later observation separately. Different report IDs must not count one Run as multiple trials. Evaluation imports never retry or resume it.                                                  |
| `processor/graph-inspection.ts`, `skills/record.ts`: `parseSkillEntry`, `validateSkillEntries`; `execution/recovery.ts`                                                | Graph inspection verifies path/transcript reference relationships, but does not itself revalidate every Skill payload. The journal reader performs filesystem I/O and reports torn/invalid prefixes separately. | Distinguish raw checks performed by pure core from host-attested external inspection. Apply the appropriate payload validators; carry all reader issues. Do not call the file reader inside the pure function.    |
| Skill revision-1 4 MiB record bound and the proposed evaluation 2 KiB ordinary-string bound                                                                            | Applying the metadata bound to raw Skill source would reject otherwise valid source records. Large prefixes can exceed the evaluation bundle.                                                                   | Scope bounds explicitly: metadata limits versus existing raw record limits within a bounded total. Oversized evidence is unavailable/out-of-profile, not an invalid Session or verified truncated prefix.         |
| Original ADR verdict and identity rules                                                                                                                                | Required evidence/checks, per-variant denominators and cross-slot Run uniqueness were insufficiently specified. Empty requirements and pooled rates could give misleading success.                              | Freeze minimum evidence/trust policy and nonempty independent checks, use one exclusive disposition per slot, retain incomparable rows, and compare identical case/repetition schedules per variant.              |

### Executed review probes

On macOS arm64 / Node 26.5.0, headers:check, build and the full existing suite passed (550 tests; 39 existing lint warnings, zero errors). No source/test/dependency changes or evaluation implementation were made. Existing core tests, including interruption, are not measurements of task/model quality. Linux and live model/application trials were not rerun.

An isolated memory-only probe checked three source observations. Two fresh `MemoryExecutionJournal` instances produced different HMACs for identical configuration. Passing an object getter to `canonicalJSON` invoked the getter once. A controlled noncooperative Run was stopped, returned incomplete, then settled: after `whenQuiescent`, recovery reported `quarantined: false` while retaining `result.outcome: incomplete`, `result.quiescence: false` and zero budget counters. All assertions passed; completion required explicit promise settlement, not a timeout-only success.

Reproduce the substantive checks after building Orbit (no provider, filesystem storage or application target is used):

```javascript
import assert from 'node:assert/strict'
import {MemoryExecutionJournal, RunSupervisor, canonicalJSON, recoveredRunSnapshot} from './dist/index.js'
const first = new MemoryExecutionJournal('review-first')
const second = new MemoryExecutionJournal('review-second')
const supervisor = new RunSupervisor()
let release, entered
const pending = new Promise((resolve) => {
  release = resolve
})
const started = new Promise((resolve) => {
  entered = resolve
})
try {
  assert.notEqual(first.digest({configuration: 1}), second.digest({configuration: 1}))
  let calls = 0
  canonicalJSON({
    get field() {
      calls++
      return 1
    },
  })
  assert.equal(calls, 1)
  const handle = await supervisor.startRun({
    configuration: {},
    input: {},
    sessionId: 'review-first',
    requestId: 'review',
    journal: async () => first,
    limits: {cleanupMs: 25},
    async execute(run) {
      await run.ready([])
      run.consume('modelCalls')
      entered()
      await run.wait('controlled-pending', pending)
    },
  })
  await started
  handle.requestStop()
  assert.equal((await handle.finished).outcome, 'incomplete')
  release()
  await supervisor.whenQuiescent()
  const saved = recoveredRunSnapshot(handle.id, 'review-first', first.records(), {mode: 'memory', level: 'memory'})
  assert.equal(saved.quarantined, false)
  assert.equal(saved.result.outcome, 'incomplete')
  assert.equal(saved.result.quiescence, false)
  assert.equal(saved.budget.modelCalls, 0)
} finally {
  release()
  await supervisor.close()
  await first.close()
  await second.close()
}
```

### Review alternatives and remaining judgment

For external evidence, requiring all raw records is more independently inspectable but can exceed report limits and expose sensitive payloads. Accepting unqualified boolean attestations hides missing validation. The recommendation is bounded raw inspection plus explicitly trusted, versioned host attestations under a frozen evidence policy; the verdict must disclose which basis was used. Hashes and schema validation do not authenticate those attestations. A raw-only plan can reject insufficient evidence without altering the runtime storage contract.

For grading, freeze one post-quiescence artifact for all independent graders rather than trusting a digest captured before later mutation. For comparison, keep per-variant denominators and exact resource coverage sets rather than pooling variants or silently selecting successful/fully measured rows. Source loss during later reinspection is a new observation, not permission to rewrite an earlier immutable report or auto-restore data. A historical host attestation is not proof that artifacts remain available today.

These costs and the JSON-text entry requirement clarify the proposed scope; they are not adopted decisions. The [ADR review](../adr/2026-09-12-evidence-based-workflow-evaluation.md#proposal-review--2026-09-13) lists author judgment and confirmation conditions. Eight partial records, deferred Windows/representative/operational/physical-fault trials, existing managed MCP scope and the unanswered backup-deletion request remain unchanged.

### Subsequent author decision — 2026-09-13

The author [accepted the reviewed recommendation](../adr/2026-09-12-evidence-based-workflow-evaluation.md#author-acceptance--2026-09-13), including host-attested evidence, per-variant accounting and the JSON-text boundary. The ADR is now accepted / not-started, with no implementation evidence. All earlier proposed/pending statements in this investigation record their dated state; the research does not itself approve architecture. The eight partial decisions and author-deferred conditions remain unchanged.

## References

- [Current Run implementation](../../src/core/execution/run.ts)
- [Graph inspection](../../src/core/processor/graph-inspection.ts)
- [Model response metadata](../../src/core/models/model.ts)
- [Optional diagnostic bus](../../src/core/diagnostics/diagnostics.ts)
- [Current Graph guide](../processor-graphs.md)
- [Managed Graph ADR](../adr/2026-09-12-managed-processor-graph.md)
