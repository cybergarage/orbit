# Expanded summary allowance — natural Verified reevaluation, 2026-09-29

The generated patch was **unresolved** under the official harness: target **0/1**, existing tests **0/79**. It applied successfully, so these are executed failing tests, not empty-patch skips. A fresh reference-patch control passed **1/1 and 79/79** after Docker recovered from the separate diagnostic interruption.

Orbit reached the 900-second deadline during compaction. No checkpoint was accepted and no source-derived observation view was exercised. The local fix retains an expanded output allowance during structural correction; that path passed the separate [controlled real-model diagnostic](2026-09-29-summary-output-allowance-live.md). **This natural solver trial did not produce an expanded response with missing fields or empty output**, so it cannot establish that the fix sped up this problem.

## Results

| Measurement | Previous core `fb63aaa` | Current core `f7d7fe4` |
| --- | --- | --- |
| Summary requests / measured time | 8 / 770.97 s | 6 / 617.46 s |
| Accepted checkpoints | 0 | 0 |
| Model calls | 28 | 36 |
| Tool calls / errors | 20 / 8 | 30 / 6 |
| Host elapsed | 920.62 s | 907.60 s |
| Generated patch | Empty | 1,294 bytes, one source file |
| Official target / existing tests | Not executed: empty-patch skip | 0/1, 0/79 |
| Runtime | Incomplete, nonquiescent | Incomplete, nonquiescent |

These are repeated convenience-selected runs with different Session UUIDs and model trajectories, not a causal timing experiment or a benchmark success-rate estimate. The previous run generated missing fields after expansion, retried at the exhausted smaller allowance and expanded again. This run generated length-limited responses and did not exercise that corrective branch.

The new compaction began at **17,869 estimated tokens**. Requests were:

| Request | Phase | Source messages | Output allowance | Observed result / duration |
| --- | --- | ---: | ---: | --- |
| 1 | Batch | 15 | 2,048 | Valid, 61.09 s |
| 2 | Batch | 16 | 2,048 | Valid, 79.48 s |
| 3 | Batch | 16 | 2,048 | Length stop, 117.22 s |
| 4 | Expanded | 16 | 4,096 | Length stop, 210.42 s |
| 5 | Smaller batch | 8 | 2,048 | Valid, 74.47 s |
| 6 | Smaller batch | 8 | 2,048 | Deadline interruption, 74.79 s |

The deadline reason was `budget-exceeded:elapsedMs:900000:900077:0`; an unresolved `context-summary` operation remained. Runtime cleanup errors were empty, but **runtime quiescence was false**. A late provider response was recorded during shutdown; reported usage **395,229 input / 16,222 output tokens is incomplete**. Host copying and grading completed, and the disposable solver container was removed; this does not turn the runtime into a normally completed run. Metrics count one started compaction, zero completed/failed compactions and one interrupted summary request; there was no format-validation failure.

Independent deliverable checks failed because `.pytest_cache` files remained in the solver workspace. Those generated paths were excluded from the submitted patch; no public tests were modified. The actual patch changes `get_unpacked_marks` in `src/_pytest/mark/structures.py`, including unconditional class-MRO handling. Official failures are a generated-patch regression, separate from Orbit's summary deadline. Six tool errors were observed; a reduction from the preceding run is not an isolated improvement measurement.

## Remaining improvement

The avoidable **2048 → 4096 → 2048 → 4096** corrective sequence is fixed and deterministically tested. The successful controlled retry used **2048 → 4096 → 4096** with actual model regeneration and retained 2/2 saves. Nevertheless, an expanded response can still consume more than 200 seconds and truncate. The failed initial controlled attempt and the natural solver both demonstrate this cost.

The next focused evaluation should compare smaller initial source batches and their accumulated-summary size against the current complete-group batching policy. Measure total provider calls, input/output tokens, accepted checkpoint time and semantic evidence retention together: simply making more small calls can also increase latency and lose context. Keep complete tool groups intact, never activate a partial checkpoint, and preserve deadlines and independent semantic checks. This report proposes that evaluation; it does not claim an implemented batching change or add an agent iteration cap.

