# Context summary stability follow-up — 2026-09-28

## Findings

Constraining summary calls to JSON eliminated invalid-JSON and schema-validation failures in these three runs. It did not make summarization fast: before smaller initial batches, the 65% run spent 675.1 seconds in six summary attempts and did not complete compaction. Starting with quarter-sized batches reduced the first successful compaction to 500.7 seconds (five attempts), shrinking estimated context from 17,842 to 4,588 tokens. The agent then continued, but the 900-second run budget expired before normal completion.

The latest patch was 1,675 bytes and applied, but official grading did not resolve the issue: the target `testing/test_mark.py::test_mark_mro` failed, as did the 79 PASS_TO_PASS tests. There were 21 tool errors and three repeated failed model calls. This is a regression in patch quality versus the prior 65% JSON run, which passed all 79 PASS_TO_PASS tests but also failed the target. The 80% run produced an empty patch. Therefore these changes improve summary format validity and allow compaction to finish, but do not yet improve SWE-bench task resolution; the latest run also shows a separate need to investigate tool-error causes and resulting patch damage.

## Runs

All runs used SWE-bench Verified `test`, revision `c104f840cc67f8b6eec6f759ebc8b2693d585d4a`, instance `pytest-dev__pytest-10356`, base commit `3c1534944cbd34e8a41bc9e76818018fadefc9a1`, and harness 4.1.0 (`726c5461e2ef52d83cf1ea2107870a8bb3328d57`). The model was `ornith-1.5:9b`, digest `e5df7dcdd8a263994df62d610317e07be0d6af23f96fcbd8543273058fce575e`, Q4_K_M; Ollama 0.34.3; `num_ctx=32768`, `num_predict=4096`, seed 42, temperature 0.6, top_p 0.95, thinking disabled. Each solve had a fresh workspace/Session and a 900-second wall-clock limit. The model's prompt and target repository were held constant. These are diagnostic single runs, not a benchmark estimate.

| Context trigger / implementation | Orbit commit | Patch | Summary attempts / failures | Summary time | Compaction | Official result | Agent result |
| --- | --- | ---: | ---: | ---: | --- | --- | --- |
| 80%, JSON constraint, before smaller-batch change | `55d74e3` | empty | 5 / 1 transport failure; 0 validation failures | 477.5 s | 0 completed | Empty patch skipped; no tests run | Deadline, 49 completed model calls |
| 65%, JSON constraint, before smaller-batch change | `55d74e3` | 1,361 bytes | 6 / 1 transport failure; 0 validation failures | 675.1 s | 0 completed | Unresolved; target failed, 79/79 PASS_TO_PASS passed | Deadline, 38 completed model calls |
| 65%, JSON constraint + quarter-sized initial batches | `02ff86a` | 1,675 bytes | 5 / 0; 0 validation failures | 500.7 s | 1 completed, estimated 17,842 → 4,588 tokens | Unresolved; target failed, 0/79 PASS_TO_PASS passed | 49 completed model calls; 21 tool errors; deadline/budget stop |

The 80% run used a separate E2E-only trigger override; the production default remained 65%. Run duration can differ slightly from the configured 900 seconds because cleanup and grading occur outside the solver budget. The first two summaries' transport failures were classified as summary-call failures, not invalid JSON. Model token usage was incomplete for each run because the solver stopped at its time budget.

## Evidence and reproduction

The official-format submissions are preserved byte-for-byte in the linked JSONL files. Full workspaces, console logs, source snapshots, and harness outputs remain under ignored `tmp/e2e/verified/pytest-dev__pytest-10356/`; they are intentionally not committed. Run metadata and compact outcomes are in [the JSON summary](2026-09-28-context-summary-stability-followup.json). See the [evaluation guide](../../docs/e2e-evaluation.md) for the command sequence and regrading steps. Reproduction requires the recorded dataset/harness revisions, model digest and generation settings, and matching Docker image; use the per-run `metadata.json` in the local evidence directory for full preparation details.

## Next investigation

