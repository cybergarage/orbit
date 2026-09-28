# Real-model reevaluation: context-summary recovery

This run reevaluated the summary recovery fix in Orbit `d142e48e9968d72335c5115eb56b25360ab2c7c0`. It used the same issue, model digest, prompt strategy, budgeted context policy and generation settings as the September 27 focused v1 baseline. The SWE-bench instance is `pytest-dev__pytest-10356`, from Verified revision `c104f840cc67f8b6eec6f759ebc8b2693d585d4a`, at base commit `3c1534944cbd34e8a41bc9e76818018fadefc9a1`.

| Run | Summary requests / failures | Summary time | Compactions completed | Model calls | Patch | Official outcome |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Sep 27 baseline, commit `66610dc` | 6 / 1 | 568.8 s | 0 | 41 | 1,370 B | Unresolved; target 0/1, PASS_TO_PASS 73/79 |
| Sep 28 fix, commit `d142e48` | 3 / 1 | 379.6 s total | 1 | 106 | Empty | Unresolved; empty patch recorded, tests skipped |

The first compaction succeeded after two batches in 248.2 seconds. It reduced the prepared request estimate from 17,723 to 4,459 tokens. Both requests completed without an output-length stop, and the run emitted one `context.compaction.completed` event. The earlier baseline spent 568.8 seconds in summary requests and did not complete any compaction. In this run the first usable checkpoint arrived sooner.

The agent continued working and accumulated 106 model calls, compared with 41 in the baseline. It reached the run deadline while starting a second compaction: the second summary request ran for 131.6 seconds, was cancelled at the 900-second deadline, and no patch remained in the workspace. Faster initial compaction made room for more work, while later context growth still required another summary. The issue remained unresolved within the time budget.

The official SWE-bench 4.1.0 harness completed successfully with exit code 0 and recorded the prediction as `empty_patch`; it did not run the test suite. This is an unresolved model run, not an evaluation-environment error. Independent patch quality was not measured because no patch was produced.

The model was `ornith-1.5:9b`, digest `e5df7dcdd8a263994df62d610317e07be0d6af23f96fcbd8543273058fce575e`, Q4_K_M, 32,768 context, 4,096 output cap, seed 42, temperature 0.6, top-p 0.95 and thinking disabled. The host was Apple Silicon ARM64 with Docker memory 4,107,141,120 bytes; the SWE-bench image ran as linux/amd64 emulation.

This is one run per code revision, so it does not establish general time savings or higher solve rates. Full metrics and event summaries are in the [JSON record](2026-09-28-context-summary-reevaluation.json); the submitted official-format prediction is [here](2026-09-28-context-summary-reevaluation-predictions.jsonl). Full workspaces remain under ignored `tmp/e2e/verified/pytest-dev__pytest-10356/`.
