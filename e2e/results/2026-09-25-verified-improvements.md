# Verified evaluation improvements — 2026-09-25

This is a local diagnostic using ornith-1.5:9b, not a published benchmark score.

## Results

| Case | Strategy | Runtime | Official | Quality | Model calls | Input/output tokens | Host seconds |
|---|---|---|---|---|---:|---:|---:|
| django__django-15731 | verified-tests-v1 | timeout/budget-exceeded | resolved | passed | 51 | 574746/6698 | 1671.1 (deadline overrun) |
| django__django-15731 | verified-focused-v1 | completed/completed | resolved | passed | 45 | 462615/6277 | 363.0 |
| pytest-dev__pytest-10051 | verified-focused-v1 | completed/completed | resolved | quality-failed | 47 | 657844/11032 | 611.4 |
| sphinx-doc__sphinx-10323 | verified-focused-v1 | runtime-error/budget-exceeded | unresolved | quality-failed | 51 | 828000/7227 | 409.3 |

## Conditions and limits

All attempts retain the pinned dataset, source commits, official images and harness from the original Verified sample. Each uses 50 tool rounds, 900 seconds, context 32768, think=false, seed=42, temperature=0.6, top_p=0.95 and num_predict=4096. Exact model digests, quantization, image IDs, dependency lists, prompts, commits and usage completeness are in the companion JSON and raw metadata.

The test-runner control and focused strategy differ only in completion instructions. The first Django control experienced a 735-second host deadline overrun, so its wall-clock time is not comparable. Its official result and independent quality remain valid, but it does not establish normal bounded completion. macOS idle sleep was inhibited for subsequent measurement. Historical runs used different solver dependencies; do not attribute their differences to the stopping prompt alone. One run per condition does not establish a population success rate.

## Interpretation

The focused strategy resolved 2/3 official problems and completed normally on 2/3. The earlier baseline also resolved 2/3 but completed normally on 0/3: pytest improved, while Sphinx regressed. This does not establish an overall resolution-rate improvement. Keep the completion strategy opt-in and do not raise product-wide budgets based on this sample.

Django passed both official and independent checks. pytest passed official and modified public tests but retained six .pytest_cache files; its deliverable quality therefore failed. Sphinx reached 50 tool calls after temporarily reverting its production change for a before/after comparison. Its final patch contained only tests/test_directive_code.py, with no production fix. The initial public test file passed; the candidate file had three failing added tests. Official grading retained all 40 PASS_TO_PASS tests but failed the required FAIL_TO_PASS test. This is an unresolved patch and a visible incomplete work state, not an environment failure.

A subsequent experiment should perform before/after comparisons in separate copies and verify the final production diff before completion. That is a new observation from this run, not evidence that increasing the limit or automatically changing Orbit core would solve the problem. No further prompt tuning or hidden-score feedback was applied during this fixed comparison.

## Changes

- Repository source imports, dependencies and a public smoke test are preflighted before model execution. Missing pytest version metadata and incompatible Sphinx dependencies are prepared by the harness.
- The orbit-test helper returns the real exit status while showing a bounded tail and preserving complete logs outside the patch.
- Changed/added public tests are checked independently in a fresh environment. Existing tests are compared against the initial source; generated files are flagged. Raw official patches and scores are not changed.
- Completion instructions are separately selectable; product defaults and global limits are unchanged.

## Historical deliverable checks

- Django: changed tests passed on the initial and patched source.
- pytest: no changed eligible test files; recorded as not-measured, not a quality pass.
- Sphinx: the original test file passed, the patched test file failed, and six cache files were present despite official resolution.

## Verification

Headers and build passed; the initial full npm test had 935 passes. Final validation is recorded separately below. Host unit tests: 15 passed. Docker negative controls: 4 passed, covering missing source imports, added/modified test failures, baseline failure, artifact retention and real Orbit Bash exit status through a pipe. Raw evidence remains local under ignored tmp/e2e/improvements and tmp/e2e/verified directories.

## Reproduction

