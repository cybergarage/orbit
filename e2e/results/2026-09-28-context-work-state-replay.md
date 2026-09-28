# Confirmed work-state summary replay — 2026-09-28

## Change and scope

The summary prompt now gives later observed tool results priority over earlier plans, assistant claims and stale checkpoint statements. Successful edit/write results establish that an edit was saved; failing tests do not undo it. Summaries must retain latest test outcomes and remaining verification, reconcile contradictions in every category, and avoid inferring untested behavior from passing commands. The versioned summary shape, public API, checkpoint storage and failure policy are unchanged. This is a localized prompt correction and regression-test addition within the existing compaction design; no ADR is required for this scope.

The unit regression supplies an earlier passing test, a successful edit and a later collection failure. It checks that raw edit/result groups are supplied to the summarizer, that the updated work-state rules are present, and that an evidence-backed model fixture's saved edit, failed test and remaining retest survive checkpoint validation/projection. This deterministic fixture tests the request/checkpoint path, not a real model's semantic accuracy.

## Real-model diagnostic

The source was drawn from the existing `pytest-dev__pytest-10356` solver history: original user messages and assistant/tool messages at iterations 15, 16, 21, 22, 23, 25, 26 and 27. The incorrect saved checkpoint was deliberately supplied alongside these original successful edits and subsequent test observations. This is a focused stale-checkpoint reconciliation scenario, **not** a reproduction of the original production batches or a new SWE-bench solve. It contains only solver-side public evidence; official grading data was not supplied to the model.

Each prompt variant received exactly the same source. The before prompt is from `4eb5701`, the first fix is `499a7ed`, and the final refinement (`1a69535`) additionally requires contradiction removal across all categories and limits success claims to actually exercised assertions. The local model was `ornith-1.5:9b`, Q4_K_M, digest `e5df7dcdd8a263994df62d610317e07be0d6af23f96fcbd8543273058fce575e`, Ollama **0.34.4**. Settings: context 32,768, output cap 2,048, seed 42, temperature 0.6, top_p 0.95, thinking disabled, JSON output. There was one request per variant.

| Variant | Elapsed | Input/output tokens | Saved-edit state | Latest bar-selection observation | Remaining defect |
| --- | ---: | ---: | --- | --- | --- |
| Before | 102.5 s | 18,403 / 1,463 | Incorrect: says never saved / nothing implemented | Missing from retained test/unfinished state | Repeats stale checkpoint |
| Initial fix | 121.9 s | 18,536 / 1,732 | Correct in changedPaths; stale unsaved claim remains in tests | Retained as uncertainty and work to verify | Claims both markers passed without an assertion proving it |
| Final refinement | 107.0 s | 18,587 / 1,473 | Correct; unsupported unsaved claims removed | Separately records failed bar selection and need to verify it | Still says both markers were verified by a passing empty test |

All three outputs passed Orbit's production `validateSummary` shape and source-ID validation. Manual review against the original successful edit results and test outputs found the differences above. The final variant states that the edit was saved and retains the actual failed bar selection and outstanding existing-test/regression checks. It still overinterprets the unasserted passing test as evidence that both markers worked. Thus the observed saved-state contradiction is corrected in this replay, while **semantic fidelity remains incomplete**. The recorded excerpts are untrusted generated output, not verified descriptions of correct pytest behavior.

These requests do not establish general model reliability, task-resolution improvement or a performance improvement. Input/output sizes changed with the prompt and response, and a fixed seed does not make different requests equivalent. No new solver patch or official grade was produced.

## Reproduction and validation

Keep the local solver log directory, then run the committed focused driver from the Orbit repository:

```sh
python3 e2e/context-summary-work-state-replay.py \
  tmp/e2e/verified/pytest-dev__pytest-10356/solve-ornith-1.5-9b-2e0a1805-fa4b-4d83-b5ff-e35e160512c8 \
  --baseline-ref 4eb5701 --candidate-ref 1a6953598808318401443574a2fcab1661f268b5 \
  --output tmp/e2e/summary-work-state-rerun
```

The driver reads the source log and checkpoint, extracts the same message groups, and invokes the pinned prompt variants through localhost Ollama with the recorded settings. It writes source, request/response and timing/token records under the chosen ignored output directory. Inspect generated statements against the raw evidence; the driver's JSON/source-ID checks alone are not semantic grading. The original solver logs and full prompts are kept locally under ignored `tmp/e2e/`; this repository does not distribute them. Without those logs, the deterministic unit fixture can still be run.

Implementation validation: headers check, build and full unit suite passed for the initial fix (1,038 tests); the focused context suite passed (47 tests). The final refinement also passed headers check, build and all 1,038 tests; two synthetic budget fixtures were adjusted to allow for the longer prompt without changing product limits. The replay driver is checked with Python compilation, `--help`, and an offline smoke that verifies its request bodies and source digest match the measured inputs. Details, prompt hashes, source digest, and unedited generated summaries are in [the JSON record](2026-09-28-context-work-state-replay.json).

A next semantic regression should distinguish test-process success from the behavior actually asserted and require consistency across descriptions of the same saved edit. An independent checker or deterministic work-state representation would require separate design consideration; this change does not claim to enforce arbitrary prose truthfulness.
