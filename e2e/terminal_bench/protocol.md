# Local compaction evaluation protocol — 2026-11-11

Declared before the first solver result. Baseline runtime:
`7a12bc5c489df588efb52b901906e5b0db963be2`. Harness changes are recorded by
bundle hash and source fingerprint. No default-policy change is authorized by
these experiments.

Questions: does the published regime transfer to Orbit's structured evidence
and local model; does it reduce peak worker/summary input and total token work
without losing independently verified task success; does SAC's recap overhead
outweigh its shorter input?

Primary model: `ornith-1.5:9b`, digest
`e5df7dcdd8a263994df62d610317e07be0d6af23f96fcbd8543273058fce575e`.
No paid providers. The paper's model/hardware results are external claims, not
results of this experiment. Do not extrapolate local throughput to H100 costs.

Development/smoke tasks: Terminal-Bench 2.1 `fix-git`, `regex-log`. Require oracle
pass and nop fail before solver runs. First run the four paired arms FHA, suffix,
EoCC/handoff and SAC/handoff at seed 42. Then complete algorithm-controlled arms
suffix/handoff, EoCC/structured and SAC/structured on the same tasks. Results from
this diagnostic phase can expose infrastructure problems but cannot establish a
benchmark-wide superiority or noninferiority claim. Freeze any correction and
retain failed records before proceeding.

Held-out confirmation: Terminal-Bench `cancel-async-tasks` and SWE-bench Verified
`pytest-dev__pytest-10051`, using their pinned official verifiers. No prompt or
budget tuning on these results. Pair seeds 42, 43 and 44 for suffix/structured,
EoCC/structured and SAC/structured. Add matched handoff arms if development
results justify the additional diagnostic cost, clearly recording that selection.
Record all planned cells before starting; missing infrastructure outcomes remain
in the denominator and separate from model-quality outcomes.

Use identical instructions, tools, action mode and budgets within a benchmark.
Do not pool different task suites, hardware, generation settings or timeout
budgets into a causal comparison. Retain the existing unmodified default Orbit
setting as a separately labeled reference when comparing practical operation;
a matched-single-action result alone does not prove an improvement over that
product default. Report task resolution and normal Agent completion separately.

Primary quality endpoint: official verifier success. Diagnostic efficiency
endpoints: peak completed input, total input/output tokens including summaries,
summary failures, completed compactions, repeated tool work and wall time.
Missing usage/cost remains unknown. A threshold arm with zero compactions is
not evidence for compaction effectiveness. Add a separate fixed-source live
summary diagnostic if ordinary tasks do not exercise the threshold.

Predeclared practical thresholds for a later adequately powered study: at least
20% reduction in peak input or total token work, with the lower bound of a paired
95% interval for success-rate change above -5 percentage points. This small
sample is not expected to resolve that quality tolerance. Report exact paired
outcomes, task-clustered intervals where estimable, and an inconclusive verdict
rather than treating an insignificant difference as equivalence. Do not promote
an observed best small-sample arm to a default.
