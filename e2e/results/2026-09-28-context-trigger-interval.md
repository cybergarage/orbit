# Context trigger interval evaluation

This experiment compares the 65% budgeted-context trigger with an E2E-only 80% trigger on the same SWE-bench Verified issue, model, prompt strategy and generation settings. The production default remains 65%; the override exists only in the evaluation worker.

| Run | Trigger | First compaction | Summary time | Compaction result | Model calls | Patch / official result |
| --- | ---: | ---: | ---: | --- | ---: | --- |
| Baseline, `d142e48` | 65% (about 17,571 tokens) | iteration 35, 17,723 estimated tokens | 379.6 s across 3 requests; one request failed | 1 completed, 1 second compaction interrupted by the deadline | 106 | Empty patch; official tests skipped |
| Interval trial, `d142e48` + E2E ratio override | 80% (21,626 configured; 22,047 observed) | iteration 44, 22,047 estimated tokens | 344.0 s across 3 batches | Failed with `summary-invalid-json`; three later compactions skipped | 51 | 950-byte patch; unresolved, FAIL_TO_PASS 0/1 and PASS_TO_PASS 0/79 |

The later trigger allowed about 4,300 more estimated tokens before the first compaction, but did not reduce the cost of summarizing the accumulated conversation. That compaction required three batches and failed validation because the summary was invalid JSON. The Orbit run ended with a runtime error at the 900-second budget; the last model-generated repro command also exited with an error. The official SWE-bench 4.1.0 grader itself completed successfully and applied the patch, but the target test and all 79 recorded PASS_TO_PASS tests failed. This is an unresolved model/agent result, not a grader environment failure.

The 80% run used `ornith-1.5:9b` (digest `e5df7dcdd8a263994df62d610317e07be0d6af23f96fcbd8543273058fce575e`, Q4_K_M), 32,768 context, 4,096 output cap, seed 42, temperature 0.6, top-p 0.95, thinking disabled and `verified-focused-v1`. It evaluated `pytest-dev__pytest-10356` from SWE-bench Verified revision `c104f840cc67f8b6eec6f759ebc8b2693d585d4a`, base commit `3c1534944cbd34e8a41bc9e76818018fadefc9a1`, using harness 4.1.0 at `726c5461e2ef52d83cf1ea2107870a8bb3328d57`. The official grader image digest was `sha256:363458d4698f5d985f6476d189d3f1cf902253cd9518705fd395516cd30138da`. The host was Apple Silicon ARM64 with 4,107,141,120 bytes assigned to Docker; grading ran linux/amd64 emulation. Agent usage was 592,126 input and 15,616 output tokens, marked incomplete by the runner.

This is one run per condition. It does not establish a general success-rate difference. The useful finding is that raising the trigger alone did not solve the observed bottleneck: summary validity remains the immediate issue. Keep the 65% production default until summary behavior is made reliable, then repeat the interval comparison with multiple runs per condition.

See the [machine-readable record](2026-09-28-context-trigger-interval.json) and the unchanged official-format [prediction](2026-09-28-context-trigger-interval-predictions.jsonl). Full workspaces and logs remain in ignored `tmp/e2e/`.