## Pinned environment and validation

Core source: `f7d7fe496e4052a49783fd0b26145349da9dc4e5`; solver metadata records docs-only head `1450dd99cc3c5fde86fcb7435783ed5bdc1ef0aa`. The [JSON](2026-09-29-summary-output-allowance-swe.json) records the verified source fingerprint, full image/model identities, requests, usage, runtime and both official results. The [prediction JSONL](2026-09-29-summary-output-allowance-predictions.jsonl) preserves the submitted patch.

- Dataset: `princeton-nlp/SWE-bench_Verified`, test revision `c104f840cc67f8b6eec6f759ebc8b2693d585d4a`; instance `pytest-dev__pytest-10356`, base `3c1534944cbd34e8a41bc9e76818018fadefc9a1`.
- Official harness: 4.1.0, commit `726c5461e2ef52d83cf1ea2107870a8bb3328d57`; Linux AMD64 evaluation image pinned by digest, emulated on Mac ARM64. Native ARM64 solver image `sha256:08987dc164dc7998dd19f94bb1111f928c0e100392a6d0b224ca3720b8fb28ab`.
- Host Ollama 0.34.4, `ornith-1.5:9b`, Q4_K_M, digest `e5df7dcdd8a263994df62d610317e07be0d6af23f96fcbd8543273058fce575e`. Context 32,768, ordinary output 4,096, summary output 2,048, seed 42, temperature 0.6, top-p 0.95, thinking disabled.
- Context trigger 17,571 / target 10,813 / safety 1,639; `coding-recovery-v1`, budgeted context, unlimited rounds, 900,000 ms deadline.
- Docker 29.8.0, VM memory 4,107,141,120 bytes. Public preflight passed. No reference patch or hidden grading information was supplied to the solver.
- Headers and build passed; full tests 1,059, compaction tests 56, host checks 19, direct checker 4, semantic evaluator 11. Formatter-only changes to unrelated E2E files were restored before image creation.

No statistical or general solve-rate claim follows. Summary schema validity and source-ID membership are not full semantic correctness. No projection was activated in the natural run, so its source-derived view remains untested here; separate reopened diagnostics cover that path. Raw journals, runtime proofs, hidden grading material and private host paths stay ignored.

## Reproduction

Build the current source images sequentially, then run in a fresh workspace:

```sh
docker build -f e2e/Dockerfile -t orbit-e2e:local .
docker build -f e2e/SweAgent.Dockerfile -t orbit-e2e:swe .
docker build -f e2e/VerifiedAgent.Dockerfile -t orbit-e2e:summary-allowance .
ORBIT_SWE_CASE=e2e/swebench/pytest-dev__pytest-10356.json \
ORBIT_E2E_IMAGE=orbit-e2e:summary-allowance \
ORBIT_E2E_CONTEXT_POLICY=budgeted \
ORBIT_E2E_STRATEGY=coding-recovery-v1 ORBIT_SWE_THINK=false \
caffeinate -i npm run eval:swebench -- solve ornith-1.5:9b
```

Use the printed solve directory for official grading:

```sh
ORBIT_SWE_CASE=e2e/swebench/pytest-dev__pytest-10356.json \
npm run eval:swebench -- grade <solve-directory>/predictions.jsonl
ORBIT_SWE_CASE=e2e/swebench/pytest-dev__pytest-10356.json \
npm run eval:swebench -- gold
```

For saved-patch regrading, use the tracked prediction instead of the local solve path after preparing the pinned dataset and official image. See the [evaluation guide](../../docs/e2e-evaluation.md). Grade/reference runs use fresh environments, separately from the solver. Keep environment interruptions, runtime stops, empty-patch skips and executed unresolved tests distinct.
