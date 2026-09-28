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

Do not tune the trigger interval from this three-run sequence: the 65% results changed both implementation and context batch behavior, and the 80% arm yielded no patch. First identify the 21 tool errors from the latest run and determine why the patch broke baseline tests; then rerun the same 65% condition after any localized fix. Retain the summary timing and validation metrics so context stability remains separately observable from task success.
