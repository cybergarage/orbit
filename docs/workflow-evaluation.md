# Workflow evaluation

Orbit exposes read-only evaluation of supplied evidence for ordinary Agent and
managed Graph trials. A completed Run is a runtime fact, not proof that a coding
task passed. Applications supply a trusted plan separately from reports and own
execution, isolation, independent grading and report storage.

## Public API

All functions below are exported from `@cybergarage/orbit`. Inputs are primitive JSON text
strings, not caller objects. Invalid format, plan or identity conflicts throw;
valid reports with missing or invalid evidence produce explicit findings and
indeterminate rows. Functions are synchronous and never open a supplied path,
execute a callback, load a model, invoke a tool, resume a Run or restore a Session.

```ts
import {
  compareEvaluationReports,
  evaluationClaimsDigest,
  inspectEvaluationEvidence,
  sealEvaluationReport,
  validateEvaluationPlan,
} from '@cybergarage/orbit'

// These strings are obtained by the authorized host, outside the pure API.
const {digest: planDigest} = validateEvaluationPlan(trustedPlanText)
const inspection = inspectEvaluationEvidence(trustedPlanText, attemptText, 'variant-0')
const payloadDigest = evaluationClaimsDigest(attemptText)
const report = sealEvaluationReport(reportPayloadText)
const comparison = compareEvaluationReports(trustedPlanText, importsText)
```

`EvaluationPlan`, `EvaluationAttempt`, `EvaluationReportPayload`,
`EvaluationReport`, `EvaluationImports`, `EvaluationInspection` and
`EvaluationComparison` describe these JSON structures. The
[executable fixture](../test/core/evaluation/fixture.ts) supplies a complete
small plan, host attestations and reports; the
[tests](../test/core/evaluation/evaluation.test.ts) exercise exact denominators,
corrections and missing evidence. These are core tests with fixed expectations,
not a finished application or measurements of real-model quality.

`evaluationDigest(text)` computes SHA-256 over newly parsed canonical JSON.
`evaluationClaimsDigest(attemptText)` binds a host attestation to every attempt
field except `evidence` itself, including metrics and the original terminal.
The host first assembles the facts with an empty evidence array, computes this
digest, then attaches each authorized verifier's findings. Changing facts
requires new attestations. A digest authenticates neither the host nor the
artifact. Supplying an arbitrary `verified: true` field is rejected.

`sealEvaluationReport` validates and hashes a payload. It does not certify its
claims. The returned digest covers every payload field (ID, plan binding and
predecessor included), excluding only the resulting `digest` field. The host
serializes its own objects outside this boundary. Serialization of arbitrary
objects can invoke getters; the text APIs reject those objects without property
access. Every result is newly allocated.

## Revision 1 plan and report

The strict JSON schema is maintained in
[`src/core/evaluation/schema.ts`](../src/core/evaluation/schema.ts). Unknown
fields, enums and revisions are rejected. No field may appoint authority from
inside an imported report.

