# Fixed document-frequency weighting in the LongMemEval replay

This offline sensitivity check follows the
[preparation-loss audit](2026-11-22-longmemeval-evidence-loss.md).
It changes only the ranking of the same candidates; no runtime
behavior, model calls, answer grades, or external tuning is involved.

```sh
npm ci
npm run build
node bin/project-memory-df-ranking.mjs < /path/to/longmemeval_s_cleaned.json
```

## Design

Use the same checksum-verified public LongMemEval-S input and fixed order
of 30 questions as the [packing replay](2026-11-22-longmemeval-turn-packing.md).
For each query and its admitted catalog of size N, let df(t) count
entries containing term t, once per entry. The experiment scores a
candidate by summing `1 + ln((N + 1) / (df(t) + 1))` over distinct
matching query terms. The formula is fixed, not fitted. Compute weights
before packing, over the full admitted catalog. Zero-match candidates
remain after all positive matches, and equal weighted scores preserve
the original rank. The benchmark entries have homogeneous importance;
this test does not prescribe how a weighted runtime score should blend
importance. An assertion checks the unweighted match count against the
existing implementation for every candidate; a synthetic Japanese test
also covers rarity and the existing normalization. It is not a Japanese
benchmark or a tokenizer change.

Both arms receive identical queries, entries, two 2,048-token caps,
renderers, 16 preparation slots and six result slots. Match scores
are frozen before clipping as in the prior offline study. Labels are
consulted only for evaluation, after selection. The principal condition
uses turn-chunk ingestion with whole entries, with separate controls
for packing and historical prefix ingestion. No texts or source
identifiers are emitted. The local JSON records per-question pairs by
sample ordinal and separates changes in covered evidence from changes
in counts.

## Results

Answerable cohort: 26 questions with 47 annotated turns. Gains and
losses are paired at the individual annotated-turn level. Full
evidence requires covering every annotated turn for a question.

| Condition and stage                   | Annotated turns | Gains / losses | Full evidence | To / from full |
| ------------------------------------- | --------------: | -------------: | ------------: | -------------: |
| Turn chunks, ranked top six           |         18 → 25 |        +7 / −0 |        8 → 13 |          5 / 0 |
| Whole chunks, prepared                |         10 → 12 |        +2 / −0 |         5 → 5 |          0 / 0 |
| Whole chunks, serialized              |         10 → 12 |        +2 / −0 |         5 → 5 |          0 / 0 |
| Packed at both boundaries, prepared   |         13 → 16 |        +4 / −1 |         6 → 6 |          1 / 1 |
| Packed at both boundaries, serialized |         10 → 14 |        +4 / −0 |         5 → 5 |          0 / 0 |
| Historical prefix, whole, serialized  |         11 → 12 |        +1 / −0 |         2 → 3 |          1 / 0 |

Two whole-chunk questions and four packed questions improved in
serialized turn coverage. No question lost or exchanged a serialized
annotation in those conditions. The packed preparation loss did not
survive to serialization in the baseline either. The gain of seven at
ranked top six and the serialized gains are not additive: ranked top six
is a pre-budget counterfactual, not an input to the preparation stage.

| Answerable utilization    | Preparation tokens | Serialized tokens | Serialized slots | All / relevant sources |
| ------------------------- | -----------------: | ----------------: | ---------------: | ---------------------: |
| Whole chunks              |    51,514 → 51,189 |   46,458 → 46,431 |          50 → 50 |      42 → 42 / 16 → 18 |
| Packed at both boundaries |    51,863 → 51,720 |   48,555 → 49,608 |          59 → 60 |      49 → 51 / 17 → 21 |
| Historical prefix         |    52,277 → 51,763 |   49,825 → 49,983 |        103 → 103 |    103 → 103 / 19 → 19 |

Four abstention cases, separately: whole chunks used 7,953 → 7,910
preparation tokens and 7,464 → 7,488 serialized tokens (9 → 9 serialized
slots, 8 → 7 source occurrences). Packing used 7,977 → 7,904 and
7,556 → 7,581 tokens (10 → 10 slots, 10 → 9 sources). Historical prefix
used 7,705 → 7,662 and 7,690 → 7,673 tokens (16 → 16 slots and
16 → 16 sources). No conclusions about abstention correctness follow.

The signal is encouraging but remains a same-sample evidence diagnostic.
The chunk-based full-evidence metric did not improve after budgeting.
Packing also used about 1,050 more wire tokens in aggregate; equal caps
do not make realized utilization equal. Before any runtime choice,
replicate on a separately fixed holdout with the same weighting formula
and budgets. Do not infer improvements to answers or generalization
from this report.
