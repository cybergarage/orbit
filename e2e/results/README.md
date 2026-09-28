# Coding E2E results

These are dated **local diagnostic results**, not SWE-bench leaderboard scores.
The [evaluation guide](../../docs/e2e-evaluation.md) explains how to run and
regrade the cases. Each linked report records the dataset and harness revision,
target commits, model digest and settings, environment, and limitations. The
tables below summarize observed attempts; they are not estimates of general
model reliability.

## SWE-bench

An official result describes the **submitted patch** under the pinned SWE-bench
harness. Agent completion describes whether Orbit ended normally. Independent
deliverable checks, where available, inspect changed public tests and generated
files; an official resolution alone does not mean a patch is ready to merge.
Reference-patch grading is an environment control and is excluded from the
Orbit success counts.

| Date | Dataset / instances | Model and condition | Official patch result | Agent completion | Independent quality | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-09-25 | Lite test: `sympy__sympy-20590` | `ornith-1.5:9b`, original prompt, thinking enabled | Not graded; empty patch | 0/1; host timeout | Not measured | [Initial report](2026-09-25.md), [JSON](2026-09-25-swe.json) |
| 2026-09-25 | Lite test: `sympy__sympy-20590` | `ornith-1.5:9b`, original prompt, 30 rounds | 1/1 resolved | 0/1; budget exceeded | Not measured; generated cache files retained | [Initial report](2026-09-25.md), [JSON](2026-09-25-swe.json), [prediction](2026-09-25-predictions.jsonl) |
| 2026-09-25 | Lite test: `sympy__sympy-20590` | `ornith-1.5:9b`, recovery prompt, 30 and 50 rounds | 0/2; empty patches were not executed | 0/2; budget exceeded | Not measured | [Follow-up](2026-09-25-recovery.md), [JSON](2026-09-25-recovery-swe.json) |
| 2026-09-25 | Lite test: `sympy__sympy-20590` | `ornith-1.5:9b`, original prompt, 50 rounds | 1/1 resolved | 1/1 completed | Not measured; generated cache files retained | [Follow-up](2026-09-25-recovery.md), [JSON](2026-09-25-recovery-swe.json), [prediction](2026-09-25-baseline50-predictions.jsonl) |
| 2026-09-25 | Verified test: Django, pytest, Sphinx (3 instances) | `ornith-1.5:9b`, baseline, 50 rounds | 2/3 resolved | 0/3; budget exceeded | Django passed, pytest not measured, Sphinx failed in later checks | [Baseline report](2026-09-25-verified.md), [JSON](2026-09-25-verified.json), [predictions](2026-09-25-verified-predictions.jsonl) |
| 2026-09-25 | Verified test: Django (control) | `ornith-1.5:9b`, test-runner instructions, 50 rounds | 1/1 resolved | 0/1; budget/host timeout | Passed; elapsed time not comparable | [Improvement report](2026-09-25-verified-improvements.md), [JSON](2026-09-25-verified-improvements.json), [prediction](2026-09-25-verified-tests-v1-predictions.jsonl) |
| 2026-09-25 | Verified test: Django, pytest, Sphinx (same 3 instances) | `ornith-1.5:9b`, focused completion, 50 rounds | 2/3 resolved | 2/3 completed | Django passed; pytest and Sphinx failed | [Improvement report](2026-09-25-verified-improvements.md), [JSON](2026-09-25-verified-improvements.json), [predictions](2026-09-25-verified-focused-v1-predictions.jsonl) |
| 2026-09-26 | Verified: Django 15732 | `ornith-1.5:9b`, no round cap, 900-second deadline | Unresolved; 0/1 FAIL_TO_PASS, 125/125 PASS_TO_PASS | Incomplete at deadline; 66 model calls | Not measured | [Additional report](2026-09-26-verified-additional.md), [JSON](2026-09-26-verified-additional.json), [prediction](2026-09-26-verified-additional-predictions.jsonl) |
| 2026-09-26 | Verified: pytest 10356 | `ornith-1.5:9b`, no round cap, 900-second deadline | Unresolved; 0/1 FAIL_TO_PASS, 79/79 PASS_TO_PASS | Runtime error after 69 completed model calls; final tool arguments were incomplete JSON | Not measured | [Additional report](2026-09-26-verified-additional.md), [JSON](2026-09-26-verified-additional.json), [prediction](2026-09-26-verified-additional-predictions.jsonl) |
| 2026-09-26 | Verified: Sphinx 10466 | `ornith-1.5:9b`, no round cap, 900-second deadline | Resolved; 1/1 FAIL_TO_PASS, 6/6 PASS_TO_PASS | Incomplete at deadline; 75 completed model calls | Failed local changed-test check; six `.pytest_cache` files included | [Additional report](2026-09-26-verified-additional.md), [JSON](2026-09-26-verified-additional.json), [prediction](2026-09-26-verified-additional-predictions.jsonl) |
| 2026-09-27 | Verified: pytest 10356 (four-way diagnostic) | `ornith-1.5:9b`, baseline/focused completion × context disabled/budgeted | 0 resolved; 2 unresolved, 1 empty patch skipped, 1 grading error | 0/4 normal completion; two timeouts, two runtime errors | Only focused+context run used latest `f654787`; other arms used `0570913`; not a same-commit comparison | [Context/completion report](2026-09-27-context-completion.md), [JSON](2026-09-27-context-completion.json) |
| 2026-09-27 | Verified: pytest 10356 (controlled four-way rerun) | `ornith-1.5:9b`, same Orbit commit `94a3a16`; baseline/focused completion × context disabled/budgeted | 0/4 resolved; all patches applied but target failed | 0/4 normal completion; one runtime failure, two incomplete runtime errors, one deadline | Context-enabled partial patches also broke 79/79 PASS_TO_PASS tests; no condition passed the target | [Controlled report](2026-09-27-context-completion-controlled.md), [JSON](2026-09-27-context-completion-controlled.json) |
| 2026-09-27 | Verified: pytest 10356 (controlled four-way rerun) | `ornith-1.5:9b`, same Orbit commit `584c24b`; baseline/focused completion × context disabled/budgeted | 0/4 resolved; 2 unresolved, 1 empty patch skipped, 1 patch-application grading error | 0/4 normal completion; one timeout, two incomplete runtime errors, one runtime error | Both graded patches failed the target; context runs spent 10–12.5 minutes summarizing and completed no compaction | [Rerun report](2026-09-27-context-completion-rerun.md), [JSON](2026-09-27-context-completion-rerun.json), [predictions](2026-09-27-context-completion-rerun-baseline-context-off-predictions.jsonl) |
| 2026-09-27 | Verified: pytest 10356 (latest real-model diagnostic) | `ornith-1.5:9b`, focused v1 + budgeted context vs focused v2 + context disabled; same Orbit commit `66610dc` | 0/2 resolved; both patches applied, target failed | 0/2 normal completion; both reached the 900-second deadline | v1: PASS_TO_PASS 73/79, 9.5 min summarizing, no compaction; v2: collection TypeError, 35 tool errors; usage incomplete | [Report](2026-09-27-real-model-reevaluation.md), [JSON](2026-09-27-real-model-reevaluation.json), [v1 prediction](2026-09-27-real-model-v1-predictions.jsonl), [v2 prediction](2026-09-27-real-model-v2-predictions.jsonl) |
| 2026-09-28 | Verified: pytest 10356 (context-summary recovery rerun) | `ornith-1.5:9b`, same focused v1, budgeted context and generation settings; Orbit `d142e48` | Unresolved; empty patch, official harness skipped tests | Incomplete at deadline during second compaction; 106 model calls | First compaction completed in 248 s after 2 requests, 17,723→4,459 estimated tokens; second compaction was cancelled after 132 s | [Report](2026-09-28-context-summary-reevaluation.md), [JSON](2026-09-28-context-summary-reevaluation.json), [prediction](2026-09-28-context-summary-reevaluation-predictions.jsonl) |
| 2026-09-28 | Verified: pytest 10356 (trigger interval comparison) | `ornith-1.5:9b`, focused v1, budgeted context, 80% trigger; Orbit `d142e48` plus E2E-only ratio override | Unresolved; target 0/1, PASS_TO_PASS 0/79 | Runtime error at 900-second deadline; 51 model calls; 950-byte patch | Trigger at 22,047 tokens; 3 summary batches / 344 s; invalid summary JSON, compaction failed, three later skips | [Report](2026-09-28-context-trigger-interval.md), [JSON](2026-09-28-context-trigger-interval.json), [prediction](2026-09-28-context-trigger-interval-predictions.jsonl) |
| 2026-09-28 | Verified: pytest 10356 (summary stability follow-up) | `ornith-1.5:9b`, JSON-constrained summaries; 80% and 65% trigger before batching, then 65% with smaller initial batches; Orbit `55d74e3` / `02ff86a` | 0/3 resolved; 80% empty patch skipped, two 65% patches unresolved | All reached deadline/budget stop; latest completed 49 model calls | No invalid JSON/schema failures; latest first compaction completed in 500.7 s (17,842→4,588 tokens), but 21 tool errors and PASS_TO_PASS 0/79 | [Report](2026-09-28-context-summary-stability-followup.md), [JSON](2026-09-28-context-summary-stability-followup.json), [80% prediction](2026-09-28-context-json-80-predictions.jsonl), [65% prediction](2026-09-28-context-json-65-predictions.jsonl), [batched 65% prediction](2026-09-28-context-batched-65-predictions.jsonl), [tool-error classification](2026-09-28-tool-error-classification.json) |
| 2026-09-28 | Verified: pytest 10356 (semantic-evaluation continuation) | `ornith-1.5:9b`, focused v1, budgeted 65%, Orbit `b48e590` | Empty patch; official harness skipped tests, 0 resolved | Incomplete at 900 s; unresolved summary operation | 0 accepted checkpoints; malformed JSON keys rejected; 146 tool errors; fixed-case replay separately fails unsupported-success check | [Report](2026-09-28-context-semantic-evaluation.md), [JSON](2026-09-28-context-semantic-evaluation.json), [prediction](2026-09-28-context-semantic-swe-predictions.jsonl) |