| Structure       | Fields and responsibility                                                                                                                                                                                                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Plan            | `revision: 1`, `id`, `suiteRevision`, `cases`, `variants`, `dimensions`. The authorized caller freezes it before dispatch. Core cannot prove when it was frozen or that the caller is honest.                                                                                                                                                    |
| Case            | `id`, `revision`, development/held-out `role`, `fixture`, `forbiddenChanges`, at least one required `checks` entry with grader ID/revision and expected observation scope, `permittedOutcomes`, `evidence`, minimum `recording`, `refusalNotApplicable`. Independent oracles enforce expected output and forbidden edits.                                                       |
| Variant         | `id`, complete `configuration`, ordered `slots` of `caseId` and nonnegative `repetition`. Every variant has the same nonempty schedule. Only keys explicitly listed in `dimensions` may differ in the plan.                                                                                                                                      |
| Configuration   | Application/Orbit/adapter, model/options, catalog, ordered Skills, graph descriptor, private configuration, input profile, limits, approval, dependencies, environment, target and portable `mappingMethod` identities. Values are opaque host-issued semantic identities; private configuration is not inferred from a public graph descriptor. |
| Evidence policy | `category`, `scope`, applicable `stages`, allowed `core` inspection and authorized `verifiers` with revisions. Admission is mandatory for every stage. Admitted trials also require terminal, configuration, quiescence, artifact, grading and isolation; refusals require the applicable effect/grade/quiescence evidence.                      |
| Attempt         | Stable `id`, case/repetition, `stage` (`admitted`, `refused`, `not-run`), `identity`, original `runtime`, actual `configuration`, `admissionReason`, `noResources`, `quiescent`, `artifact`, `checks`, `evidence`, `metrics`, optional `settlement` (explicit null when absent).                                                                 |
| Run identity    | `namespace`, `storageIdentity`, `sessionId`, `runId`, `requestId`. Both namespace-to-storage and storage-to-namespace mappings must be one-to-one within the bundle. One fresh pair/Session, Run and request belongs to one slot. These host identities do not prove physical isolation.                                                         |
| Runtime         | Original outcome, quiescence, recording mode/level/status and `raw` JSON text containing the full original `RunResult`. Missing original terminal is null, never a manufactured success. Admission refusal/non-dispatch has no Run identity or result.                                                                                           |
| Artifact        | `id`, initial `fixture`, versioned content/change-set `method`, `before`/`after` grading content identities, `frozen` (`read-only-copy` or `verified-unchanged`), `postQuiescence`. The before/after values refer to the final artifact across grading, not initial versus edited project.                                                       |
| Check           | Required check `id`, authorized `grader` ID/revision, `artifactId`, observation `scope`, pass/fail/indeterminate `result`, `reason`, `independent`, and `error` (`none`, exception, timeout, cancelled or missing). All required checks refer to the same frozen artifact.                                                                       |
| Report payload  | `revision: 1`, opaque `id`, trusted `planDigest`, `variant`, `predecessor` (null for the first immutable report), `attempts`. `sealEvaluationReport` adds `digest`.                                                                                                                                                                              |
| Imports         | `revision: 1`, `reports`, `selected` report IDs. Include predecessor history, select at most one revision per variant. Absent reports/slots remain missing.                                                                                                                                                                                      |

Reports may omit planned slots: comparison materializes them as `missing` with
unknown dispatch. `not-run` requires trusted admission evidence confirming no
dispatch/resources. Importing the same report repeatedly is idempotent. Conflicting
content under an ID, duplicate attempt slots, storage/Run/request reuse, unknown
predecessors, cyclic history and multiple selected revisions are rejected.
Corrections preserve the original trial and terminal, retain predecessor reports,
and may add later settlement or new artifact/grade observations. They do not
start a new repetition, discard an observed trial or resume intermediate work.

`refusalNotApplicable` declares which preparation-stage categories cannot yet
exist in an expected refusal; it never exempts an admitted trial. In particular,
missing configuration can be comparable only under that explicit early-refusal
rule, trusted admission evidence and confirmed absence of acquired resources.
Other missing or different configurations retain their row and denominator but
suppress comparative claims.

Use portable identities with an explicit mapping of fresh paths and snapshot
IDs to fixture/content/ordered selection and adapter implementation. Do not use
the journal's per-storage HMAC as a cross-trial configuration identity, share its
keys, or drop every differing field. Core validates the supplied mapping; an
application must detect dishonest or incorrect physical mappings externally.

## Evidence and quality

Host evidence identifies `category`, authorized `verifier`, `source`, expected
`scope`, `capturedAt`, `highWater`, `complete`, all `findings` and `payloadDigest`.
Its `kind` is `host`. The verdict exposes which categories were trusted host
attestations. Inspectors must actually check their claimed source and scope;
structural validation does not independently authenticate their statements.

Core evidence has `kind: core`, category `journal` or `transcript`, bounded JSONL
`raw`, source/scope/capture/high-water/completeness/findings. The host supplies
complete relevant prefixes through its existing authorized readers. Core uses
`validateNext`, `parseSessionFile` (including Skill derivation and compaction
validation), and `inspectGraphRun` for Graph path/transcript references. It checks
Run/request identity, original terminal, operation results and synchronized
entry positions. It retains reader findings, missing terminal, unknown complete
records and an unterminated suffix as insufficient evidence. It never truncates,
repairs, or retries the original storage. A raw prefix cannot prove a physical
fsync; recording capability remains explicitly host-trusted.

