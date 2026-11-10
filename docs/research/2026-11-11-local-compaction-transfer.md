---
status: current
investigation-date: 2026-11-11
orbit-commit: 7a12bc5c489df588efb52b901906e5b0db963be2
related-adrs:
  - docs/adr/2026-11-11-selectable-session-compaction.md
superseded-by: []
---

# Local compaction transfer evaluation

## Findings at a glance

This local study does not establish an advantage over Orbit's existing suffix strategy. On the confirmation tasks, all three strategies passed 1/3 Terminal-Bench trials; suffix passed 1/3 SWE-bench trials and EoCC/SAC passed none. SAC demonstrated that a short working context can accompany a correct terminal artifact, but recap overhead, cache reuse and failed summaries prevent a general efficiency claim. No EoCC checkpoint committed in the task trials, so effective threshold-reset quality remains unqualified.

The [result ledger](../../e2e/results/2026-11-11-local-compaction-transfer.json) preserves 32 solver slots, six fixed-history diagnostics, controls, configurations, source pins and artifact hashes. There are four distinct task instances, not 32 independent tasks. The following confirmation table uses `structured-summary-v1` throughout; the six strategy/algorithm combinations were exercised separately in development and fixed-history diagnostics.

| Benchmark      | Arm (structured algorithm) | Official outcomes, seeds 42 / 43 / 44   | Normal Run completion | Committed compactions | Summary model calls | Complete token accounting |
| -------------- | -------------------------- | --------------------------------------- | --------------------: | --------------------- | ------------------- | ------------------------: |
| Terminal-Bench | suffix                     | pass / fail / fail                      |                   0/3 | 0 / 0 / 0             | 0 / 0 / 0           |                       3/3 |
| Terminal-Bench | eocc-structured            | pass / fail / fail                      |                   0/3 | 0 / 0 / 0             | 0 / 2 / 0           |                       3/3 |
| Terminal-Bench | sac-structured             | pass / fail / fail                      |                   0/3 | 3 / 5 / 1             | 6 / 7 / 2           |                       2/3 |
| SWE-bench      | suffix                     | fail / fail / pass                      |                   1/3 | 0 / 0 / 0             | 10 / 5 / 0          |                       2/3 |
| SWE-bench      | eocc-structured            | fail / fail / fail                      |                   0/3 | 0 / 0 / 0             | 4 / 8 / 7           |                       3/3 |
| SWE-bench      | sac-structured             | empty patch / empty patch / empty patch |                   0/3 | 6 / 3 / 8             | 15 / 5 / 10         |                       3/3 |

An empty patch is the official SWE-bench unresolved disposition with tests skipped, not a passed test or a missing grader result. The three nonempty suffix patches and three EoCC patches were officially tested. Summary-call counts include batches and repairs, not only committed checkpoints. Complete accounting refers to final provider logs, independently of Run completion.

## Questions and scope

Can Orbit's EoCC/SAC adaptations preserve independently verified task success while reducing context or total token work on the locally available model? Does a reset strategy help when the summary algorithm is held constant? This investigation measures transfer to Orbit, not an independent reproduction of the paper's frontier-model or GPU-serving results. No paid providers are used.

## Publication evidence

Belcak et al., _You don't need long context_, arXiv:2611.05306v1 (2026), evaluates threshold resets (EoCC) and per-action resets (SAC). Table 2 reports success percentages on SWE-bench Verified (500 tasks) and Terminal-Bench 2.1 (89 tasks):

| Model / benchmark                |  FHA | Best EoCC |  SAC |
| -------------------------------- | ---: | --------: | ---: |
| Opus 4.5 / SWE-bench Verified    | 70.0 |      74.8 | 70.2 |
| Opus 4.5 / Terminal-Bench 2.1    | 47.2 |      52.8 | 51.8 |
| GPT 5.6 Sol / SWE-bench Verified | 84.4 |      88.8 | 82.4 |
| GPT 5.6 Sol / Terminal-Bench 2.1 | 87.6 |      88.8 | 84.3 |