The Verified three-instance rows reuse the **same selected problems**, so their
counts must not be added together. The three problems span different repositories
but were selected as a convenience sample, not a representative Verified subset.
The focused run resolved Django and pytest; Sphinx was unresolved. The baseline
resolved Django and Sphinx; pytest was unresolved. See the detailed reports for
instance IDs and per-instance official checks. The Lite first-attempt timeout
produced no patch, so the official harness did not run tests for that attempt.

The graded rows above were measured with an older, explicitly configured 30- or
50-round limit. The current SWE evaluation has **no round limit**, and that
limit can no longer be enabled through configuration; the elapsed-time deadline
remains active. These rows are not measurements of the current runner. Host
conditions, prompts, solver dependencies and sample sizes differ between rows.
Fixed seeds do not make repeated runs identical.

The September 26 follow-up deliberately set `ORBIT_SWE_ROUNDS=1` for all three
solves. The current runner ignores this removed setting and recorded
`rounds: unlimited` in each Session. Runs continued until a normal completion,
a runtime error or the separate 900-second elapsed-time budget.

## Context summary replay

This is a focused solver-history diagnostic, not a SWE-bench solve or grade.

| Date | Model / condition | Observed result | Evidence |
| --- | --- | --- | --- |
| 2026-09-28 | `ornith-1.5:9b`, same stale checkpoint and confirmed edits, before / initial fix / final prompt refinement | Saved-state contradiction reproduced before, removed after final refinement; latest bar-selection failure retained. Unsupported inference that both markers passed remains. All outputs were valid JSON/schema/evidence. | [Report](2026-09-28-context-work-state-replay.md), [JSON](2026-09-28-context-work-state-replay.json) |
| 2026-09-28 | `ornith-1.5:9b`, independent fixed-case semantic grader, before/current prompts | Both fail overall; current preserves saved edit and latest test/work, but falsely claims both markers were verified. JSON/source IDs valid in both. | [Report](2026-09-28-context-semantic-evaluation.md), [JSON](2026-09-28-context-semantic-evaluation.json) |

