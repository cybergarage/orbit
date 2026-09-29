# Smaller sources and cumulative summaries — Verified reevaluation, 2026-09-29

**Overall summary time did not decrease in this trial.** Smaller initial sources and exact cumulative deduplication were exercised, but summary invocations increased from **6 to 11** and measured summary time from **617.46 to 686.58 seconds**. No checkpoint was accepted before the 900-second deadline. The saved prediction has an empty patch; the official harness skipped target/regression tests. A fresh reference-patch control passed **1/1 and 79/79**.

This is a repeated convenience-selected problem with different model trajectories and Docker versions, not an isolated causal timing experiment. It does not establish that the change caused the slowdown, but it provides **no evidence of end-to-end time improvement**. Successful intermediate summaries are not completed compactions.

## Observed results

| Measurement | Previous core `f7d7fe4` | Current core `08097e5` |
| --- | --- | --- |
| Compaction trigger estimate | 17,869 | 17,902 |
| Initial source messages | 15 | 1 |
| Summary invocations / measured time | 6 / 617.46 s | 11 / 686.58 s |
| Output-length detections | 2 | 1 |
| Accepted checkpoints | 0 | 0 |
| Model calls completed / started | 36 / 36 | 48 / 49 |
| Tool calls / errors | 30 / 6 | 38 / 15 |
| Host elapsed | 907.60 s | 935.75 s |
| Generated patch | 1,294 bytes | Empty |
| Official target / existing tests | Executed: 0/1 and 0/79 | Not executed: empty-patch skip |
| Runtime | Incomplete, nonquiescent | Incomplete, nonquiescent; host wrapper timeout |

All current summary inputs estimated **2,924–6,362 tokens**. Nine consecutive batches validated without expansion or structural correction. Cumulative JSON remained **1,729–4,682 bytes**, then a later response still exhausted 2,048 output tokens despite the 1,024-token soft target. The subsequent 4,096-token expansion was interrupted by the deadline.

| Request | Source messages | Prior bytes | Estimated input | Result / measured time | Validated cumulative bytes |
| --- | ---: | ---: | ---: | --- | ---: |
| 1 | 1 | 0 | 2,924 | Valid, 32.17 s | 1,906 |
| 2 | 2 | 1,906 | 3,686 | Valid, 31.05 s | 1,729 |
| 3 | 2 | 1,729 | 4,938 | Valid, 47.92 s | 2,574 |
| 4 | 10 | 2,574 | 5,826 | Valid, 85.26 s | 4,682 |
| 5 | 10 | 4,682 | 5,935 | Valid, 59.96 s | 3,255 |
| 6 | 10 | 3,255 | 5,471 | Valid, 74.29 s | 4,166 |
| 7 | 6 | 4,166 | 6,362 | Valid, 81.34 s | 4,510 |
| 8 | 4 | 4,510 | 5,650 | Valid, 70.36 s | 3,669 |
| 9 | 4 | 3,669 | 4,976 | Valid, 86.39 s | 4,432 |
| 10 | 2 | 4,432 | 6,073 | Length stop, 104.89 s | Not accepted |
| 11 | 2 | 4,432 | 6,073 | Expanded output 4,096; deadline, 12.95 s | Not accepted |

Request 9 generated 22 items / 4,589 bytes; exact deduplication merged one item while retaining its source-ID union, yielding **21 items / 4,432 bytes**. Other valid responses had no exact duplicates. This is direct evidence that deterministic deduplication executed, not evidence that model prose is semantically complete. No partial summary became a persisted checkpoint. The natural observation projection is therefore **not exercised**, not passed. The separate [reopened diagnostic](2026-09-29-compact-batches-live.md) completed and retained 2/2 saves.

Runtime reported `budget-exceeded:elapsedMs:900000:900013:0`, false quiescence and an unresolved `context-summary` operation. Cleanup errors were empty, but that is not a clean runtime completion. The host wrapper timed out after its grace period; artifacts were preserved and the disposable solver container removed. Reported **406,460 input / 17,168 output tokens are incomplete**. There were no final summary-format validation failures. Quality was not measured for the empty patch, and no claim of generated-patch quality follows. The solver received no reference patch or hidden grading information.

## Interpretation and next experiment

The implementation makes initial source selection smaller and preserves distinct evidence while merging exact duplicates. Its soft cumulative target cannot guarantee size. Smaller groups also repeat the prior summary and instructions across more sequential requests. This run shows that those extra requests can consume the available deadline without a completed checkpoint; it does not justify claiming the latency problem is solved or making a general speed recommendation.

