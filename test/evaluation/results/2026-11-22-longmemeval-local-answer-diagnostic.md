# Local LongMemEval answer diagnostic

This evaluation-only diagnostic asks whether the fixed search-ranking
change in the [held-out replay](2026-11-22-longmemeval-heldout-ranking.md)
also changes judged answers, and whether directly supplying annotated
turns is informative about the remaining evidence gap. This is a
small, local same-model diagnostic, not the official LongMemEval grade.

## Frozen sample

The checksum-pinned public dataset and 100-case disjoint holdout are
exactly those in the held-out replay. Before generating any benchmark
answer, within each of the six question types sort by SHA-256 of
`orbit-local-answer-diagnostic-v1:<question_id>`. From each stratum
take the first available abstention and enough answerable questions
to reach three. This yields **14 answerable and four abstention cases**.
The ordered digest is
`a3d5a3a51c133760c944b36b435c00609cd58d733bbab552d5356183542c696b`.
No evidence shifts, grades, or answers determine the subset; results
are not estimates for all 100 holdout cases. A fictional answer/grade
smoke used the local server first; its cold/warm timings were
about 7.5/1.4 seconds and did not include benchmark-size context.
A 100-case study would require 584 generation/grading requests.

## Contexts and controls

- **Baseline** and **weighted** use the exact serialized whole-chunk
  retrieval outputs from the held-out ranking diagnostic. Record
  coverage, preparation/wire utilization and number of entries.
- **Oracle**, for answerable cases only, selects original complete
  annotated turns. Adjacent marked turns in the same history share an
  entry; an unmarked turn breaks the span. Preserve original
  source-date titles, role text, and chronological source/turn order.
  No labels, answer-key text, case IDs, relevance markers or arm name
  are inserted. Synthetic metadata and JSON shape match the original
  renderer; its generation number is the same as ordinary retrieval.
- All contexts use the existing project memory and wire JSON renderers,
  2,048-token preparation and wire caps, 16/6 slot limits, and
  whole-entry admission. Identify oracle clipping by comparing complete
  turns before and after preparation and wire serialization; fixed caps
  do not imply equal actual token usage.
- The four abstentions use ordinary baseline and weighted retrieved
  contexts and receive no oracle request or artificial empty input.

All answer requests use the identical stateless direct-answer prompt,
full question and date, no tool definitions, temperature 0, seed 1,
8,192 context tokens, 128 maximum output tokens, and disabled thinking.
Gemma 4 12B on loopback Ollama was pinned to
`4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c`.
There are no model downloads, cloud calls, credentials or fallbacks.
Answer order is deterministic but scrambled within each question
using a distinct SHA-256 domain. A fresh local judge call grades one
anonymous answer with the question and reference, no arm, context,
sibling response or outcome. The judge is the same local model and
the same rubric across arms, not independent-model validation.
Malformed/unavailable grades remain pending rather than false;
incomplete answers are counted rather than silently removed.

## Reproduction and privacy

```sh
npm ci
npm run build
mkdir -m 700 -p tmp
node bin/project-memory-answer-oracle.mjs < /path/to/longmemeval_s_cleaned.json
node bin/project-memory-answer-oracle.mjs --run --commit "$(git rev-parse HEAD)" < /path/to/longmemeval_s_cleaned.json
# Resume a printed run directory using the original runner commit and the same input.
node bin/project-memory-answer-oracle.mjs --run --resume tmp/ingestion-study-XXXXXX --commit "<original-runner-git-sha>" < /path/to/longmemeval_s_cleaned.json
```

The no-flag command verifies the manifest only. Permission-restricted
checkpoints under ignored `tmp/` store exact answers and hashes, and
append accepted grades without regeneration. Resume refuses mismatched
code, manifest, rubric, or answer bytes. The run does not publish its
checkpoint directory, question texts or responses; only aggregates are
recorded here.

## Results

Executed on M4 with Ollama 0.40.16, runner commit
`47b6196dd3b70154047f40d5d6469b075dcabbb2`. All **50 answers and 50
independent grades** completed in approximately **13m36s** from
manifest to summary; zero failed, truncated, or ungraded requests.
All model calls used the pinned loopback server: **USD 0**.

| Answerable cases (n = 14) | Judged correct | Full original evidence | Annotated turns in prepared / wire | Prep tokens | Wire tokens | Wire slots |
| ------------------------- | -------------: | ---------------------: | ---------------------------------: | ----------: | ----------: | ---------: |
| Baseline                  |              6 |                      2 |                        7 / 6 of 26 |      27,143 |      22,309 |         24 |
| Weighted                  |              8 |                      4 |                       10 / 8 of 26 |      26,976 |      23,802 |         25 |
| Oracle                    |             12 |                     14 |                      26 / 26 of 26 |       6,361 |       8,185 |         26 |

All oracle evidence fit the preparation and serialization caps, so none
of its 26 annotated turns were truncated or dropped. Local model prompt
token totals (including question and template) were 28,629, 30,346,
and 14,176 respectively. These are distinct from the wire-renderer
counts and were well within the configured context on each request.

| Paired local grading, 14 answerable cases | Judged correct | Incorrect → correct | Correct → incorrect |
| ----------------------------------------- | -------------: | ------------------: | ------------------: |
| Baseline → weighted                       |          6 → 8 |                   2 |                   0 |
| Baseline → oracle                         |         6 → 12 |                   7 |                   1 |
| Weighted → oracle                         |         8 → 12 |                   5 |                   1 |

In the **four abstention cases**, both ordinary arms were judged correct
4/4 with no transitions; no oracle was run. Baseline → weighted used
7,835 → 7,790 preparation tokens, 7,480 → 6,907 wire tokens, and
9 → 8 wire slots. These four cases do not establish an absence of
abstention regressions.

The weighted result is directionally consistent with more retained
evidence on this subset, but two paired changes are weak evidence for
a general answer-quality improvement. The curated oracle removes
distractors and uses substantially fewer actual tokens, so its gain
is not an isolated effect of adding annotated turns or a production
upper bound. Even when all annotated turns fit, the oracle was judged
wrong twice, including one case judged right in the ordinary arms.
This diagnostic does not separate generation mistakes from local-judge
error, and it does not justify changing retrieval defaults.
