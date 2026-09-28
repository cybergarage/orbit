# Independent summary semantic evaluation — 2026-09-28

## Result

The fixed-case grader detects an error that JSON and source-ID checks did not: the current prompt preserves saved edits and the latest selection failure, but still claims an empty passing test verified both markers. Both before and current conditions are therefore **fail** overall. The current condition passes two of the three semantic checks; this is a diagnostic result for one fixed history, not a general accuracy score.

| Prompt | Saved edit state | Latest test and remaining work | No unsupported success | Overall | Time / tokens in,out |
| --- | --- | --- | --- | --- | --- |
| Before `4eb5701` | Fail: stale unsaved claims | Fail: missing latest selection/work | Pass: no recognized unsupported success claim | Fail | 110.3 s / 18,403, 1,463 |
| Current `1a69535` | Pass | Pass | Fail: claims both markers passed without an assertion proving it | Fail | 104.8 s / 18,587, 1,473 |

Both outputs were complete JSON responses with no unknown source IDs. Semantic grading is independently computed after generation; a format-valid response cannot pass by omitting required evidence. The grader's passing third check for the baseline does not mean all its statements were correct; the two other checks failed.

## Method and limits

The committed fixture is the same public solver-history source used in the earlier manual work-state replay: selected complete message pairs and the problematic checkpoint from `pytest-dev__pytest-10356`. Its separate expected evidence IDs are used only by the evaluator, never supplied to the summarizer. The grader is a conservative English claim-pattern checker for this single case. Known contradictions and missing required observations fail; ambiguous/refuted/unrecognized claims require review. `needs-review` never counts as pass. It is not a general natural-language truth verifier or an independent LLM judge.

Evaluator `a9f7d90`, fixture/source hashes, original generated summaries, per-check evidence, model details and timings are recorded in [JSON](2026-09-28-context-semantic-evaluation.json). Model: `ornith-1.5:9b`, Q4_K_M, digest `e5df7dcdd8a263994df62d610317e07be0d6af23f96fcbd8543273058fce575e`, Ollama 0.34.4. Settings: 32,768 context, 2,048 output cap, seed 42, temperature 0.6, top_p 0.95, thinking disabled, JSON mode. Each condition ran once against the same source. Timings are recorded, not claimed as a speed improvement.

No runtime API, checkpoint shape or production stopping behavior changed. This is an evaluation-only addition inside the existing diagnostic workflow, so no ADR is required. Validation passed: 11 independent grader/driver tests, 1,038 Orbit tests, headers check and build. Tests cover missing evidence, stale claims, no-tests-selected, unsupported success, negation/review, malformed summaries, immutability and separation of grader expectations from model input.

## Reproduction

```sh
npm run test:e2e:summary
npm run eval:context-summary -- --candidate-ref 1a69535 --output tmp/e2e/context-summary-semantic-rerun
```