Before tuning group counts further, freeze the same canonical source and compare the complete compaction path across commits, keeping model identity, generation options and source UUIDs fixed. Record total calls, provider input/output tokens, complete checkpoint time, intermediate sizes and semantic retention. One fresh solver trajectory per commit cannot isolate the effect of batching.

A concrete source-size candidate is repeated tool output: the current canonical results contain **27 `stdout`/`stderr` strings also appearing exactly in textual content, totaling 36,391 UTF-8 bytes**. This is an overlap diagnostic, not proven net compression or predicted speedup. Any future representation must preserve stream identity, exact whitespace, result metadata and source IDs, and retain canonical history. No stream normalization was implemented in this change. Lossless factoring of these repeated excerpts should be evaluated before further shrinking batch sizes. Arbitrarily dropping distinct facts or imposing an agent iteration cap is not this proposal.

## Implementation and reproducibility

Core `08097e57a1f57cdd19b68e035bd8ae259cf506e2`; metadata records docs-only head `c0279d7c61ade6d3aa777d4b987881efb2842edd`. [Curated JSON](2026-09-29-compact-batches-swe.json) records source fingerprint, identities, settings, requests/sizes, incomplete usage, overlap candidates and official disposition/control. The [standard prediction](2026-09-29-compact-batches-predictions.jsonl) preserves the empty patch unchanged.

- Dataset: `princeton-nlp/SWE-bench_Verified`, test revision `c104f840cc67f8b6eec6f759ebc8b2693d585d4a`; `pytest-dev__pytest-10356`, base `3c1534944cbd34e8a41bc9e76818018fadefc9a1`.
- Official harness 4.1.0, commit `726c5461e2ef52d83cf1ea2107870a8bb3328d57`; pinned Linux AMD64 image, emulated on Mac ARM64. Native solver image `sha256:6e0be682e8c3a8c2295dcf3ebb080a484e40fd19f51e95c77a5288baac4aa3c1`.
- Host Ollama 0.34.4; `ornith-1.5:9b`, Q4_K_M, digest `e5df7dcdd8a263994df62d610317e07be0d6af23f96fcbd8543273058fce575e`. Context 32,768; ordinary output 4,096 / summary output 2,048; seed 42, temperature 0.6, top-p 0.95, thinking disabled.
- Budgeted context; trigger 17,571 / target 10,813 / safety 1,639. Initial group divisor 8; marginal source target 4,096; soft cumulative summary target 1,024. Single complete groups may exceed the source target within the actual input budget; short histories and verified interruption preserve the one-shot route.
- `coding-recovery-v1`, unlimited rounds, 900,000 ms deadline. Docker **29.8.1**, ARM64, VM memory **4,107,141,120 bytes**. The preceding run used Docker 29.8.0. Public preflight passed.
- Headers/build passed; full tests **1,063**, focused compaction/integration **64**, host checks **19**, direct checker **4**, semantic evaluator **11**. Initial full validation caught an interruption-compaction regression, repaired before the final full suite. Unrelated E2E formatting was restored before image creation. The existing-policy internal tuning changes no public setting, persistence format or authorization rule, so no new ADR was required.

Build and run sequentially:

```sh
docker build -f e2e/Dockerfile -t orbit-e2e:local .
docker build -f e2e/SweAgent.Dockerfile -t orbit-e2e:swe .
docker build -f e2e/VerifiedAgent.Dockerfile -t orbit-e2e:compact-batches .
ORBIT_SWE_CASE=e2e/swebench/pytest-dev__pytest-10356.json \
ORBIT_E2E_IMAGE=orbit-e2e:compact-batches \
ORBIT_E2E_CONTEXT_POLICY=budgeted \
ORBIT_E2E_STRATEGY=coding-recovery-v1 ORBIT_SWE_THINK=false \
caffeinate -i npm run eval:swebench -- solve ornith-1.5:9b
ORBIT_SWE_CASE=e2e/swebench/pytest-dev__pytest-10356.json \
npm run eval:swebench -- grade <printed-solve-directory>/predictions.jsonl
ORBIT_SWE_CASE=e2e/swebench/pytest-dev__pytest-10356.json \
npm run eval:swebench -- gold
```

The [evaluation guide](../../docs/e2e-evaluation.md) covers dataset/image preparation and saved-prediction regrading. Grade and reference runs use fresh environments. Keep deadline stops, host timeouts, empty-patch skips, environment errors and executed unresolved tests distinct. Raw journals, runtime proofs, hidden grading material and private paths remain ignored. Full semantic fidelity and a completed long-history checkpoint remain unverified in this trial.
