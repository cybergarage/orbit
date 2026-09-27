# SWE-bench Verified context and completion rerun

This rerun used Orbit `584c24bdde277d361873ccdaab76334b12ab122a` with a clean working tree and the current source fingerprint `51ebb19c7b864f395a22e812a908e3239b5db357ceb5fa54ad2d352e8f594321`. It repeats the prior 2×2 comparison on `pytest-dev__pytest-10356` using `ornith-1.5:9b` with the same digest, Q4_K_M quantization, 32,768 context, 4,096 output cap, seed 42, temperature 0.6 and top-p 0.95. Each solve had a 900-second limit. The official harness was SWE-bench 4.1.0 at `726c5461e2ef52d83cf1ea2107870a8bb3328d57`.

| Completion prompt | Context | Time | Model calls | Input / output tokens | Summary attempts; failed | Summary time | Compactions completed / failed | Patch | Run | Official result |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| Baseline | Disabled | 13.0 min | 54/54 | 952,003 / 14,402 | 0; 0 | 0.0 min | 0 / 0 | 9,926 B | runtime-error / failed | Grading error; patch included existing pytest cache files |
| Baseline | Enabled | 15.3 min | 30/30 | 297,489 / 16,382 | 11; 1 | 12.5 min | 0 / 0 | 2,507 B | runtime-error / incomplete | unresolved; target 0/1, existing 79/79 |
| Focused | Disabled | 7.5 min | 58/59 | 1,013,394 / 7,855 | 0; 0 | 0.0 min | 0 / 0 | 0 B | runtime-error / failed | Unresolved; empty patch skipped |
| Focused | Enabled | 15.6 min | 46/47 | 593,538 / 15,614 | 6; 1 | 10.0 min | 0 / 5 | 781 B | timeout / incomplete | unresolved; target 0/1, existing 79/79 |

The image fingerprint check passed for every solve. The budgeted baseline run emitted 11 summary attempts, with 10 responses and one failed request; summary time totaled about 749 seconds. The budgeted focused run emitted 6 attempts, with 5 responses and one failed request; summary time totaled about 598 seconds. Neither run completed a compaction checkpoint. The focused context run also recorded five failed compactions, while the current summary failure counter records only request-level failures; the diagnostics do not yet give a full reason for each rejected compaction.

The natural-language completion instruction did not yield normal completion. The focused run without context stopped with an empty patch after about 7.5 minutes. With context enabled, it reached the Run deadline and produced a 781-byte patch. Neither resolved the issue. The two nonempty patches that completed official testing passed all 79 PASS_TO_PASS tests and failed `testing/test_mark.py::test_mark_mro`.

The baseline/context-disabled prediction was rejected during patch application because it included generated `.pytest_cache` files that already existed in the grader image. The empty focused/context-disabled prediction was recorded as skipped. Thus the result is 0/4 resolved; two predictions were fully graded as unresolved, one was skipped as empty, and one had a patch-application grading error.

One preliminary attempt used the Node-only base image and stopped during preflight before any model call; it is excluded from the table. Each condition ran once, so these results are diagnostic. Full logs, event streams, and workspaces remain under ignored `tmp/e2e/verified/pytest-dev__pytest-10356/`.

Official-format predictions:
- [baseline-context-off](2026-09-27-context-completion-rerun-baseline-context-off-predictions.jsonl)
- [baseline-context-on](2026-09-27-context-completion-rerun-baseline-context-on-predictions.jsonl)
- [focused-context-off](2026-09-27-context-completion-rerun-focused-context-off-predictions.jsonl)
- [focused-context-on](2026-09-27-context-completion-rerun-focused-context-on-predictions.jsonl)