Full requests, responses and metadata remain under ignored `tmp/e2e/context-summary-semantic-20260928/`. The fixture makes this replay independent of the original ignored solver log. Preserve a unique output directory for each repeat. See [the evaluation guide](../../docs/e2e-evaluation.md#fixed-context-summary-semantic-diagnostic).

## SWE-bench continuation

The fresh solve used Orbit `b48e590` (clean working tree, evaluator `a9f7d90`, unchanged production prompt `1a69535`), rebuilt `orbit-e2e:verified`, and a separate workspace/Session. The model/settings match the prior focused-v1 65% runs: `ornith-1.5:9b`, context 32,768, output cap 4,096, seed 42, temperature 0.6, top_p 0.95, thinking disabled, no iteration cap, 900-second Run deadline. Budget profile: trigger 17,571, target 10,813, summary cap 2,048. Docker had 4,107,141,120 bytes of memory; the ARM64 solver used host Ollama. Public preflight passed (13 passed, 1 skipped).

**Result: no patch, incomplete at the deadline.** The official harness exited successfully but classified the prediction as `skipped-empty-patch`: 1 submitted, 1 empty, 0 completed, 0 resolved, 0 grading errors. It did not execute target or PASS_TO_PASS tests, so there is no new official test pass/fail rate. The wrapper's broad status is `unresolved`; the precise grading disposition is retained in JSON. This is a solver/runtime failure at a time budget, not a measured target-test failure or an environment failure.

| Measurement | Observed |
| --- | --- |
| Host elapsed time | 919,994 ms (includes collection/cleanup); Run cancellation at about 900 s |
| Model calls completed / tools / tool errors | 166 / 162 / 146 |
| Repeated failed calls (diagnostic metric) | 137; the exact `grep -n "newcollect" src/_pytest/nodes.py` command occurred 136 times |
| Compaction | 2 started, 0 completed, 1 failed, 145 skipped after the failed attempt |
| Summary requests / wall time | 4 / 469,197 ms (includes aborted request time) |
| Recorded input/output tokens | 3,587,439 / 12,705; **usageComplete=false**, not a complete billing estimate |
| Generated patch | 0 bytes; no changed paths |

The first compaction started at 17,740 estimated tokens. Its 68.3-second response was complete and parseable JSON, but three keys were named `,facts`, `,changedPaths` and `,uncertainties` instead of the expected names. Orbit rejected it as `summary-invalid-format` and retained original history. The exact response and diagnostic events are preserved in JSON. JSON-constrained generation did not guarantee the checkpoint schema.

The model then repeated unsuccessful read/search commands. At 27,078 estimated input tokens, compaction retried. Two batches completed in 120.3 and 139.5 seconds; a third batch was cancelled at the deadline. A late model response arrived after cancellation with stop reason `length`; it was not adopted. Runtime records an unresolved context-summary operation and `quiescence=false`, with no cleanup errors. No checkpoint was accepted, so this run has **no measured semantic checkpoint score**. The fixed-history grader cannot be applied to unrelated evidence IDs. The failure does not establish a regression caused by the evaluator, which changes no production code; the full solve was not a controlled before/current comparison.

Official grading used SWE-bench 4.1.0 at `726c5461e2ef52d83cf1ea2107870a8bb3328d57`, Verified test revision `c104f840cc67f8b6eec6f759ebc8b2693d585d4a`, issue `pytest-dev__pytest-10356`, base commit `3c1534944cbd34e8a41bc9e76818018fadefc9a1`. Pinned grader image: `sha256:363458d4698f5d985f6476d189d3f1cf902253cd9518705fd395516cd30138da`, amd64 via Docker emulation. Run ID: `orbit-prediction-0b109564-ef75-4e8b-aebe-df802a815c0f`. Aggregate and grading provenance are retained in JSON. The harness skipped empty patches before creating a test run; no fresh grading container/test report exists. The earlier reference-patch control was not repeated in this follow-up.

The [prediction](2026-09-28-context-semantic-swe-predictions.jsonl) is copied byte-for-byte from the solver output. Full events and workspace are retained locally in ignored `tmp/e2e/verified/pytest-dev__pytest-10356/solve-ornith-1.5-9b-19454ca3-0b9d-454f-94b5-118a861e0a31/`.

```sh
docker build -f e2e/Dockerfile -t orbit-e2e:local .
docker build -f e2e/SweAgent.Dockerfile -t orbit-e2e:swe .
docker build -f e2e/VerifiedAgent.Dockerfile -t orbit-e2e:verified .
ORBIT_SWE_CASE=e2e/swebench/pytest-dev__pytest-10356.json \
ORBIT_E2E_IMAGE=orbit-e2e:verified ORBIT_E2E_STRATEGY=verified-focused-v1 \
ORBIT_E2E_CONTEXT_POLICY=budgeted ORBIT_E2E_CONTEXT_TRIGGER_RATIO='' \
ORBIT_SWE_THINK=false npm run eval:swebench -- solve ornith-1.5:9b
ORBIT_SWE_CASE=e2e/swebench/pytest-dev__pytest-10356.json \
  npm run eval:swebench -- grade e2e/results/2026-09-28-context-semantic-swe-predictions.jsonl
```

The next focused improvement is to prevent summaries from upgrading a passing test into verification of assertions it never made, using this committed case as a regression diagnostic. Schema-constrained output or narrowly validated schema recovery is a separate candidate suggested by the malformed keys; it needs its own verification. Repeated search failures also remain a model behavior concern. None of these production changes is implemented in this evaluation-only phase, and no iteration cap was introduced.