## Small coding cases

These are Orbit's four local fixtures, **not SWE-bench instances**. Each model ran
`read`, `single-file`, `test-repair` and `multi-file` three times per condition.
Each run had a fresh workspace and Session and was independently graded.

| Date | Model | Baseline resolved | Recovery instructions resolved | Evidence |
| --- | --- | ---: | ---: | --- |
| 2026-09-25 | `gemma4:12b` | 8/12 | 12/12 | [Initial report](2026-09-25.md), [follow-up](2026-09-25-recovery.md), [initial JSON](2026-09-25-small.json), [follow-up JSON](2026-09-25-recovery-small.json) |
| 2026-09-25 | `ornith-1.5:9b` | 9/12 | 12/12 | [Initial report](2026-09-25.md), [follow-up](2026-09-25-recovery.md), [initial JSON](2026-09-25-small.json), [follow-up JSON](2026-09-25-recovery-small.json) |

The recovery runs all completed normally. The baseline included host timeouts;
the later runs occurred under different host conditions. Do not attribute the
change to the instructions alone.

## Recording another evaluation

Add a dated report and its compact machine-readable summary here, then add one
row per distinct dataset, instance set, model and strategy. Preserve failed and
empty-patch attempts in the denominator. Record the dataset split and revision,
official harness revision, instance IDs and base commits, model digest and
quantization, generation settings, Orbit commit, image identity, limits, elapsed
time, token usage completeness, reference-control result, official patch result,
Agent outcome and any independent quality checks. Keep the raw submitted JSONL
patch unchanged so it can be regraded. Distinguish environment failures, Orbit
errors, budget/deadline stops and unresolved patches.

Review files before committing: exclude credentials, private paths, full prompts
containing private data and reference/test patches. Retain full solver workspaces,
datasets, hidden grading material and logs under ignored `tmp/e2e/`; this
repository does not distribute them. A saved prediction can be regraded after
preparing the matching dataset and official image as described in the
[evaluation guide](../../docs/e2e-evaluation.md).
