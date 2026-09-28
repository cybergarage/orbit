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

A separate 65% budgeted-context solve and official grade are recorded here after completion. The fixed-case semantic checks above are not applied to new solver history with different evidence IDs.
