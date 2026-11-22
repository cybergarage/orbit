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
