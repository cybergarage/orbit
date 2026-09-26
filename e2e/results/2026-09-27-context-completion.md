# Context management and completion instructions: SWE-bench comparison

This diagnostic compares Orbit's budgeted context policy and the focused completion prompt in a 2×2 design on one SWE-bench Verified instance. The task was `pytest-dev__pytest-10356` at base commit `3c1534944cbd34e8a41bc9e76818018fadefc9a1`. The dataset revision was `c104f840cc67f8b6eec6f759ebc8b2693d585d4a`; the official SWE-bench harness was 4.1.0 at `726c5461e2ef52d83cf1ea2107870a8bb3328d57`.

The test used `ornith-1.5:9b` (Q4_K_M, digest `e5df7dcdd8a263994df62d610317e07be0d6af23f96fcbd8543273058fce575e`) through Ollama 0.34.3. All runs used a 32,768-token context, 4,096 output-token limit, seed 42, temperature 0.6, top-p 0.95 and a 900-second deadline. Docker Desktop was configured for 4GB. The agent image was `sha256:0a98d31d5280fe201f217e85379a9fed07371d7a1038b9863e86e2fae5f8af1d`; official grading ran the pinned linux/amd64 image under Apple Silicon emulation.

| Completion prompt | Context policy | Orbit commit | Runtime result | Official patch result | Model calls; input/output tokens |
| --- | --- | --- | --- | --- | --- |
| Baseline | Disabled | `0570913` | Runtime error at 587s; 63 completed calls; 3.4KB patch | Grading error: generated cache artifacts prevented patch application; no official test result | 63; 1,194,837 / 9,873 |
| Baseline | Budgeted | `0570913` | Deadline at 936s; 36 completed calls; empty patch | Empty patch recorded; tests skipped | 36; 474,326 / 15,282 |
| Focused completion | Disabled | `0570913` | Runtime error at 794s; 72 calls; 120.8KB patch | Unresolved: patch applied, 0/1 FAIL_TO_PASS; 79/79 PASS_TO_PASS | 72; 1,492,438 / 10,983 |
| Focused completion | Budgeted | `f654787` | Deadline at 935s; 48 calls; 2.7KB partial patch | Unresolved: patch applied, 0/1 FAIL_TO_PASS; 79/79 PASS_TO_PASS | 48; 586,955 / 16,662 |

The focused completion prompt alone did not make the model stop after its initial investigation and regression work. In the context-disabled run it continued exploring, accumulated generated cache files, and ended with a very large patch. The budgeted context runs used fewer input tokens and fewer model calls, but neither produced a passing solution before the deadline. Both scored unresolved; for the focused+context run the patch applied cleanly but the target test `testing/test_mark.py::test_mark_mro` still failed. A reduction in context tokens is not evidence of improved task completion here.

The results also expose a measurement issue: event logs show lengthy summary requests, while run metadata reports zero compaction attempts for the latest run. The context policy's behavior and telemetry need closer inspection before treating its current counters as trustworthy. Docker stayed well below its memory limit during the final run, so the 4GB setting did not cause the timeout.

This is one attempt per condition and not statistically conclusive. Three arms used Orbit commit `0570913`; the latest focused+context run used `f654787`, so the full matrix is not revision-controlled. The newest Orbit revision was exercised, but only in that one condition. Repeat all four arms at the same commit before attributing differences to context or prompt settings.

The four unmodified official-format predictions are linked here: [baseline/context disabled](2026-09-27-context-completion-baseline-context-off-predictions.jsonl), [baseline/context enabled](2026-09-27-context-completion-baseline-context-on-predictions.jsonl), [focused/context disabled](2026-09-27-context-completion-focused-context-off-predictions.jsonl), [focused/context enabled](2026-09-27-context-completion-focused-context-on-predictions.jsonl). The compact run data is in [JSON](2026-09-27-context-completion.json). Full conversations, solve workspaces, and harness logs remain in ignored `tmp/e2e/verified/pytest-dev__pytest-10356/`.

## Orbit follow-up

The results do not support loosening or removing the completion requirement. They suggest two targeted follow-ups: make focused completion checks observe the explicit completion condition before more exploration, and inspect the budgeted context policy's repeated summary behavior and missing compaction counters. The latter is a local implementation and observability issue worth fixing and retesting; changes to cross-cutting public behavior should follow Orbit's existing ADR workflow.