Do not tune the trigger interval from this three-run sequence: the 65% results changed both implementation and context batch behavior, and the 80% arm yielded no patch. The classification below identifies the 21 tool errors and the collection failure behind the baseline-test failures. Validate semantic preservation of confirmed edits before rerunning the same 65% condition after a localized improvement. Retain the summary timing and validation metrics so context stability remains separately observable from task success.

## Tool-error classification follow-up

All 21 tool errors in the latest run were `bash` commands returning nonzero status. There were no tool timeouts, truncated tool outputs, invalid tool arguments, failed edits, or dispatch/transport failures in this set. Nine occurred before compaction and twelve after it. The observed exit handling matches `createBashTool` and `resolveShell` in `src/core/tools/builtins/bash.ts`: Bash uses `-e -o pipefail`, and a nonzero exit is returned as `isError`. These failures do not establish a Bash runtime defect.

| Category | Count | Error numbers | Interpretation |
| --- | ---: | --- | --- |
| Expected initial bug reproduction | 1 | 1 | Assertion failed because `bar` was missing. This is useful diagnostic evidence. |
| Incorrect generated test path | 1 | 2 | `/tmp/repro/repro/` duplicated the directory name. |
| Output filter found no match | 3 | 3, 15, 16 | `grep` returned 1; filtered output obscured the underlying pytest result. |
| Candidate patch caused collection errors | 4 | 4–7 | First attempted to hash `Mark`; next key included a dictionary. Both caused `TypeError`. |
| No tests selected | 8 | 8–14, 17 | `-m bar` deselected the only test, pytest returned 5, and errexit stopped subsequent commands. |
| Incorrect generated diagnostic code | 4 | 18–21 | Wrong constructor arguments, nonexistent module attribute, then integer IDs treated as Mark objects. |

[The classification JSON](2026-09-28-tool-error-classification.json) preserves each error number, iteration, timestamp, message ID, exit code, phase, and observation. The model repeatedly piped tests through `grep`/`tail` rather than using the instructed `orbit-test` wrapper. Under `-e -o pipefail`, even `echo RC=$?` or `echo RC=${PIPESTATUS[0]}` after a failing command was skipped. This accounts for the repeated output-inspection failures; silently weakening Bash failure handling would hide test failures rather than repair the model's test strategy.

### Patch damage and checkpoint fidelity

The model successfully saved three edits at iterations 15, 21 and 25. All three preceded compaction. Read-back commands and collection traces confirm the workspace had changed. The final submitted patch uses `type(obj).__mro__` rather than the class object's MRO, so the custom `bar` selection still found no tests. Its deduplication key converts kwargs items to a tuple but still embeds potentially unhashable argument values. Official grading aborted collection with `TypeError: unhashable type: 'list'` in `_add`. The harness marked the target and all 79 PASS_TO_PASS tests failed; these are collection failures, not 79 independently observed assertion regressions.

The completed checkpoint nevertheless says the edit was "never saved to disk" and "No fix was implemented or saved". Its cited successful edit message at iteration 15 contradicts that claim, and later successful edits were also present in the compressed source. The summary also records the incomplete MRO interpretation as a fact. This is a semantic fidelity defect in the generated summary even though JSON parsing and schema validation succeeded. The logs do not prove this defect caused the incorrect patch: the submitted edits already existed before compaction. It could impair recovery from the existing failure; that needs a controlled test.

### Recommended next step after classification

Prioritize a deterministic replay of this saved-edit/failed-test history to check whether compaction preserves the latest confirmed file state, failed test evidence and remaining work. Use the observed contradictory checkpoint as a regression fixture before changing summary generation. Then compare the real model on the same history and, after a localized improvement, rerun the 65% SWE-bench condition. Evaluate semantic fidelity separately from JSON validity and elapsed time. Keep Bash's nonzero exit reporting: the observed commands failed for identifiable target-code or diagnostic reasons.

This follow-up inspected stored solver and official grading evidence and the current Bash source. It did not execute a new model run, modify runtime behavior, or claim a demonstrated cause from the before/after sequence. The result JSONL remains unchanged.
