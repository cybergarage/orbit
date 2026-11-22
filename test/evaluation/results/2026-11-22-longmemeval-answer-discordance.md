# Offline diagnosis of the ten LongMemEval answer flips

This read-only follow-up to the [100-question answer comparison](2026-11-22-longmemeval-full-local-answers.md)
uses its existing local answer and grade checkpoints. It does not run a model
or perform a second grade, and does not modify or publish checkpoint contents.

## Findings

| Answer-grade transition | Cases | Complete annotated evidence on the wire                        |
| ----------------------- | ----: | -------------------------------------------------------------- |
| Incorrect → correct     |     8 | More marked turns retained                                     |
| Incorrect → correct     |     1 | Unchanged: neither arm retained the single marked turn         |
| Correct → incorrect     |     1 | Unchanged: neither arm retained either of the two marked turns |

The only answer-grade regression was in **knowledge update**. The
chronologically latest annotated turn contains the benchmark's current
reference value. Both arms admitted a complete candidate for that turn
and matched it lexically. Neither included it in preparation or
serialization; neither returned any excerpt from its source session.
An excerpt from an earlier annotated source appeared in both responses'
contexts, but it did not cover the complete earlier marked turn either.

The weighted response used insufficient-information wording; the
baseline was judged correct by the existing same-model judge, despite
also not receiving the complete marked evidence. The saved wires and
prompt digests rule out a mix-up between the two inputs. This is
**missing annotated current evidence in both arms**, not a demonstrated
case of the weighted answer overlooking a visible update, or proof that
weighting alone removed current information. The baseline may have
inferred the answer from unannotated information, guessed, or been
graded generously; this audit does not adjudicate those possibilities.

The only [#57 whole-chunk full-evidence loss](2026-11-22-longmemeval-heldout-ranking.md)
was a **different, temporal-reasoning** case. The weighted wire lost the
single complete marked turn, but both answers were judged incorrect, so
it was not one of the ten grade flips.

## Reproduce from existing local evidence

Build Orbit, then supply the same checksum-pinned public dataset and
point to the existing private checkpoint directory for the completed
full run. Do not pass the answer runner's `--run` flag.

```sh
npm ci
npm run build
node bin/project-memory-answer-discordance.mjs --run-dir tmp/ingestion-study-XXXXXX < /path/to/longmemeval_s_cleaned.json
```

The auditor pins the holdout digest, verifies each discordant
pair's saved answer and independent grade records, and reconstructs
both exact wire-context and dated answer-prompt hashes. It locates a
latest annotated turn by source timestamp and within-source order,
compares its exact span at each stage, and distinguishes the whole
answer-bearing span from merely returning another part of its source.
The output contains only category-level counts and diagnostic flags,
not ordinals, task identifiers, dates, questions, reference values,
evidence text, or generated answers. The saved run is required; it
cannot be reconstructed from the public PR.

Eight of nine grade improvements co-occurred with higher annotated-turn
coverage. That is an association in the **selected ten flips**, not a
causal explanation or an estimate for all 100 questions. The no-change
win and the evidence-loss tie show why answer quality and exact-turn
coverage are distinct. If investigating further, isolate the
preparation-stage loss of newer evidence on a fixed set of update and
temporal cases before considering any recency heuristic. No selection
or runtime default was changed.
