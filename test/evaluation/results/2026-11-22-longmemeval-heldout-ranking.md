# Held-out LongMemEval check of document-frequency ranking

This evaluation-only follow-up to the [30-question experiment](2026-11-22-longmemeval-df-ranking.md)
uses identical retrieval arms, but excludes every question from that experiment.
The primary metric is paired **full annotated-turn coverage after serialization**
on answerable questions. This is an evidence check, not an answer-quality or
abstention-correctness benchmark. No model requests are made.

```sh
npm ci
npm run build
node bin/project-memory-heldout-ranking.mjs --manifest < /path/to/longmemeval_s_cleaned.json
node bin/project-memory-heldout-ranking.mjs < /path/to/longmemeval_s_cleaned.json
```

## Frozen sample and arms

Use the pinned cleaned LongMemEval-S public variant from
`xiaowu0162/longmemeval-cleaned` revision
`98d7416c24c778c2fee6e6f3006e7a073259d48f` and file SHA-256
`d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442`.
The process verifies both ordered sample digests before replay. The pilot
digest is `b72fedf8e7b2d95eaf8d991a0057d9c642dc80ce01096c98d3a18486b8a33690`.
The 100-question holdout digest is
`f2b6da344cac943c6e01ae05b33df7714e42e0c062cb4fd1060fe8378e937d1b`.

Exclude the 30 pilot IDs from the same file. Sort question types lexically
and allocate 17 questions each to the first four types and 16 each to the
last two. Within each type sort by SHA-256 of
`orbit-longmemeval-holdout-v1:<question_id>`. Take up to two abstention
questions by that order first, then fill the remaining quota with answerable
questions. The 100 distinct questions include 92 answerable and 8 abstention
items. The selection rule and hashes were fixed before replay. This is
a deterministic, stratified re-sample of the same data variant, not a
distinct corpus or an estimate using the benchmark's original type frequencies.

Compare current lexical ordering with the exact #56 document-frequency
weighting function, without changing terms, the positive-match gate,
candidate set, 2,048-token caps at preparation and serialization,
16/6-slot limits, renderers or evidence identity. Both retrieve evidence
from the same candidate spans. Whole turn-chunk entries are primary;
packing complete turns at both boundaries and historical prefix
ingestion are controls. Annotation labels and cohorts are used for
measurement, not ranking. JSON reports ordinals and aggregate metrics
without any question text, histories, raw IDs or annotations.

A turn-anchor-plus-neighbor search changes the candidate representation
as well as order and is not part of this replication. A later independent
evaluation can fix the same corpus and compare isolated anchor ranking
with and without one complete neighboring turn on each side within
the same source. That requires separate privacy and identity/serialization
checks; no conclusions about that approach are made here.

## Paired results

These counts compare raw lexical order → weighted order in 92 answerable
questions with 162 annotated turns. The gains/losses are paired on exact
turn identity, not inferred from aggregate differences.

| Serialized condition                              | Full evidence | To / from full | Annotated turns | Turn gains / losses | Wire slots | Preparation tokens |       Wire tokens |
| ------------------------------------------------- | ------------: | -------------: | --------------: | ------------------: | ---------: | -----------------: | ----------------: |
| Whole turn chunks (primary)                       |       25 → 34 |         10 / 1 |         51 → 64 |              16 / 3 |  165 → 168 |  180,680 → 180,661 | 153,418 → 155,337 |
| Turn chunks, complete-turn packing at both stages |       28 → 38 |         11 / 1 |         55 → 70 |              18 / 3 |  208 → 209 |  183,422 → 183,364 | 173,289 → 173,278 |
| Historical prefix, whole entries                  |       12 → 18 |          6 / 0 |         42 → 54 |              12 / 0 |  366 → 362 |  182,506 → 181,857 | 177,711 → 176,066 |

Whole chunks improved full evidence by 9/92 (9.8 percentage points),
with one regression and one further question exchanging annotations at
the same count. Annotated-turn recall increased from 31.5% to 39.5%
(whole chunks) and from 34.0% to 43.2% (packed). Realized wire costs
are not forced equal: the whole entry arm used 1,919 more tokens in
aggregate, while the packed control used 11 fewer.

| Question type             | Answerable / abstention | Whole: full evidence | To / from full | Packed: full evidence | To / from full |
| ------------------------- | ----------------------: | -------------------: | -------------: | --------------------: | -------------: |
| Knowledge update          |                  15 / 2 |                2 → 2 |          0 / 0 |                 3 → 4 |          1 / 0 |
| Multi-session             |                  15 / 2 |                1 → 2 |          1 / 0 |                 3 → 4 |          1 / 0 |
| Single-session assistant  |                  17 / 0 |              11 → 16 |          5 / 0 |               11 → 16 |          5 / 0 |
| Single-session preference |                  17 / 0 |                1 → 1 |          0 / 0 |                 1 → 1 |          0 / 0 |
| Single-session user       |                  14 / 2 |               7 → 10 |          3 / 0 |                7 → 10 |          3 / 0 |
| Temporal reasoning        |                  14 / 2 |                3 → 3 |          1 / 1 |                 3 → 3 |          1 / 1 |

Of the ten gains in fully covered whole-chunk questions, eight were
single-session assistant/user. Temporal reasoning contained both a
full-evidence gain and a regression; the unchanged aggregate hides that
tradeoff. These small strata are descriptive, not separate reliable
estimates.

| Eight abstentions, separate | Preparation tokens |     Wire tokens | Wire slots |
| --------------------------- | -----------------: | --------------: | ---------: |
| Whole turn chunks           |    15,682 → 15,389 | 13,533 → 12,864 |    16 → 14 |
| Turn chunks, packed         |    15,981 → 16,000 | 14,846 → 14,596 |    18 → 17 |
| Historical prefix, whole    |    16,098 → 15,766 | 15,273 → 15,269 |    32 → 32 |

Fewer returned entries on abstention prompts do not establish correct
abstention. No responses were generated. The held-out result justifies
further evaluation of this hypothesis at fixed settings; it does not
justify conclusions about downstream answer accuracy or changing a
runtime default.
