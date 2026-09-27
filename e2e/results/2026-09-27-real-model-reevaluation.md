# Real-model reevaluation: pytest Verified 10356

This reevaluation used the latest Orbit commit `66610dc5090ef7bf4bd374e416d509a0d421ce66` and the local `ornith-1.5:9b` model. Both attempts ran against the same SWE-bench Verified instance, `pytest-dev__pytest-10356`, with a 900-second solve deadline and the official SWE-bench 4.1.0 grader.

This is a diagnostic comparison, not a controlled prompt-only experiment: the v1 arm used `verified-focused-v1` with budgeted context, while v2 used `verified-focused-v2` with context disabled. Each arm ran once. The completion prompt and context policy changed together, so the results cannot isolate either change.

| Condition | Context | Time | Model calls | Tool calls / errors | Summary attempts / failures | Summary time | Compactions completed | Patch | Agent outcome | Official result |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Focused v1 | Budgeted | 15.4 min | 41 | 35 / 8 | 6 / 1 | 9.5 min | 0 | 1,370 B | Runtime error; incomplete at deadline | Unresolved; target 0/1, PASS_TO_PASS 73/79 |
| Focused v2 | Disabled | 15.4 min | 82 | 81 / 35 | 0 / 0 | 0 | 0 | 2,141 B | Runtime error; incomplete at deadline | Unresolved; test collection failed, PASS_TO_PASS 0/79 |

The v1 patch applied cleanly. It failed the requested `testing/test_mark.py::test_mark_mro` case and six existing tests. Its event stream records six summary attempts, five successful responses and one failed request. Summary work consumed 568,784 ms, and the run ended without completing compaction. This indicates that summarization overhead remains large for this model and case; it does not test the invalid-summary cooldown because no summary validation failure was recorded.

The v2 run made more exploration calls and had 35 tool errors. Its patch applied, but introduced a collection-time `TypeError: got None instead of Mark`; the target did not pass and no existing tests passed. The agent kept exploring until the time limit despite the stronger natural-language completion instruction. This supports treating completion as a control-flow/API behavior to evaluate, rather than relying on wording alone.

Both official harness runs completed in the pinned grading environment. The failure class is therefore an unresolved or faulty generated patch, not a SWE-bench setup failure. Independent patch-quality checks were not measured. Usage accounting is incomplete in both runs.

The model was `ornith-1.5:9b`, digest `e5df7dcdd8a263994df62d610317e07be0d6af23f96fcbd8543273058fce575e`, Q4_K_M, with 32,768 context, 4,096 output limit, seed 42, temperature 0.6, top-p 0.95 and thinking disabled. The host was Apple Silicon ARM64 with Docker memory set to 4,107,141,120 bytes; the official test container used linux/amd64 emulation. Dataset revision: `c104f840cc67f8b6eec6f759ebc8b2693d585d4a`. Harness commit: `726c5461e2ef52d83cf1ea2107870a8bb3328d57`.

These runs give two concrete Orbit improvement areas to pursue: make context summarization stop or fall back predictably when requests are slow or fail, and make completion an enforceable run-state transition. The comparison does not establish that either recent change caused the observed outcomes. A next evaluation should vary one factor at a time and repeat each condition.

Full machine-readable metrics: [JSON](2026-09-27-real-model-reevaluation.json). Official-format submitted patches: [focused v1](2026-09-27-real-model-v1-predictions.jsonl), [focused v2](2026-09-27-real-model-v2-predictions.jsonl). Full logs and solver workspaces remain under ignored `tmp/e2e/verified/pytest-dev__pytest-10356/`.
