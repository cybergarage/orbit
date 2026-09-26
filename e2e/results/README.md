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

The Verified three-instance rows reuse the **same selected problems**, so their
counts must not be added together. The three problems span different repositories
but were selected as a convenience sample, not a representative Verified subset.
The focused run resolved Django and pytest; Sphinx was unresolved. The baseline
resolved Django and Sphinx; pytest was unresolved. See the detailed reports for
instance IDs and per-instance official checks. The Lite first-attempt timeout
produced no patch, so the official harness did not run tests for that attempt.

The graded rows above were measured with an older, explicitly configured 30- or
50-round limit. The current SWE evaluation default has **no round limit** and
retains the elapsed-time deadline; these rows are not measurements of that
default. Host conditions, prompts, solver dependencies and sample sizes differ
between rows. Fixed seeds do not make repeated runs identical.

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