A pass requires all required independent checks, reliable permitted runtime,
valid required evidence and confirmed quiescence. A reliable required-check
failure takes precedence over another unknown check, with that uncertainty still
visible. Otherwise missing evidence, a grader exception/timeout/cancellation,
unknown effect, unresolved resource or incomplete original task is indeterminate.
A later stop/settlement does not rewrite an incomplete terminal into completion.
Grading mutable output while candidate work remains active cannot establish pass.

Each slot contributes once to `pass`, `fail`, `indeterminate`, `not-run` or
`missing`. Variant summaries retain independent runtime and evidence counts,
`passes` and `planned`; two passes among five scheduled slots remain 2/5.
Incomparable rows retain their own quality result and denominator. No winner,
weighted score, promotion or statistical significance is computed.

## Resource measurements

Each metric includes `id`, `resource`, `unit`, `scope`, versioned `method`,
`provenance`, `coverage`, `reason`, optional observed `value`, `lowerBound`,
`source` and source-scoped `sourceIds`, disjoint accounting `cells`,
`completeSource`, `includesApproval`, `clockEpoch`, `currency`, `rateRevision`,
`rateDate`, `modelVersion` and `rounding`. Use explicit `not-applicable` metadata
where a field is irrelevant. The plan must authorize the measurements verifier;
a trusted attestation binds the metric values too.

Coverage is complete, partial, unavailable or not-applicable. Unavailable values
are not zero. Recovered counters are unavailable; visit prefixes and incomplete
optional diagnostics cannot be complete totals. Final live counters require
quiescence. A dispatch-to-quiescence duration requires one monotonic clock epoch
and approval wait coverage; unfinished time is a partial lower bound. Estimated
cost requires dated rates, currency/model version and the declared six-decimal
half-up rounding policy. It is not an invoice or a live pricing lookup.

Comparison retains every normalized measurement and its findings. Complete
measurements are summed only within the same resource/unit/scope/method/rate and
accounting-cell definition. Counts must be safe integers and overflow is rejected;
currency uses checked integer micro-units for accumulation. Every summary includes
its definition, exact measured slots, sample and planned counts. Partial values
remain visible but are not added to complete sums. Different measured subsets or
configuration drift make resource comparisons incomparable. There is no aggregate
across resource definitions: normal/summary totals, Run/visit scopes and cached or
reasoning subsets must not be added together by the consumer. Reusing an event
across slots or importing a duplicate metric alias is rejected.

## Bounds, compatibility and migration

Revision 1 permanently defines a 16 MiB UTF-8 combined plan/import bundle, 1,000
planned slots across variants, 64 checks and 64 metrics per attempt, 2,048-byte
ordinary strings, depth 32 and 200,000 parsed values (including decoded raw
records). Parsing checks type/bytes before traversal, rejects duplicate decoded
keys, nonfinite/unsafe numbers, unpaired surrogates and a leading BOM, and does
not normalize Unicode. Canonicalization sorts keys and preserves array order.

`raw` strings are exempt from the metadata ceiling; journal records/terminal
results retain the 1 MiB ceiling and transcript records the 4 MiB evaluation raw
ceiling, including historical Skill records. A prefix beyond these limits is out
of profile/unavailable for this inspection, not proof its source Session is
invalid. A larger valid Session can instead use a pre-authorized host inspection.
Never truncate it and claim completeness.

Applications can impose smaller creation limits before sealing, but readers keep
revision-1 ceilings for existing valid reports. Unknown future revisions are
rejected explicitly. These initial product limits were exercised with small
fixed-double cases and boundary tests; they are not measured optima for a finished
coding agent. Reports add no journal/transcript version, migration writer or
runtime authority. Existing old-process/restart shutdown, Session deletion and
exclusive maintenance conditions remain in force.

The application separately owns export consent, access, minimization, retention,
correction and deletion. Session deletion does not erase reports or authorize
retaining full transcripts. A historical attestation describes capture time;
reinspection after deletion needs newly supplied evidence and a new report
revision. Neither imports nor embedded artifact paths restore deleted data or
backups. Real-model quality and operational/physical-fault trials require their
own application, environment and SLI/SLO conditions.
