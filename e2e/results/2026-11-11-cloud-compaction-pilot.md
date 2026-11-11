# Cloud compaction benchmark pilot — 2026-11-11

This calibration verifies cloud execution, official grading and provider-usage accounting. It does not establish EoCC/SAC superiority or reproduce the paper's model-level results. The two tasks were previously used for local development; they are not held-out evidence.

Implementation: [PR #30](https://github.com/cybergarage/orbit/pull/30), Orbit `c98bde8b4c8eda7ed2e91a0618ae75ac10e965ce`. The [complete ledger](2026-11-11-cloud-compaction-pilot.json) records pinned sources, event hashes, all planned slots, runtime outcomes, cache usage and summary overhead.

## Protocol and controls

- Two distinct tasks: Terminal-Bench 2.1 `cancel-async-tasks` and SWE-bench Verified `pytest-dev__pytest-10051`.
- Explicit models: OpenAI `gpt-4o-2024-08-06` and Anthropic `claude-opus-4-6`. These differ from the paper comparison and from the earlier local models.
- Four arms: FHA (full history), Orbit suffix, EoCC/structured and SAC/structured; one attempt per cell, 16 planned executions. Model defaults apply to sampling; the local seed option does not create cross-provider matched seeds.
- Shared baseline execution strategy and single-action mode; context window 32,768, trigger 12,288, target 8,192, output cap 4,096. FHA has no compaction trigger; its native provider context limit still applies.
- Limit: 16 total model calls, including summaries; 180 seconds for Terminal-Bench and 300 seconds for SWE-bench. Serial fixed order, no outcome-dependent tuning, no model retries.
- Between-trial observed-cost stop at $20 and stop on incomplete accounting. This is not a provider-side hard billing cap.
- Fresh native controls passed: Terminal-Bench oracle reward 1, no-op reward 0, SWE-bench reference patch resolved. Official verifiers remain separate from the solver.
- Linux/amd64 Docker emulation on an ARM64 host. Worker durations exclude environment setup and official grading; end-to-end wall durations include those costs in time, not money.

The committed [protocol](../cloud-pilot.json), [runner guide](../../docs/e2e-evaluation.md#cloud-benchmark-runs), and ledger specify the experiment. Raw workspaces, submitted predictions, verifier outputs and provider events remain under ignored `tmp/e2e/`; hashes preserve their identity.

## Outcomes

Official pass/fail is distinct from Orbit completion. A budget-stopped run may leave a passing patch; normal completion may leave an incorrect artifact. Empty patches remain unresolved.

| Provider  | Suite          | Arm             | Official pass | Runtime         | Calls (summary) | Commits | List cost USD |
| --------- | -------------- | --------------- | ------------- | --------------- | --------------: | ------: | ------------: |
| openai    | terminal-bench | fha             | yes           | completed       |           3 (0) |       0 |      0.006760 |
| openai    | terminal-bench | suffix          | no            | completed       |           3 (0) |       0 |      0.006360 |
| openai    | terminal-bench | eocc-structured | no            | completed       |           8 (0) |       0 |      0.027885 |
| openai    | terminal-bench | sac-structured  | no            | completed       |           9 (4) |       4 |      0.047407 |
| openai    | swe-bench      | fha             | no            | budget-exceeded |          16 (0) |       0 |      0.228017 |
| openai    | swe-bench      | suffix          | no            | budget-exceeded |          16 (1) |       1 |      0.187688 |
| openai    | swe-bench      | eocc-structured | no            | budget-exceeded |          16 (3) |       0 |      0.185495 |
| openai    | swe-bench      | sac-structured  | no            | budget-exceeded |          16 (8) |       8 |      0.082180 |
| anthropic | terminal-bench | fha             | no            | completed       |           6 (0) |       0 |      0.104940 |
| anthropic | terminal-bench | suffix          | no            | completed       |          10 (0) |       0 |      0.172285 |
| anthropic | terminal-bench | eocc-structured | no            | completed       |          14 (0) |       0 |      0.337120 |
| anthropic | terminal-bench | sac-structured  | no            | budget-exceeded |          16 (8) |       8 |      0.405210 |
| anthropic | swe-bench      | fha             | no            | budget-exceeded |          16 (0) |       0 |      0.447010 |
| anthropic | swe-bench      | suffix          | yes           | budget-exceeded |          16 (0) |       0 |      0.420555 |
| anthropic | swe-bench      | eocc-structured | no            | budget-exceeded |          16 (0) |       0 |      0.435220 |
| anthropic | swe-bench      | sac-structured  | no            | budget-exceeded |          16 (8) |       8 |      0.394110 |

Total observed list-price cost: **$3.488243**. Terminal-Bench: $1.107967; SWE-bench: $2.380275. This is usage multiplied by published standard text rates, not an invoice. Actual billed cost is unknown. Cache reads/writes are priced separately, summary requests are included, and failed or budget-stopped trials are not excluded.

Of the total, worker calls cost $2.794260 and summary calls cost $0.6939825. Phase costs use the cache-aware rates for each completed response; the ledger retains both categories.

Rates were pinned on 2026-11-11: [GPT-4o model pricing](https://developers.openai.com/api/docs/models/gpt-4o) and [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing). Taxes, discounts, compute, storage and operator time are excluded. GPT-4o is marked deprecated on its model page; selecting a different model requires a new calibration rather than transferring this price/quality result unchanged.

### Collection incident

The local orchestration script initially looked for SWE events in `agent/events.jsonl` instead of `agent/output/events.jsonl`. It stopped before the next paid trial. The existing 16 completed FHA responses were recovered offline, with complete usage and $0.2280175 cost; only unstarted slots were then resumed. No model trial was repeated or removed. The original stopped ledger and collection logs are retained, and the recovery is recorded in the curated ledger.

## Interpretation

All 16 slots were recorded and officially graded; all 16 have complete final provider usage. The only passing artifacts were OpenAI/FHA on Terminal-Bench and Anthropic/suffix on SWE-bench. Neither passing run exercised compaction. Seven runs completed normally; nine reached the 16-call budget. All eight SWE-bench runs reached that budget, including the passing suffix patch. Thus 2/16 is a descriptive count of these cells, not a benchmark success-rate estimate from 16 independent tasks.

EoCC committed no checkpoint in the four real-task runs. Three never crossed the trigger. The OpenAI SWE-bench run started compaction and obtained three validated summary responses, then exhausted the call allowance before the overall checkpoint could commit. That is an interrupted compaction, not a silent absence of triggering or evidence that the lifecycle implementation cannot save. The earlier [cloud lifecycle diagnostic](2026-11-11-cloud-eocc.md) remains separate synthetic evidence of compression, persistence and continuation.

SAC committed 4/8/8/8 checkpoints across its four cells: **28 commits, no summary failures**, but no official task passes. In the three capped SAC cells, eight of sixteen model calls were summaries. The OpenAI SWE suffix run committed one checkpoint and remained unresolved. A smaller working history or a lower bill from an unfinished task does not establish an efficiency win.

The paired quality outcomes offer no evidence of EoCC/SAC superiority over suffix. One task per suite cannot support a task-clustered confidence interval, and provider-default sampling plus fixed execution order do not isolate causal effects. Retain the current opt-in status and do not choose a default algorithm from this pilot.

The independent workspace-quality checker flagged generated pytest caches in four SWE runs, including the passing Anthropic/suffix run. The existing runner excluded those generated paths from submitted patches; the ledger preserves the exclusions and the separate `quality-failed` flags. Official patch success does not assert clean workspace quality.

## Proposed next evaluation — not executed

First expand calibration to **10 SWE-bench + 10 Terminal-Bench tasks**, one attempt per arm/model: **160 executions**. Increase the total-call allowance to 64 and the elapsed limit to 900 seconds, keeping output/context budgets explicit and consistent across arms. Select tasks before running, include tasks that naturally cross the trigger, and record capped trials. If EoCC cannot finish compression on these tasks, diagnose that before expanding quality comparisons. These calibration tasks must be excluded from the later held-out set.

At the current short-run rates, this 20-task stage would cost $34.88. That is only a linear reference. A provisional **$140–$279** reserve allows four times the call allowance plus task-cost variation; it is a planning heuristic, not a confidence interval or cost ceiling. Stop/re-estimate after the first five tasks and on incomplete accounting.

After calibration, an initial held-out evaluation could use **50 SWE-bench + 30 Terminal-Bench tasks**, both models, four arms, three repetitions: **1,920 executions**. Freeze task selection, model IDs, prompts, thresholds, limits, grading and exclusion rules before starting. Randomize arm order within task/model blocks; treat repetitions as repeated observations of a task, not independent task coverage.

The same capped-rate projection is `3 × (50 × $2.380275 + 30 × $1.107967) = $456.76`. A provisional larger-limit reserve is **$1827–$3654**, to be replaced with a suite/provider/arm estimate from the 20-task calibration before approval. Neither multiplier guarantees sufficiency: longer contexts, harder tasks, changed models and truncation can materially change cost.

Report native task success with task-clustered paired uncertainty, plus total/uncached/cache input, worker/summary output, list cost, compaction starts/commits/failures, termination reasons and elapsed time. Compare efficiency only alongside quality; cheap early failures are not wins. Predeclare primary EoCC-versus-suffix and SAC-versus-suffix comparisons and account for multiple comparisons.

Eighty task clusters are a starting design, not proof of five-percentage-point noninferiority. Estimate discordant-pair rates in calibration and plan power before adopting a narrow quality margin; more tasks may be necessary. General superiority across models is not established by two providers. A paper-faithful replication additionally requires its model snapshots, prompts, threshold selection procedure and complete benchmark splits; this pilot does not verify its hardware throughput or modeled optimized retail-cost claims.

No full evaluation or default-algorithm change was authorized by these observations. The larger stages above are proposals; no additional paid calls have been started for them.
