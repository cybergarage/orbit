# Full held-out LongMemEval local answer comparison

The 18-case [local answer diagnostic](2026-11-22-longmemeval-local-answer-diagnostic.md)
suggested a positive direction. This run compares the two ordinary arms
on **all 100** cases in the [frozen holdout](2026-11-22-longmemeval-heldout-ranking.md):
92 answerable and eight abstention questions. It does not evaluate the
oracle, reselect cases, or change runtime defaults.

## Protocol

Same public dataset SHA-256 and holdout order as the retrieval replay
(ordered digest
`f2b6da344cac943c6e01ae05b33df7714e42e0c062cb4fd1060fe8378e937d1b`).
Use the exact actual whole-chunk serialized baseline and weighted
contexts, the #59 direct-answer prompt and date, the same entry/renderer
policies, and 2,048 preparation and wire-token caps. Input context and
prompt hashes are checkpointed separately for each arm. Keep the same
fixed within-case randomization, temperature 0, seed 1, 8,192-context
and 128-output-token caps, disabled thinking, and independent blinded
single-answer grading. Judge metadata includes the reference and
abstention status but no context, arm or sibling response. The answer
model sees neither reference nor arm labels.

Use only the previously pinned Gemma 4 12B on loopback Ollama:
`4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c`.
No cloud model, credentials, fallback, external requests, or model
downloads. Re-run both arms for all 100 cases: earlier 18-case
checkpoints did not record precisely matching context and prompt digests
or this full-run slot contract, and are not reused.

## Reproduction and checkpoints

```sh
npm ci
npm run build
mkdir -m 700 -p tmp
node bin/project-memory-answer-oracle.mjs --full < /path/to/longmemeval_s_cleaned.json
node bin/project-memory-answer-oracle.mjs --full --run --commit "$(git rev-parse HEAD)" < /path/to/longmemeval_s_cleaned.json
```

If interrupted, wait for the previous runner to exit, then resume the
same manifest using `--full --run --resume <printed-run-directory>
--commit <original-runner-sha>`, with the same dataset on stdin.
Durable answer and grade records are private; an accepted answer is
never regenerated on resume. Accepted grades are never overwritten. The private aggregate is
replaced atomically after each case. A failed generation is retained as
a failure and not silently regenerated; missing grades can be retried
on resume without generating a new answer. No raw benchmark evidence,
questions, answers, or checkpoints are committed.

## Results

M4, Ollama 0.40.16, original runner commit
`208de180ff3a86451e079570846cc9a604dc57a6`. A process interruption
after three paired slots was resumed using its private checkpoints.
After **59m30s** elapsed, all 200 answers and 200 blind grades had
completed, with zero failed, truncated, or ungraded entries.
Post-run verification reconstructed all **200** exact serialized
contexts and answer prompts and matched their saved SHA-256 digests.
Every request stayed within both renderer caps; model-input maxima
were 2,687 (baseline) and 2,665 (weighted) tokens, and maximum
output lengths were 114 and 127. External inference cost: **USD 0**.

| Cohort (same cases per arm)                                     | Baseline correct | Weighted correct | Incorrect → correct | Correct → incorrect |
| --------------------------------------------------------------- | ---------------: | ---------------: | ------------------: | ------------------: |
| All answerable (92)                                             |               48 |               56 |                   9 |                   1 |
| All abstentions (8)                                             |                8 |                8 |                   0 |                   0 |
| Answerable excluding the earlier 18-case answer diagnostic (78) |               42 |               48 |                   7 |                   1 |
| Abstentions excluding the earlier diagnostic (4)                |                4 |                4 |                   0 |                   0 |

The full answerable cohort rose from **52.2% to 60.9%** (+8.7 percentage
points). The 82-case sensitivity subset excludes the 18 questions
previously used for direct-answer diagnosis, but stays inside the
same 100-case retrieval holdout. Its results are descriptive and it is
not an independent dataset.

| Type                      | Answerable | Baseline → weighted correct | Gains / losses | Abstentions, both correct |
| ------------------------- | ---------: | --------------------------: | -------------: | ------------------------: |
| Knowledge update          |         15 |                       7 → 6 |          0 / 1 |                     2 / 2 |
| Multi-session             |         15 |                       5 → 6 |          1 / 0 |                     2 / 2 |
| Single-session assistant  |         17 |                     11 → 15 |          4 / 0 |                   0 cases |
| Single-session preference |         17 |                     16 → 16 |          0 / 0 |                   0 cases |
| Single-session user       |         14 |                      7 → 11 |          4 / 0 |                     2 / 2 |
| Temporal reasoning        |         14 |                       2 → 2 |          0 / 0 |                     2 / 2 |

| Retrieval usage                           |          Baseline |          Weighted |
| ----------------------------------------- | ----------------: | ----------------: |
| Full evidence (answerable)                |             25/92 |             34/92 |
| Annotated turns on wire (answerable)      |            51/162 |            64/162 |
| Prep / serialized tokens (answerable)     | 180,680 / 153,418 | 180,661 / 155,337 |
| Wire slots (answerable)                   |               165 |               168 |
| Model prompt / output tokens (answerable) |   196,467 / 2,340 |   198,402 / 2,421 |
| Prep / serialized tokens (abstentions)    |   15,682 / 13,533 |   15,389 / 12,864 |
| Wire slots (abstentions)                  |                16 |                14 |

The evidence totals exactly reproduce the whole-chunk #57 replay.
The improvement is concentrated in the two single-session strata, and
knowledge update has one regression. Eight successful abstentions do
not establish no regression in the broader dataset. Keep this a local
same-model diagnostic: it is neither the official grade nor
independent-model validation, and it does not establish that this
ranking should be the runtime default.