See [the operating guide](../../docs/e2e-evaluation.md#controlled-completion-instructions). Select a pinned manifest, rebuild the three solver image layers, run the chosen strategy, then grade its predictions.jsonl with the official harness. Use the same prepared image and options for a controlled prompt comparison. Preserve every failed attempt. No reference patch or hidden grading tests are mounted in the solving container.

## Final shell guard verification

The model ignored orbit-test in the observed Django runs and still used test pipelines. A final evaluation-only SHELLOPTS=pipefail guard was therefore added in commit 97ba78a and built separately as orbit-e2e:verified-guarded. Four Docker controls passed, including exit code 7 through both the real Orbit Bash pipeline and orbit-test. The live comparison above used the earlier verified-improved image; no claim is made that all three problems were rerun with the final shell guard. Product shell defaults are unchanged. Later successful shell-list commands can still hide an earlier failure, and the independent checks remain necessary.

## Attempt records

- django__django-15731 / verified-tests-v1: `tmp/e2e/verified/django__django-15731/solve-ornith-1.5-9b-c663ea62-268f-4794-bab3-7546640c883e`; official record `tmp/e2e/verified/django__django-15731/orbit-prediction-1343ad9c-d33d-4db3-bb25-12d2f42af3a7.json`.
- django__django-15731 / verified-focused-v1: `tmp/e2e/verified/django__django-15731/solve-ornith-1.5-9b-4ae56902-6dc6-4808-aeab-c2be0275131d`; official record `tmp/e2e/verified/django__django-15731/orbit-prediction-1ac45600-ebe2-4509-aee1-72679ccbe54f.json`.
- pytest-dev__pytest-10051 / verified-focused-v1: `tmp/e2e/verified/pytest-dev__pytest-10051/solve-ornith-1.5-9b-7631866c-c472-476b-87a5-81f7c64931b9`; official record `tmp/e2e/verified/pytest-dev__pytest-10051/orbit-prediction-a7271d42-06db-49b4-b85b-e04eceb8648f.json`.
- sphinx-doc__sphinx-10323 / verified-focused-v1: `tmp/e2e/verified/sphinx-doc__sphinx-10323/solve-ornith-1.5-9b-8300aa90-798a-4878-9838-e58cee871ce8`; official record `tmp/e2e/verified/sphinx-doc__sphinx-10323/orbit-prediction-5a1568d4-8db2-4cac-bd28-e180ac517040.json`.

## Final validation and commit record

- `npm run headers:check`: passed.
- `npm run build`: passed.
- `npm --ignore-scripts test`: 935 passed. The final run skipped the auto-fixing pretest hooks to preserve concurrent book-E2E edits; the earlier ordinary `npm test` also passed 935 tests.
- `npm run test:e2e:unit`: 15 passed.
- `ORBIT_E2E_IMAGE=orbit-e2e:verified-guarded npm run test:e2e:verified-checks`: 4 passed.
- Read-only ESLint on the changed harness files: zero errors, three complexity warnings (host orchestration, quality orchestration, official grading).
- All evaluation containers were removed. Images, predictions, source snapshots and logs were retained locally.
- Changes from a separate book-E2E task remain in `.dockerignore`, `docs/e2e-evaluation.md`, `eslint.config.mjs`, `package.json` and `e2e/book/`; none were staged as part of this task.

The measured image was `sha256:941ef2c342377364590b4459da9dab24691cf1749ff9b6cc42e75f9cdb9e4fb6`.
The final guarded image was `sha256:c63138f19a6e52bbe8d119656b82d2a09c4cf537cc9b61d4f4c7d7ae4c5548c0`.
The guarded image was validated with real Bash-tool Docker controls, not a second full three-problem model replay.
The live artifacts record their actual image IDs; do not treat these two images as the same measurement condition.

| Commit | Phase |
|---|---|
| `6bf679a` | Repository preflight and source preparation |
| `2f43354` | Exit-preserving test wrapper and logs |
| `a0782b6` | Independent deliverable checks |
| `5732040` | Separately selectable completion instructions |
| `81c147d` | Docker failure controls |
| `f9f70a5` | Persistent environment-error reports |
| `97ba78a` | Pipeline failure preservation in the evaluation image |

No product-wide execution limit was increased. No book manuscript was edited and no commit was pushed by this task.
