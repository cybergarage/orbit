# Cloud compaction interim evaluation — 2026-11-11

## Summary

This evaluation asks whether two compaction strategies studied by Belcak et al., End-of-Conversation Compaction (EoCC) and Single-Action Compaction (SAC), transfer to Orbit. The study compares Orbit's adaptations of both methods with Orbit (Suffix), its current default compaction strategy, and a full-history baseline on SWE-bench and Terminal-Bench. It measures task success, compaction behavior, and token use, including list-price cost for cloud runs. [Paper: _You don't need long context_ (arXiv:2611.05306v1)](https://arxiv.org/abs/2611.05306v1)

Orbit's EoCC compacted a live task and continued to a native verifier pass. The available comparisons leave the question of an advantage over Orbit's default strategy open.

![Local and cloud interim results. Each local benchmark uses three runs of the same task. On Terminal-Bench, Orbit, EoCC and SAC each passed one of three runs. On SWE-bench, Orbit passed one of three runs and EoCC and SAC passed none. On the two complete Opus tasks, FHA, Orbit and EoCC each passed both tasks, and SAC passed neither. Their estimated list costs were $2.45, $2.02, $2.30 and $5.25, respectively. GPT-4o passed neither task with any method.](images/2026-11-11-compaction-interim.png)

_In the local panel, each method runs the same task three times per benchmark, with a different seed each time. A score of 1/3 means one official pass in three runs. A score of 0/3 means zero passes in three runs. The cloud panel shows two distinct tasks with all eight conditions completed. See the [combined findings](#combined-local-and-cloud-interim-findings) for the comparison limits._

### How the four conditions handle history

| Condition                                 | When it compacts                                                                                                      | What the next model call receives                                                                                                     |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Orbit (Suffix)**                        | At the token threshold or during overflow recovery. This is Orbit's current default strategy for budgeted compaction. | <ul><li>Original task instructions</li><li>A structured summary of older history</li><li>Recent messages retained verbatim</li></ul>  |
| **FHA (Full-History Accumulation)**       | Compaction is disabled. This is the paper's baseline.                                                                 | <ul><li>Original task instructions</li><li>The full conversation, including previous actions and their results</li></ul>              |
| **EoCC (End-of-Conversation Compaction)** | At the token threshold or during overflow recovery. The active conversation starts fresh after compaction.            | <ul><li>Original task instructions</li><li>A structured summary of the work so far</li></ul>                                          |
| **SAC (Single-Action Compaction)**        | After each completed action and its result, before the next action.                                                   | <ul><li>Original task instructions</li><li>An updated structured summary that carries forward the result of the last action</li></ul> |

In the figure, **Orbit** refers to the default strategy, **Orbit (Suffix)**. It summarizes older history and retains recent messages verbatim. The book's context compaction chapter explains this approach and how Orbit chooses the history to retain. [AI Agent Design and Implementation: Understanding Agent Behavior Through Research, Standards, and Open Source](https://www.amazon.com/dp/B0HPZ8HP32)

The EoCC and SAC conditions in this evaluation use Orbit's structured summaries. The paper describes the original methods and the FHA baseline in [Section 2.4.1](https://arxiv.org/html/2611.05306v1#S2.SS4.SSS1).

### Interim findings

- **EoCC can support successful continuation after compaction.** In a cloud diagnostic, Orbit saved and reopened a compacted session and continued with both providers. In one Opus benchmark task, EoCC committed a compaction, continued tool work, and passed the native verifier. The local benchmark runs produced no committed EoCC compaction. On the two complete Opus tasks, EoCC and Orbit (Suffix) both passed, and EoCC had the higher combined list cost ($2.30 versus $2.02). A quality or cost advantage remains unproven. [Lifecycle diagnostic](2026-11-11-cloud-eocc.md) · [Combined findings](#combined-local-and-cloud-interim-findings)
- **SAC can reduce peak context, with substantial summary overhead in this evaluation.** In a passing local Terminal-Bench comparison, it reduced peak input by 44% versus Orbit (Suffix), while uncached input rose roughly tenfold as cache reuse fell. In three of its four cloud runs on the two complete tasks, summaries used 32 of the 64 allowed calls and the runs reached the call limit. SAC passed neither cloud task on either model. The observed overhead and limited task coverage leave an efficiency advantage unproven. [Combined findings](#combined-local-and-cloud-interim-findings)
- **Cloud calibration** stopped after 24 of 160 conditions had complete usage accounting and official results. Observed list-price cost, including returned usage from interrupted attempts, was $41.73. See the [cost breakdown](#cost-findings) and [restart conditions](#outstanding-verification-and-restart-conditions).

Related work: [Issue #22](https://github.com/cybergarage/orbit/issues/22), [protocol PR #32](https://github.com/cybergarage/orbit/pull/32), [16-call pilot](2026-11-11-cloud-compaction-pilot.md), and [synthetic cloud lifecycle diagnostic](2026-11-11-cloud-eocc.md). The [sanitized ledger](2026-11-11-cloud-compaction-interim.json) retains all 160 planned conditions, four historical credit-interrupted attempts, two user-interrupted attempts within the planned conditions, usage, native results and artifact hashes. This is a benchmark execution report, not a new architecture decision or external-agent comparison.

## Paper and related evidence

The version evaluated for this report is available as the [paper PDF](https://arxiv.org/pdf/2611.05306v1).

The [local study's publication analysis](../../docs/research/2026-11-11-local-compaction-transfer.md#publication-evidence) separates the authors' reported EoCC/SAC results from Orbit's measurements and records the inspected paper version and PDF hash. EoCC and SAC are evaluated methods in that paper; the results below concern Orbit's adaptations with its own summary validation, prompts, models and execution budgets. This interim report is not a paper-faithful replication and does not establish that the paper's claims are true or false.

## Scope and protocol

Orbit revision: `601fedac22d78fc8b72bd8bfdbf5b90941d278d7`. The reused runtime bundle was built at `c98bde8b4c8eda7ed2e91a0618ae75ac10e965ce`; its runtime source fingerprint matches the calibration revision. The ledger records bundle and source hashes.

The [predeclared calibration](../cloud-calibration-20.json) selected 10 SWE-bench Verified and 10 Terminal-Bench tasks, two models and four arms: 160 conditions, one completed attempt per condition. Models are `gpt-4o-2024-08-06` and `claude-opus-4-6`. Arms are FHA (full history without compaction), Orbit suffix, EoCC/structured and SAC/structured. All use baseline execution strategy and single-action mode.

Limits are 64 total model calls **including summaries**, 900 seconds, and 4,096 output tokens per response. Compaction settings are window 32,768, trigger 12,288 and target 8,192. FHA disables compaction and is not restricted to a common 32,768-token request ceiling; its native model limit applies. Thus this comparison is not a fixed-context-cap experiment across all four arms. Sampling uses provider defaults, without cross-provider seed equivalence. Task blocks run at concurrency two; arm/provider order is deterministically hashed within each task. The host uses Linux/amd64 Docker emulation on ARM64.

All 20 native controls passed (SWE reference patches; Terminal-Bench oracle reward 1 and no-op reward 0), and all 10 SWE solver preflights passed. Sources are pinned in the ledger: SWE-bench dataset `c104f840cc67f8b6eec6f759ebc8b2693d585d4a`, harness `726c5461e2ef52d83cf1ea2107870a8bb3328d57`; Terminal-Bench `12b7565679ce5006230b820666353673a133db93`, Harbor `fdba28fc411e47e8765420a1a063b4918fce3def`. SWE images are pinned by digest. Terminal-Bench image identities were captured after the first executions; do not interpret that record as immutable digest pinning for every launch.

Task selection was a metadata-based convenience sample, with supported SWE repository/version profiles (eight Django, one pytest, one Sphinx), not a representative benchmark sample. These are development calibration tasks, not held-out evidence. The two complete task blocks are the earliest completed blocks under the protocol, not selected for passing outcomes.

## Primary comparison: two complete task blocks

The complete tasks are SWE-bench `pytest-dev__pytest-10081` and Terminal-Bench `custom-memory-heap-crash`. Each has two models times four arms. Official verifier results concern the submitted artifact, independently of normal runtime completion.

| Model    | Arm             | Official passes | Committed compactions | Total list cost USD |
| -------- | --------------- | --------------: | --------------------: | ------------------: |
| GPT-4o   | FHA             |             0/2 |                     0 |            0.087925 |
| GPT-4o   | suffix          |             0/2 |                     2 |            0.492730 |
| GPT-4o   | EoCC/structured |             0/2 |                     0 |            0.049050 |
| GPT-4o   | SAC/structured  |             0/2 |                    41 |            0.662950 |
| Opus 4.6 | FHA             |             2/2 |                     0 |            2.449525 |
| Opus 4.6 | suffix          |             2/2 |                     1 |            2.015115 |
| Opus 4.6 | EoCC/structured |             2/2 |                     1 |            2.296375 |
| Opus 4.6 | SAC/structured  |             0/2 |                    64 |            5.245960 |

The complete blocks cost **$13.299630**. Compaction counts are lifecycle observations, not a quality score. With only two task clusters, these pass fractions are descriptive and do not support general superiority, equivalence or noninferiority claims.

### EoCC and suffix

Opus EoCC on pytest committed one compaction and then completed six worker model responses and five tool results before normal completion and a native pass. This is real-task evidence of committed compaction and useful continuation; the separate synthetic diagnostic establishes save/resume behavior explicitly. Opus EoCC on the memory task passed without triggering compaction. The two OpenAI EoCC trials also never triggered and failed native grading; their low costs are not evidence of efficient successful compaction.

Opus suffix and EoCC both passed both tasks. Suffix cost $2.015115 and EoCC $2.296375: EoCC was approximately 14% more expensive in these two blocks. This small difference does not isolate a causal algorithm effect because trajectories and sampling differ. No observed quality advantage justifies replacing suffix.

### SAC and the shared call budget

Three of four SAC trials exhausted the 64-call allowance, with 32 summary attempts each. OpenAI on the memory task failed with `summary-invalid-format` after 21 completed model calls and 11 summary attempts; nine compactions had committed. None passed native grading. On Opus, SAC cost about 2.6 times suffix across the two tasks.

This raises a concrete concern about summary overhead under the shared call budget. It does not show SAC universally fails. Increasing worker allowance while separately budgeting summaries would be a different experimental protocol and must not be silently substituted into this comparison.

## Combined local and cloud interim findings

The [local transfer study](../../docs/research/2026-11-11-local-compaction-transfer.md), [cloud lifecycle diagnostic](2026-11-11-cloud-eocc.md), [16-call cloud pilot](2026-11-11-cloud-compaction-pilot.md) and this 64-call calibration answer different questions. Together they establish working compaction mechanisms and expose overhead; they do not establish general superiority over Orbit suffix.

| Evidence set                                     | Unit and boundary                    | suffix native passes | EoCC native passes | SAC native passes |
| ------------------------------------------------ | ------------------------------------ | -------------------: | -----------------: | ----------------: |
| Local ornith-1.5:9b, Terminal-Bench confirmation | One task, three seeds                |                  1/3 |                1/3 |               1/3 |
| Local ornith-1.5:9b, SWE-bench confirmation      | One task, three seeds                |                  1/3 |                0/3 |               0/3 |
| GPT-4o, complete 64-call blocks                  | Two distinct tasks, one attempt each |                  0/2 |                0/2 |               0/2 |
| Opus 4.6, complete 64-call blocks                | Two distinct tasks, one attempt each |                  2/2 |                2/2 |               0/2 |

Do not sum these denominators into a pooled success rate. Local seed repetitions are not independent tasks; local and cloud tasks, runtime revisions, thresholds, output caps, deadlines and sampling differ. Local confirmation contains one task per suite, and this cloud comparison contains one different task per suite. The earlier 16-call pilot is another separate measurement, not evidence that raising the limit caused an improvement.

**Lifecycle evidence:** local fixed-history diagnostics committed checkpoints in all six strategy/algorithm combinations, but no local EoCC real-task checkpoint committed. The final cloud synthetic diagnostic passed all four provider/summary-algorithm cases: compaction, durable save, reopen and continuation with checked facts retained. The 64-call Opus pytest result adds a committed EoCC checkpoint followed by tool work and native success. Synthetic save/resume success is distinct from real-task quality or complete semantic fidelity.

**Quality evidence:** neither local nor cloud results establish EoCC superiority over suffix. Local EoCC had no committed reset on confirmation tasks, so those failures do not isolate quality after a successful reset. Cloud EoCC succeeded with and without compaction, while suffix matched its two Opus passes. SAC produced a passing local terminal artifact, but local SWE confirmation produced three empty patches, and all four complete cloud SAC conditions failed native grading. This identifies failure modes, not their prevalence across representative tasks.

**Efficiency evidence:** a passing local Terminal-Bench pair reduced peak completed input from 8,102 tokens with suffix to 4,542 with SAC (44% lower), yet uncached input increased from 2,244 to 22,654 tokens because cache reuse fell. Neither Run completed normally. In local SWE SAC confirmation, 34,454 of 35,598 output tokens (96.8%) were recap output. Cloud SAC likewise spent half the 64-call allowance on summaries in three capped trials. Shorter context alone therefore does not demonstrate lower total work, monetary savings or faster successful completion. Local electricity, amortized hardware cost and comparable end-to-end energy were not measured; local cost must not be treated as zero.

The combined conclusion is to retain suffix as the current baseline and EoCC/SAC as experimental alternatives. EoCC now has positive real-task lifecycle evidence; SAC needs targeted investigation of recap validity and cadence. Neither the paper's truth nor a universal ranking of models or compaction methods follows from this evidence. The paper's model snapshots, prompts, complete task splits and throughput/cost methodology have not been reproduced.

## Incomplete coverage and interruptions

There are **24 fully accounted, officially graded conditions** out of 160: 12 OpenAI and 12 Anthropic. Six native passes are all Anthropic conditions; OpenAI has zero passes in its 12 observed conditions. Beyond the primary two blocks, eight complete conditions belong to partially completed Sphinx and DB recovery blocks. They are retained as supplementary evidence, not pooled into a representative success rate. Only 11 task/arm cells have complete results for both providers, so the two 12-condition totals are not matched samples.

Two Anthropic credit-exhaustion incidents interrupted four attempts. Each time, subsequent dispatch stopped. After explicit user confirmation of replenishment, only the externally interrupted conditions were restarted with separate attempt names; completed trials were retained. No algorithm failure was retried for a better outcome. The second recovery was then stopped at the user's request during two SAC executions. Their partial events were copied before the containers and dispatch processes were terminated. There are 134 unstarted conditions and two user-interrupted conditions. The five-complete-task review checkpoint was never reached.

Billing interruptions and the user stop are external interruptions, not algorithm failures. Historical attempts and their costs remain in the ledger. Interrupted grading, where present, is not used as a clean algorithm quality outcome. Original traces, patches and grader outputs are preserved locally under ignored `tmp/e2e/`; public evidence contains hashes and sanitized summaries rather than transcripts or credentials.

## Cost findings

| Provider  | Fully accounted conditions | Cost of those conditions USD | Observed interrupted-attempt cost USD | Total observed USD |
| --------- | -------------------------: | ---------------------------: | ------------------------------------: | -----------------: |
| OpenAI    |                         12 |                     3.758565 |                                     0 |           3.758565 |
| Anthropic |                         12 |                    30.139025 |                              7.831655 |          37.970680 |
| Total     |                         24 |                    33.897590 |                              7.831655 |      **41.729245** |

These are returned usage multiplied by the study's pinned list rates, **not invoices**. Some interrupted requests have no final usage; $41.729245 is the observed subtotal, not a complete final bill or guaranteed ceiling. The prior 16-call pilot is a separate experiment and is excluded. Compute, storage, taxes, discounts and operator time are excluded.

The study's [pricing snapshot](../cloud-pricing.json) uses $2.50/$10 per million ordinary input/output tokens for GPT-4o and $5/$25 for Opus, with cache read/write rates accounted separately. Sources recorded with the snapshot are [OpenAI model pricing](https://developers.openai.com/api/docs/models/gpt-4o) and [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing). These are the rates used for this experiment, not a promise of future pricing.

The observed Anthropic cost has several causes:

- Across the **11 matched completed cells**, OpenAI cost $3.256565 and Anthropic $17.524890 (about 5.4 times). Anthropic used 2,745,878 input and 151,820 output tokens, versus 1,355,550 and 42,481 for OpenAI. These are different trajectories and outcomes, not interchangeable quality at different prices.
- Anthropic's 12 completed conditions recorded zero cache-read tokens. OpenAI recorded 445,696. No claim is made that Anthropic cannot cache; this configuration obtained no observed cache-read benefit.
- Anthropic FHA on DB recovery alone cost **$12.614135**: 57 responses, 2,409,492 cumulative input tokens, 22,667 output tokens and a peak input of 120,742. Input cost was $12.047460; output cost was $0.566675. Full-history replay dominated this example; it made no summary calls and failed native grading despite normal completion. This unmatched cell accounts for about one third of the total observed Anthropic spend and must not be used as a paired OpenAI comparison.
- Summaries also matter: among fully accounted conditions, OpenAI worker/summary costs were $1.3109375/$2.4476275; Anthropic worker/summary costs were $24.878975/$5.260050. Frequent SAC summaries can consume both money and the shared call allowance.
- External interruptions added $7.831655 of known Anthropic response costs beyond the completed-condition total. Missing final usage remains unknown rather than assumed zero.

The **$300 figure was a dispatch-stop threshold for the entire calibration**, not a forecast of Anthropic charges, a provider-side hard cap or authorization to spend it after the user stop. In-flight requests could exceed a between-trial threshold. The distinction should have been made clearer before resumption; small credit replenishments caused additional interrupted work and expense.

## Cost-aware next steps — proposals only

Do not restart the 20-task calibration or the larger study automatically. Preserve the current result as an interim report. The earlier 80-task, three-repeat proposal and its cost reserve are not validated by this incomplete calibration; a reliable full-study budget and necessary task count cannot be derived from two complete task clusters.

For a separately approved follow-up:

1. Choose the question first: implementation diagnosis, quality comparison against suffix, or paper-faithful replication. They require different budgets and evidence.
2. For low-cost diagnostics, OpenAI-only work is an option, but zero passes in these 12 conditions limits its value for detecting successful-task quality differences. Changing to another model requires fresh calibration and its own explicit model ID.
3. If the primary question is EoCC versus current Orbit, consider initially comparing just EoCC and suffix. Removing FHA/SAC reduces planned conditions but also removes those baselines; declare a new protocol rather than presenting it as completion of the original four-arm study.
4. Add explicit per-provider and per-trial monetary/token limits and a small pilot spending checkpoint before another large run. A 64-call limit does not bound cost tightly because each request can resend a much larger history. Common input limits would improve cost control but change the FHA comparison and require explicit truncation/budget-stop reporting.
5. Investigate provider-supported prompt caching in a separate, tested configuration. Report cache writes, reads and observed savings; do not assume savings before measurement.
6. Estimate later costs by suite, provider and arm, including failed and capped runs, summary overhead and interruption contingency. Estimate paired task discordance before proposing a powered quality study; repetitions do not replace independent tasks. No precise sample-size or general superiority claim is supported here.

The current evidence supports retaining EoCC/SAC as opt-in experimental alternatives. It does not establish a new default, reproduce the paper's model snapshots or throughput estimates, or prove the paper correct or incorrect.

## Outstanding verification and restart conditions

Issue #22 remains open. The following work is outstanding, not approved paid work:

| Workstream                       | Remaining question or evidence                                                                                                   | Completion criterion                                                                                                                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original 20-task calibration     | 68 OpenAI conditions are unstarted; 66 Anthropic conditions are unstarted and two Anthropic SAC conditions were user-interrupted | If this exact protocol is resumed, preserve the 24 complete conditions and all historical attempts; identify every remaining disposition without replacing failed model outcomes                        |
| EoCC versus suffix               | Quality and cost after naturally triggered, committed resets on more distinct tasks                                              | Predeclared matched task/model comparisons, native grading, trigger/commit/continuation counts, summary cost and paired task-level uncertainty; report no-trigger runs separately without dropping them |
| SAC diagnosis                    | Invalid summaries/source references, recap-heavy outputs and exhaustion of shared call allowance                                 | Offline trace analysis and deterministic regression cases first; separately declared small live tests only after approval; retained fidelity and useful task progress, not just smaller histories       |
| Cost controls and cache behavior | Per-request input growth, expensive FHA replay and absent Anthropic cache reads in this configuration                            | Tested provider/trial spending guards and complete cache-write/read accounting; measured savings under a new controlled protocol rather than assumed savings                                            |
| Full evaluation design           | Number of independent tasks and meaningful quality margin                                                                        | Select the estimand and minimum relevant difference, estimate paired discordance, plan power and multiplicity, and obtain approval for the resulting task count and cost envelope                       |
| Paper-faithful reproduction      | Different models, prompts, thresholds, splits and serving setup; selective reading not evaluated                                 | Separate protocol with pinned author materials and explicitly reproducible metrics; task success alone cannot validate reported serving throughput or modeled retail cost                               |

A restart requires all of the following:

1. **Fresh explicit user authorization after the cost stop**, naming providers, models, arms, task scope and an incremental spending limit. Prior credit replenishment, the old $300 threshold, or PR approval does not authorize more API calls. OpenAI-only continuation is also paused until requested.
2. **A declared protocol choice:** either complete the existing frozen matrix or start a separately labeled experiment. Changing models, summary prompts, cache policy, common context caps, arms or worker/summary budgets creates a new condition; do not pool it silently with the existing results.
3. **Cost controls verified before launch:** agree per-provider and per-trial limits, input/output allowances, concurrency and the first review checkpoint. Include failed attempts and summary calls. A between-request or between-trial guard is not a hard provider bill cap; disclose the maximum in-flight exposure and unknown usage. Use a provider-side spending limit where available, without treating credit balance as a sufficient evaluation budget control.
4. **Evidence and environment checks:** preserve immutable stopped-ledger snapshots and artifact hashes; validate the runtime fingerprint, task/harness/image identities, native controls and isolated credentials. If artifacts or environment identity cannot be recovered, document the gap instead of claiming exact continuation. Do not launch a credit-check inference before paid execution is authorized.
5. **Explicit recovery bookkeeping:** completed conditions are not rerun for better outcomes. External interruptions may receive separately numbered recovery attempts under the agreed policy; original costs and unknown final usage remain visible. Keep algorithm failures distinct from credit, infrastructure and user interruptions.
6. **Small-stage review before expansion:** review full usage, native outcomes, committed compaction and observed costs at the agreed checkpoint. Stop new dispatch on incomplete accounting, credit errors or spending limits. Re-estimate the next stage before seeking further approval; do not automatically reinstate the earlier 80-task, three-repeat proposal.

All paid execution remains stopped. These follow-up items preserve the path to further evidence without committing to additional expenditure or a default-algorithm change.
