# Structured observations in Verified — 2026-09-29

This is a diagnostic on **one repeated Verified instance**,
`pytest-dev__pytest-10356`; it is not a new representative benchmark score.
The reference patch resolved the target (FAIL_TO_PASS 1/1, PASS_TO_PASS 79/79),
confirming that the pinned official grading environment works.

Two solver attempts exercise the observation integration and a local refinement
that removes opaque runtime proofs from summary-model input. Both use
`ornith-1.5:9b`, `coding-recovery-v1`, budgeted context, no round cap and a
900-second deadline. Official patch grading, runtime completion, independent
quality and observation activation are separate outcomes.

| Condition / core source                     | Runtime                    | Official target / regression | Compactions  | Summary wall time   | Direct projection |
| ------------------------------------------- | -------------------------- | ---------------------------- | ------------ | ------------------- | ----------------- |
| initial-observation-integration / `7f979eb` | Failed, quiescent; 749.0 s | Unresolved; 0/1, 79/79       | 0/2 accepted | 423.8 s, 5 requests | not-exercised     |
| proof-free-summary-input / `912e210`        | Failed, quiescent; 853.3 s | Unresolved; 0/1, 79/79       | 0/2 accepted | 339.1 s, 3 requests | not-exercised     |

Both independent quality checks reported `quality-failed` because generated
caches remained in their workspaces; those known cache paths were excluded from
submitted patches. The first patch added a debug test only. Its changed public
test ran with one pass and one skip, but the official target still failed. The
latest patch changed `src/_pytest/mark/structures.py`; no eligible changed public
test was available for that quality subcheck. Neither result proves merge-ready
code. All solver tool calls were generic Bash (28 / 37); shell editing is not a
built-in edit/write acknowledgement and its behavioral coverage remains unknown.

## What this confirms, and what remains

The latest integration removes opaque execution proofs from summary input
without changing canonical history or deterministic observations. The
[live reopened diagnostic](2026-09-29-core-observations-live.md) independently
exercised the core view and matched both actual saves after real-model
compaction. Core/compaction tests pass at the latest implementation revision.

**No accepted checkpoint occurred in either SWE attempt.** Direct observation
checks therefore report `not-exercised` (zero views), not success or a
source-correspondence failure. These runs do not demonstrate a SWE solve-rate
gain from structured observations.

The initial attempt returned unexpected summary categories and later invalid
output. The latest first summary returned all six arrays empty; Orbit correctly
rejected information loss and continued with ordinary history. Its second
compaction hit an output limit, recovered with a further request, then omitted
the required `uncertainties` array. The final invalid summary could not fit an
ordinary-history fallback, so execution stopped before the deadline. Runtime
failure is distinct from the normal official `unresolved` patch grade. Both
runs were quiescent with no unresolved operations or cleanup errors.

The next priority is schema-constrained summary generation and explicit
empty/missing-field recovery, preserving evidence checks. Generic JSON mode and
prompt instructions alone did not guarantee a nonempty, complete summary.
Any new shared model/provider contract should have its own architectural
assessment; no such API extension is included here. Dedicated test verdicts and
workspace revision attestations also remain outside generic Bash observations.

## Pinned environment and measurements

[Curated JSON](2026-09-29-core-observations-swe.json) records full source commits,
metadata checkout commits separately, source fingerprints, exact image IDs,
configuration, partial usage, quality results and official grading identifiers.
The documentation/diagnostic-only checkout changes did not alter either solver
source snapshot; image fingerprint verification passed before dispatch.

- Dataset: `princeton-nlp/SWE-bench_Verified`, test revision
  `c104f840cc67f8b6eec6f759ebc8b2693d585d4a`.
- Target: `pytest-dev__pytest-10356`, base
  `3c1534944cbd34e8a41bc9e76818018fadefc9a1`, pytest 7.2.
- Official harness: 4.1.0 at
  `726c5461e2ef52d83cf1ea2107870a8bb3328d57`; pinned official x86_64 image digest
  is in JSON. Native ARM64 solver / emulated official Linux AMD64 grader.
- Host: macOS ARM64, Ollama 0.34.4; Docker 29.8.0, memory 4,107,141,120 bytes.
- Model: `ornith-1.5:9b`, Q4_K_M, digest
  `e5df7dcdd8a263994df62d610317e07be0d6af23f96fcbd8543273058fce575e`.
- Both solves: context 32,768, output 4,096, seed 42, temperature 0.6, top-p 0.95,
  thinking disabled. Budget trigger 17,571 / target 10,813 estimated tokens;
  summary output 2,048, reserve 4,096, safety 1,639. No iteration cap.
- Model calls completed: 33 / 40; tool errors: 4 / 7. Reported usage is
  537,506 / 11,807 and 706,020 / 14,086 input/output tokens respectively,
  **incomplete totals**, not exact billed usage.

This repeats the same convenience-selected problem and changes summary input;
Session IDs, model history and resource conditions also differ. Timing and tool
counts are descriptive, not a causal performance comparison. No public
leaderboard claim, training, complete benchmark, push or book edit was performed.
Gold patches and hidden grading data stayed outside the solver.

## Reproduction and regrading

Follow [the evaluation setup](../../docs/e2e-evaluation.md) to install the pinned
host harness and prepare the dataset. Build all solver-image stages from the
source revision being tested:

```sh
docker build -f e2e/Dockerfile -t orbit-e2e:local .
docker build -f e2e/SweAgent.Dockerfile -t orbit-e2e:swe .
docker build -f e2e/VerifiedAgent.Dockerfile -t orbit-e2e:observations-fixed .
export ORBIT_SWE_CASE=e2e/swebench/pytest-dev__pytest-10356.json
npm run eval:swebench -- prepare
npm run eval:swebench -- gold
ORBIT_E2E_IMAGE=orbit-e2e:observations-fixed   ORBIT_E2E_CONTEXT_POLICY=budgeted ORBIT_E2E_STRATEGY=coding-recovery-v1   ORBIT_SWE_THINK=false caffeinate -i npm run eval:swebench -- solve ornith-1.5:9b
# Grade the predictions.jsonl path printed by solve:
npm run eval:swebench -- grade <predictions.jsonl>
# Inspect its agent/output/result.json and events.jsonl with eval:core-observations.
```

Saved standard JSONL patches can be regraded independently, with the same
manifest and pinned official environment:

```sh
ORBIT_SWE_CASE=e2e/swebench/pytest-dev__pytest-10356.json   npm run eval:swebench -- grade e2e/results/2026-09-29-core-observations-before-predictions.jsonl
ORBIT_SWE_CASE=e2e/swebench/pytest-dev__pytest-10356.json   npm run eval:swebench -- grade e2e/results/2026-09-29-core-observations-fixed-predictions.jsonl
```

Raw local Session/journal/diagnostic files remain ignored under `tmp/`; the
curated evidence and prediction patches are tracked. The
[accepted decision](../../docs/adr/2026-09-29-source-derived-tool-observations.md)
and [frozen-checkpoint replay](2026-09-29-core-observations-replay.md) describe
separate design and consumer-validation scopes.
