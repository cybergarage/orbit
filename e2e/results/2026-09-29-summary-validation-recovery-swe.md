# Summary validation recovery — natural Verified reevaluation, 2026-09-29

The natural solver run exercised the new **missing-field correction**, but did
not finish compaction within its 900-second deadline. It produced an empty
patch. The official grading path reported `skipped-empty-patch`; **no target or
regression tests were executed for this prediction**. This is not a test failure
score or evidence of a coding-quality improvement.

The separately rerun reference patch resolved the same pinned problem
(FAIL_TO_PASS 1/1, PASS_TO_PASS 79/79), confirming the official environment.
The [controlled live diagnostics](2026-09-29-summary-validation-recovery-live.md)
also completed all three conditions and retained 2/2 real save acknowledgements
in each. Controlled recovery success and this incomplete solver outcome remain
separate measurements.

| Measurement                          | Previous `912e210` attempt                         | Current `fb63aaa` attempt                                               |
| ------------------------------------ | -------------------------------------------------- | ----------------------------------------------------------------------- |
| Runtime                              | Failed after invalid summaries, quiescent          | Incomplete at elapsed-time deadline, not quiescent at terminal snapshot |
| Host elapsed                         | 853.27 s                                           | 920.62 s, including post-deadline draining/cleanup                      |
| Summary requests / wall time         | 3 / 339.09 s                                       | 8 / 770.97 s                                                            |
| Adopted checkpoints                  | 0                                                  | 0                                                                       |
| Recoverable missing fields           | No corrective generation                           | One detected defect; corrective generation requested                    |
| Output-length detections             | See previous report                                | Three; expanded output and smaller groups attempted                     |
| Tool calls / errors                  | 37 / 7                                             | 20 / 8                                                                  |
| Official prediction                  | Nonempty; unresolved, target 0/1, regression 79/79 | Empty; skipped, no tests run                                            |
| Deterministic observation projection | Not exercised                                      | Not exercised                                                           |

## What happened

The first two source batches passed format and source-ID validation. A later
batch hit the 2,048-token output limit. Expanded output then omitted required
fields, activating the new correction from the same original evidence.
The correction also hit the output limit; output expansion and smaller complete
tool groups followed. The requested source sizes/output allowances were:

```text
9/2048 → 10/2048 → 10/2048 → 10/4096 →
10/2048 (correction) → 10/4096 → 4/2048 → 4/2048
```

The deadline arrived during the last request. The runtime recorded
`budget-exceeded:elapsedMs:900000:900083:0`, one unresolved `context-summary`
operation and `quiescence: false`. Cleanup errors were empty; the disposable
solver container was removed after output preservation. The later completed
provider response remained visible in diagnostics but could not activate a
checkpoint after the deadline. Host elapsed time includes the grace period;
it is not an increased Run allowance.

Aggregated `summaryValidationFailures: 0` counts final invalid-compaction
failures, **not all invalid intermediate responses**. The independent
`context.summary.validation-failed` event records the actual missing-field
correction. `compactionsStarted: 1`, completed/failed zero describes an
interrupted compaction, not success. Its missing projection is `not-exercised`,
not a passing source-view trial. Quality checks were `not-measured` because
there was no deliverable. Repository preflight passed.

This confirms that natural missing fields reach the recovery path. It does
not show successful full-history compaction, semantic accuracy or improved
SWE-bench resolution. Multiple regeneration/expansion passes consume much of
the deadline. The next focused evaluation should compare preserving an already
expanded allowance during structural correction with switching to smaller
sources sooner, while retaining original evidence and strict validation.
There is no basis here for restoring an agent iteration cap.

## Scope, validation and pinned inputs

The implemented local fix (`fb63aaa`) uses existing JSON mode, a prompt output
contract and validated regeneration. It adds no public model API, provider
format option, persistence version or authorization change; no new ADR is needed.
The prompt contract is **not provider-enforced JSON Schema**. Invalid summaries
are never filled with invented facts or committed merely to continue.

Headers/build passed; full tests **1,056**, focused tests **68**, host E2E checks
**19**, direct-checker tests **4** and semantic-evaluator tests **11** passed.
The [live report](2026-09-29-summary-validation-recovery-live.md) records the
actual-model and controlled-fault checks. No faults were injected into this
Verified solve.

[Curated JSON](2026-09-29-summary-validation-recovery-swe.json) records the
full core/checkout commits separately, image ID and source fingerprint, model
identity, settings, request phases, runtime, control and grading dispositions.
The source fingerprint matched the rebuilt image before dispatch. The
[standard JSONL prediction](2026-09-29-summary-validation-recovery-predictions.jsonl)
contains the empty patch, preserved unchanged.

- Instance: Verified test `pytest-dev__pytest-10356`, dataset revision
  `c104f840cc67f8b6eec6f759ebc8b2693d585d4a`, base
  `3c1534944cbd34e8a41bc9e76818018fadefc9a1`.
- Official harness: 4.1.0,
  `726c5461e2ef52d83cf1ea2107870a8bb3328d57`; pinned AMD64 image digest is in JSON.
- Host: macOS ARM64, Docker 29.8.0 with 4,107,141,120 bytes of memory;
  native ARM64 solver and emulated AMD64 official grading control.
- `ornith-1.5:9b`, Q4_K_M, Ollama 0.34.4, digest
  `e5df7dcdd8a263994df62d610317e07be0d6af23f96fcbd8543273058fce575e`.
- Same solver settings: `coding-recovery-v1`, budgeted context, 32,768 context,
  4,096 ordinary output, seed 42, temperature 0.6, top-p 0.95, thinking disabled;
  trigger 17,571 / target 10,813, summary output 2,048, reserve 4,096, safety 1,639;
  unlimited rounds and 900-second elapsed-time deadline.
- Completed provider calls: 28. Reported solver usage: 330,086 input /
  16,417 output tokens, **incomplete totals**, not exact billing or full usage.

This repeats one convenience-selected problem. Source UUIDs, model history and
source snapshot differ from the prior attempt; timings and outcomes are
observations, not a causal comparison or benchmark reliability estimate.
No gold patch or hidden grading tests were supplied to the solver.

## Reproduction

Follow [the evaluation guide](../../docs/e2e-evaluation.md), using the pinned
harness and matching manifest. Build the current source before solving:

```sh
docker build -f e2e/Dockerfile -t orbit-e2e:local .
docker build -f e2e/SweAgent.Dockerfile -t orbit-e2e:swe .
docker build -f e2e/VerifiedAgent.Dockerfile -t orbit-e2e:summary-recovery .
export ORBIT_SWE_CASE=e2e/swebench/pytest-dev__pytest-10356.json
npm run eval:swebench -- prepare
npm run eval:swebench -- gold
ORBIT_E2E_IMAGE=orbit-e2e:summary-recovery \
  ORBIT_E2E_CONTEXT_POLICY=budgeted ORBIT_E2E_STRATEGY=coding-recovery-v1 \
  ORBIT_SWE_THINK=false caffeinate -i npm run eval:swebench -- solve ornith-1.5:9b
npm run eval:swebench -- grade <printed-predictions.jsonl>
```

The saved empty prediction can be replayed through the same grading command;
expect `skipped-empty-patch`, not executed tests. Inspect solver `agent/output`
with `eval:core-observations`, and inspect recovery events separately from the
aggregate failure counter. Raw journals/diagnostics remain ignored in local
`tmp/`; curated records contain no private host paths or runtime proofs.