Author-reported results: best EoCC selects thresholds; SAC regresses in both GPT rows. Table 2 supplies no uncertainty intervals. Appendix D also reports Qwen 3 Coder Next falling from 53.0% to 3.6% on SWE-bench at 16K/12K. Section 3.1 acknowledges information loss. H100 throughput is measured; optimized retail cost is modeled. Long-input experiments combine selective reading with optional compaction. No author experiment code was inspected. [Paper, Table 2 and Appendix D](https://arxiv.org/pdf/2611.05306v1)

Inference: the evidence supports a conditional efficiency hypothesis, not universal superiority or a guarantee for smaller local models.

## Provenance and implementation differences

- Runtime baseline: `7a12bc5c489df588efb52b901906e5b0db963be2`; experimental implementation from PR #25. The Terminal-Bench bundle was initially built from a dirty tree on this revision. Its exact source fingerprint subsequently matched published commit `5aaed4d8ba4110f9af9ae0515750ad2829f26d75`. The original manifest, verification, artifact hashes and measured outputs are retained in the result ledger. Adapter/accounting corrections did not retune the solver bundle.
- Model: `ornith-1.5:9b`, Ollama digest `e5df7dcdd8a263994df62d610317e07be0d6af23f96fcbd8543273058fce575e`.
- Harbor 0.25.0: `fdba28fc411e47e8765420a1a063b4918fce3def`. Inspected installed-agent setup, single-step trial ordering, output synchronization, AgentContext, Docker environment and verifier upload. Inspected files: `src/harbor/agents/installed/base.py`, `trial/trial.py`, `environments/docker/docker.py` and `models/agent/context.py`. The post-run callback is skipped when context metadata already exists; the adapter therefore collects final usage explicitly. [Pinned source](https://github.com/harbor-framework/harbor/tree/fdba28fc411e47e8765420a1a063b4918fce3def/src/harbor)
- Terminal-Bench 2.1: `12b7565679ce5006230b820666353673a133db93`; unmodified task checkout. Oracle/nop controls and resolved task-image identities accompany the results.
- SWE-bench 4.1.0: `726c5461e2ef52d83cf1ea2107870a8bb3328d57`; inspected `swebench/harness/run_evaluation.py` and `grading.py`, with a repeated official gold control. The dataset and image identities come from [the pinned case](../../e2e/swebench/pytest-dev__pytest-10051.json). The solver source is `07fe0cdc4b5c0a5e7981e62140f36e5bae22f162`, fingerprint `72a66a0784c38cd00ec4440aec43c43df7feba432b9ad7d58fc1720112eba4ef`. [Harness source](https://github.com/SWE-bench/SWE-bench/tree/726c5461e2ef52d83cf1ea2107870a8bb3328d57/swebench/harness)
- Ollama 0.40.14 cache semantics: inspected `docs/openapi.yaml` at `9a3e8177767245acc62b735eba7d5d8a553606d0`, especially `prompt_eval_count` and `prompt_eval_cached_count`. Raw local responses expose both. [Pinned API schema](https://github.com/ollama/ollama/blob/9a3e8177767245acc62b735eba7d5d8a553606d0/docs/openapi.yaml)
- Paper PDF SHA-256: `eae3bf6f590f5f1991fda2dc3e59e6f6709c1585e54f25e4d07b21ed7a97ab1e`.
- Codex and Pi were not benchmark competitors in this experiment. Their pinned compaction-boundary comparison is in the [accepted ADR](../adr/2026-11-11-selectable-session-compaction.md); a new implementation survey would not validate local solver quality or the official graders, so neither was re-audited here.

Orbit keeps source-linked structured evidence and its own handoff prompt, validates summaries and checkpoints, retains canonical user instructions, and charges recap calls to the Run budget. This differs from the paper's prompts and harness. All matched Terminal-Bench arms use Bash and single-action execution; that baseline is not the product's default multiple-action configuration. SWE-bench uses the existing coding toolset. Do not pool the suites.

## Measurement protocol

The [protocol](../../e2e/terminal_bench/protocol.md) was recorded before solver results. Development tasks are `fix-git` and `regex-log`, seed 42, across FHA and all six strategy/algorithm combinations. Held-out tasks and seeds are fixed separately. "Held out" refers to tuning in this study: the SWE-bench case was used in earlier Orbit diagnostics, and training-data exposure is unknown. The deadline is a diagnostic resource constraint, not the official leaderboard allowance. Failed and missing trials stay in the ledger. Final logs include provider responses settling after a Run timeout; Run quiescence and token-accounting completeness are distinct properties.

| Diagnostic     | Window / trigger / target | Worker / summary output limit | Run deadline | Tools                   |
| -------------- | ------------------------- | ----------------------------- | ------------ | ----------------------- |
| Terminal-Bench | 16,384 / 12,288 / 8,192   | 2,048 / 2,048                 | 300 seconds  | Bash                    |
| SWE-bench      | 32,768 / 24,576 / 16,384  | 2,048 / 2,048                 | 900 seconds  | Existing coding toolset |
| Fixed history  | 32,768 / 12,288 / 8,192   | No worker / 2,048             | 120 seconds  | None                    |

Profiles use the `gpt-json-v1` request estimator and a 256-token safety margin; provider usage is measured separately. All solver arms use single-action execution, `think=false`, temperature 0.6 and top-p 0.95. Development and fixed history use seed 42; confirmation pairs seeds 42, 43 and 44. Fixed history permits at most four model calls. Explicit compaction arms override the legacy host `contextPolicy` field. Effective SWE policies are retained in the ledger.

Terminal-Bench oracle/nop controls passed/failed as expected for all three tasks. The repeated SWE gold control passed its target test and all 15 retained tests. No failed solver attempt was replaced. The source tree remained fixed within each suite, and prepared first-worker requests match across the three confirmation arms for each seed. Seeds do not guarantee identical later trajectories or tool observations.

Compare identical algorithm arms to isolate strategy effects. A threshold trial with no summary attempt does not test compaction effectiveness. A failed summary attempt still contributes observed overhead and failure evidence, even when no checkpoint commits. Fixed-source recap fidelity is a separate diagnostic, not a benchmark solve. Identical repeated tool calls are not necessarily redundant work. Small task counts and correlated repeated seeds cannot establish a narrow success-rate noninferiority margin. The host is Apple M6 with 32 GiB RAM; task containers run Linux/amd64 through emulation. Model calls are serial in fixed arm order, without cache flushing or randomized order. Local latency and cache observations therefore include cold starts, cross-request reuse, batch order and host load; they are not a controlled serving-throughput experiment. Ollama 0.40.14 reports prompt input inclusive of cached input; final raw responses allow separate cached and uncached counts when every request settles with valid usage. This secondary accounting was added after discovering those fields, not selected as a preregistered promotion endpoint. Billed monetary cost remains unknown. A failed or truncated run cannot earn an efficiency win by doing less useful work.

## Measured findings

### Development task evidence

Fourteen predeclared solver cells were attempted. FHA, suffix/structured, suffix/handoff, EoCC/structured and EoCC/handoff each passed `fix-git` and failed `regex-log`; none compacted. These comparisons therefore do not demonstrate a benefit from threshold compaction. SAC/handoff failed both tasks following truncated recaps. SAC/structured failed `fix-git` on a malformed generated source UUID; its `regex-log` trial completed six compactions but an enclosing exec timeout prevented grading. That trial remains ungraded, not an official verifier failure or an omitted run.

The timeout defect was corrected before held-out solvers: the worker process group is terminated before the enclosing timeouts, and Harbor receives its recognized nonzero-agent-exit condition so grading proceeds. A TERM-ignoring descendant control in the pinned task image passed. The original trial was not replaced.

### Fixed-history diagnostic

All six combinations committed a checkpoint and retained the branch, marker and pending check; none marked a test record as passed. The estimated next-request input fell from 18,128 to 404–600 tokens. Those are `gpt-json-v1` serialized-request estimates; the recap itself consumed 21,726–21,867 provider input tokens. They are not provider peak reductions.

This fixture contains repetitive synthetic assistant text, short source IDs and an explicit retention instruction. It has no tool work, realistic UUID stress or repeated SAC cadence. Manual review also found unsupported inspection counts: suffix/structured mentioned 800, while EoCC/handoff described 999 and 1–999, despite the source containing 1,000 entries numbered 0–999. Targeted retention checks therefore do not establish complete semantic fidelity. Source-ID validation proves admissible references, not the truth of every generated statement.

### Held-out confirmation

Terminal-Bench `cancel-async-tasks` completed all nine planned confirmation trials. Suffix/structured, EoCC/structured and SAC/structured each passed seed 42 and failed seeds 43 and 44 (1/3 each). None completed its managed Run normally. EoCC attempted a recap in seed 43 but validation and the deadline prevented a committed checkpoint; the other threshold confirmation runs made no recap attempt.

SAC committed 3, 5 and 1 checkpoints respectively. Seed 43 repeated the same environment-inspection command six times, then reached the process guard; the official verifier still ran and failed. One in-flight response was missing, so complete token and cache totals remain unknown. Seed 44 stopped on a malformed generated source ID after one checkpoint. These observations show distinct reset costs and failure modes without establishing their prevalence across tasks.

All five SWE-bench suffix/EoCC recap preparations followed worker responses with stop reason `length`, below the configured 24,576-token trigger. This is Orbit's existing recovery behavior, verified in [termination handling](../../src/core/models/termination.ts) and [Agent recovery](../../src/core/agent.ts): an incomplete response can force context reduction. They are not ordinary threshold crossings. The common 2,048-token worker output cap is therefore a material experimental constraint. The ledger labels inferred trigger causes from event adjacency and configured thresholds; this is an analysis of recorded events, not a new runtime diagnostic.

SWE-bench `pytest-dev__pytest-10051` completed all nine planned confirmation trials. Suffix passed seed 44, with normal Run completion and no recap; its other seeds failed. EoCC failed all three without a committed checkpoint. SAC committed 6, 3 and 8 checkpoints but produced empty patches in every seed. SAC seed 42 reached the deadline; seeds 43 and 44 stopped on invalid evidence and invalid summary format respectively. Of SAC's 35,598 output tokens across these three complete logs, 34,454 (96.8%) were recap output. Shorter histories did not translate into a completed repair.

The passing Terminal-Bench seed 42 provides a more useful efficiency example than an early failure: suffix used a peak completed input of 8,102 tokens, versus SAC's 4,542 (44% lower). However, suffix consumed 56,719 input tokens with 54,475 cached, versus SAC's 23,282 with only 628 cached. Uncached input rose from 2,244 to 22,654; total output was 7,062 versus 7,094, including 6,451 recap tokens for SAC. Both artifacts passed, while neither Run finished normally. This demonstrates a context/cache tradeoff in this deployment, not a controlled causal cache experiment or a monetary saving.

The passing SWE suffix run consumed 961,403 input tokens, of which 945,276 were cached; uncached input was 16,127 and output was 7,623. Its large total input is therefore not equivalent to repeatedly computing that many prompt tokens. Even this passing run was flagged by the independent workspace-quality check for generated cache files, which the existing runner excluded from the submitted patch. Quality checks and excluded paths remain in the ledger, separately from official patch success.

## Statistical and measurement limits

For Terminal-Bench, each alternative ties suffix on all three paired seeds. For SWE-bench, each alternative ties two failed seeds and loses the successful seed. These are exact paired outcomes on one confirmation task per suite. A task-clustered 95% interval cannot be estimated from one task cluster; seed repetitions do not supply independent task coverage. The predeclared later-study criterion (at least 20% efficiency improvement with a paired quality lower bound above minus five percentage points) is not established. Neither equivalence nor general superiority follows from these counts.

Three solver logs have incomplete usage: development SAC/structured `regex-log`, confirmation SAC/structured Terminal-Bench seed 43, and suffix SWE-bench seed 42. Partial totals are lower bounds on observed completed responses; full cache and uncached counts are null. The original development trial has no official grade. All confirmation slots have an official disposition, including skipped empty patches.

Peak input means the maximum completed provider request usage, including recap requests, not measured serving memory or the largest unfinished request. Fixed-history before/after counts are estimates of projected requests. Harbor agent-execution timing and SWE solver-container timing exclude official grading and have different boundaries; the ledger retains these observations without a population p95 or throughput claim. Early failures are not efficiency wins.

Raw trajectories remain locally retained and ignored. Published SHA-256 values identify captured artifacts; they do not make the raw logs, model weights or complete execution environment publicly available. The [harness instructions](../../e2e/terminal_bench/README.md), pinned sources and configurations support rerunning the protocol, not bit-identical replay from this ledger alone.

## Non-binding implications

Keep experimental strategies opt-in until quality and efficiency are demonstrated together on adequately powered, representative tasks. No default change follows from harness correctness, unit tests, a successful recap or a small-sample best arm.

Further studies could isolate validated short aliases for canonical source IDs, recap size/model capability, and warm versus cold cache behavior. These are separate experimental factors, not repairs silently applied to the held-out matrix. Broader tasks must include naturally committed threshold resets and the ordinary multiple-action product configuration before claiming a practical replacement advantage. The paper's selective-reading experiment remains a separate, unmeasured workstream.
