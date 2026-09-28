# Test evidence in summaries — 2026-09-28

## Outcome — 2026-09-29

Four instruction variants were tried; none is accepted as an overall improvement. Each comparison used the same fixed source and unchanged independent grader, one real model request per condition. Baselines consistently failed unsupported behavioral-success claims. Some candidates removed that claim but introduced missing/stale test observations, wrong saved state/path, mixed test outcomes or missing source IDs. Runtime prompt changes are restored to the pre-task version rather than shipping those regressions. The replay driver retains support for reproducing historical post-source review variants; no public API, persistence schema or iteration-limit change remains.

| Candidate | Saved edit | Latest test / remaining work | Unsupported success | Overall |
| --- | --- | --- | --- | --- |
| `b3026e6` | Pass | Needs review | Needs review | Needs review; manual rejection |
| `598f2b8` | Fail | Fail | Pass | Fail |
| `e3561fc` | Fail | Fail | Pass | Fail |
| `516a2d5` | Not scored | Not scored | Not scored | Fail: missing test source IDs |

These trials are not independent representative benchmark samples: they reuse one history to diagnose a known failure. No SWE-bench solver/official grading run was repeated in this task. Full-suite and narrow unit-test success validates implementation mechanics, not model semantic correctness.

## First focused attempt

Prompt `b3026e6` distinguishes observed execution from behavioral verification and explicitly warns that an empty passing test or a test name does not prove a feature. This is a local instruction change; no public API, checkpoint schema, stopping rule or dependency changes, so no ADR is required. Unit validation passed: 47 context-compaction tests, 11 fixed semantic tests, headers check, build and 1,038 full-suite tests.

The same committed source fixture and unchanged grader were replayed once per condition with `ornith-1.5:9b`, Q4_K_M, context 32,768, output cap 2,048, seed 42, temperature 0.6, top_p 0.95, thinking disabled, JSON mode. Baseline `1a69535`: fail (111.2 s, saved edit/latest test pass, unsupported success fail). Candidate `b3026e6`: needs-review (122.2 s, saved edit pass, two other checks need review). Both responses completed as valid JSON without unknown source IDs.

Source review does not accept the candidate as faithful: it removed the recognized unsupported-success statement, but omitted later passing/deselected test runs and left an earlier collection error as the only test. It also confused incomplete behavioral verification with no test having run. The grader was not loosened to turn this into pass. Original outputs, exact prompt hashes, fixture/source hashes, model digest and evidence are preserved in [JSON](2026-09-28-context-test-evidence-followup.json). Requests/responses remain in ignored `tmp/e2e/context-test-evidence-20260928/`.

This is a fixed-history diagnostic, not a SWE-bench solve or a general semantic-accuracy estimate. The next iteration must preserve actual observations even when assertion coverage is unknown.

## Second attempt and budget correction

Adding more preservation instructions made one narrow and full-suite budget test fail before any model request. The 3,423-character instruction exceeded the synthetic 8,000-character window. This draft was not committed. Instructions were consolidated to 2,766 characters without changing budgets or the grader; commit `598f2b8` passed 47 narrow tests, 11 semantic tests, headers/build and 1,038 full-suite tests.

The second live comparison still rejected the candidate: baseline `1a69535` failed unsupported success again (112.6 s); candidate `598f2b8` passed that check but failed saved-edit and latest-test/remaining-work checks (124.3 s). It called confirmed saved edits unsaved and repeated a misleading explanation of deselection. Both complete JSON outputs had valid source IDs. This candidate is not treated as a successful overall improvement. The next trial restores the earlier main instructions and adds a concise review after the serialized source, so raw observations can override the stale checkpoint before the model returns its draft.

## Post-source review — 2026-09-29

Commit `e3561fc` restored the original main instructions and placed a brief consistency check after the untrusted serialized source. The replay driver now reads the optional review instruction from each tested Git ref and reproduces its placement; its mock integration test checks placement and continued isolation of grader-only expectations. Validation passed: 47 context tests, 11 semantic tests, headers/build, 1,038 full-suite tests. No source data, grader or output schema changed.

Live baseline: fail, 66.6 s. Candidate: fail, 85.5 s. The candidate passed noUnsupportedSuccess and retained later observations, but misspelled the changed path (`markers.py` instead of `structures.py`) and combined passing/deselected results into an item labeled passed. Manual review also found a conflicting claim that no post-save test ran. The source hashes stayed identical across these trials. This is not an overall semantic pass, and timings are not a speed claim. A further local review instruction will require exact observed paths and separate outcomes for distinct commands/filters.

## Separate path / test observations — 2026-09-29

Commit `516a2d5` required exact observed paths and one outcome per command/filter. Narrow tests (47), semantic tests (11), headers and build passed. Live baseline: fail, 69.8 s. Candidate: fail, 77.4 s: its JSON was complete and parseable but both test items omitted mandatory sourceIds. Semantic checks were not scored through a shape failure. A historical test item still claimed an edit was unsaved. Valid JSON is again insufficient for schema or semantic correctness.

## Reproduction and next design question

```sh
npm run test:e2e:summary
npm run eval:context-summary -- --baseline-ref 1a69535 --candidate-ref b3026e6 --output tmp/e2e/test-evidence-first-repeat
npm run eval:context-summary -- --baseline-ref 1a69535 --candidate-ref 516a2d5 --output tmp/e2e/test-evidence-last-repeat
```

The updated driver reads both the main instructions and optional FINAL_REVIEW from each specified Git ref. The fixed fixture and grader are unchanged. Full requests/responses remain locally in the four `tmp/e2e/context-test-evidence-*` directories; generated summaries, hashes and grading evidence are committed in JSON. Expected grading facts never go to the model.

Further prompt-only tuning on this history cannot establish reliable semantic preservation. A next design investigation should consider preserving structured edit/test observations independently of model-authored summaries, and distinguishing test execution from assertion coverage. Arbitrary shell output cannot automatically prove a behavior; explicitly reported observations should retain their source evidence and unknown coverage. This is a proposal, not an implemented guarantee. A change to checkpoint persistence or public tool contracts would need an ADR before implementation. Broader histories and real solve tests are still required before claiming general improvement.

## Final disposition

Runtime source, context-compaction tests and feature documentation were restored
byte-for-byte to pre-task commit `8b06209` by dedicated revert commit `fea9330`.
Historical trial commits remain available without rewriting history. The net
implementation addition is replay support for historical final-review prompts,
with model-input isolation covered by the deterministic integration test.

Final restored-state validation passed: 11 semantic evaluator/driver tests,
headers check, build and 1,038 full-suite tests. No book files were changed,
no iteration cap was added and no push was performed.
