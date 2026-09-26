# Context management and completion instructions: controlled rerun

This rerun holds Orbit revision, model, problem, generation settings, Docker image, and deadline constant across a 2×2 comparison. The Orbit commit was `94a3a16d5e502ecec1adf69d03b886f4bdeb287c`. The single SWE-bench Verified instance was `pytest-dev__pytest-10356`, from dataset revision `c104f840cc67f8b6eec6f759ebc8b2693d585d4a`, at base commit `3c1534944cbd34e8a41bc9e76818018fadefc9a1`. The official harness was version 4.1.0 at `726c5461e2ef52d83cf1ea2107870a8bb3328d57`.

All runs used `ornith-1.5:9b` Q4_K_M (digest `e5df7dcdd8a263994df62d610317e07be0d6af23f96fcbd8543273058fce575e`) with Ollama 0.34.3; context 32,768; output limit 4,096; seed 42; temperature 0.6; top-p 0.95; and a 900-second Run deadline. Docker Desktop had 4GB configured. The Verified solver image was `sha256:ed48353ef872730f67ae451f78b4a90108b11691953a5077ab68a4d7101ed4e0`; the pinned official grading image was `sha256:363458d4698f5d985f6476d189d3f1cf902253cd9518705fd395516cd30138da`.

| Completion prompt | Context policy | Time | Model calls; input/output tokens | Patch | Run result | Official SWE-bench result |
| --- | --- | ---: | ---: | ---: | --- | --- |
| Baseline | Disabled | 349s | 23; 250,722 / 6,822 | 1,012 bytes | Runtime error; failed | Unresolved; target 0/1, existing tests 79/79 |
| Baseline | Budgeted | 912s | 36; 471,903 / 16,777 | 941 bytes | Runtime error; incomplete | Unresolved; target 0/1, existing tests 0/79 |
| Focused completion | Disabled | 913s | 66; 1,068,829 / 14,962 | 5,435 bytes | Runtime error; incomplete | Unresolved; target 0/1, existing tests 79/79 |
| Focused completion | Budgeted | 934s | 79; 769,620 / 14,572 | 1,404 bytes | Deadline; incomplete | Unresolved; target 0/1, existing tests 0/79 |

Every patch applied in the official environment, but none passed `testing/test_mark.py::test_mark_mro`. In the context-enabled arms, the generated partial patches caused test-collection errors: the baseline patch raised `TypeError: 'bool' object is not iterable`, and the focused-completion patch raised `AttributeError: 'function' object has no attribute '__mro__'`. As a result, all 79 PASS_TO_PASS checks failed in each of those two arms. The focused prompt without context management retained 79/79 existing tests, but added six `.pytest_cache` files and did not finish normally.

The controlled result does not show a completion benefit from either setting. The context policy reduced input tokens for the focused-prompt run by about 28% compared with its disabled counterpart, but made more model calls, still timed out, and produced a patch that broke test collection. With the baseline prompt, enabling context management increased input tokens in this trial because the run lasted much longer; its patch also broke collection. The focused completion instruction did not prevent continued tool/model cycles or produce a normal completion.

There is a separate observability defect: context-enabled event logs contain summary requests, while their run metadata records zero summary attempts and failures. That makes current compaction counters unsuitable for comparing summary cost. The containers used roughly 110–130MiB of their 3.825GiB limit, so Docker memory pressure did not explain these outcomes.

This is one trial per condition on one issue, so it is diagnostic rather than a general model-quality estimate. The raw, official-format predictions are linked here: [baseline/context disabled](2026-09-27-context-completion-controlled-baseline-context-off-predictions.jsonl), [baseline/context enabled](2026-09-27-context-completion-controlled-baseline-context-on-predictions.jsonl), [focused/context disabled](2026-09-27-context-completion-controlled-focused-context-off-predictions.jsonl), [focused/context enabled](2026-09-27-context-completion-controlled-focused-context-on-predictions.jsonl). The detailed values are in [JSON](2026-09-27-context-completion-controlled.json). Full solver workspaces, conversations, and harness logs remain under ignored `tmp/e2e/verified/pytest-dev__pytest-10356/`.

## Orbit follow-up

The direct evaluation findings are that the model's context-enabled partial patches broke test collection and that the summary-attempt counters do not reflect summary requests. The former is a generated-patch quality failure; it does not by itself show an Orbit runtime defect. The telemetry mismatch is an Orbit measurement issue to investigate. The completion instructions need an additional check that enforces the verified finish condition; their current text alone does not stop exploration. These runs reached the model and official harness, and their patches were unresolved rather than environment failures.
