# Turn-anchor search with immediate context in LongMemEval

This is a separate, exploratory comparison on the same frozen 100-question
[holdout](2026-11-22-longmemeval-heldout-ranking.md). It evaluates a different
retrieval unit, not a second independent confirmation of document-frequency
ranking. No thresholds or neighbor sizes were tuned, and no models were called.

```sh
npm ci
npm run build
node bin/project-memory-turn-neighbors.mjs < /path/to/longmemeval_s_cleaned.json
```

## Fixed comparison

Start with the same admitted complete-turn chunks. The reference uses raw
lexical chunk ranking with whole entries. Both anchor arms choose **one**
complete turn per chunk, scoring its body with existing lexical overlap,
excluding the chunk title; ties select the earliest turn. Order slots by
anchor overlap and the original synthetic recency tie-break. The two
anchor arms share the exact rank order and positive-match gate. The first
returns only the anchor, and the second includes up to one complete turn
before and after it within the same chunk and source. No neighbor crosses
a boundary or rescues a zero-match anchor.

All arms use the same two 2,048-token caps, 16/6 slot limits, entry metadata,
project-memory and JSON renderers, and original source/turn offsets.
The neighbor control tests larger spans at fixed anchor ranking.
The comparisons against full chunks also change the scoring unit, so
they do not isolate the effect of adding context. Gold is evaluated only
after both selection stages. The manifest, ordinal-only paired results,
per-type summaries and token costs reproduce without emitting text.

## Serialized outcome

92 answerable cases contain 162 annotated turns. A full-evidence result
covers every annotated turn in that question.

| Comparison                            | Full evidence | Became / ceased full | Turns retained | Turn gains / losses |
| ------------------------------------- | ------------: | -------------------: | -------------: | ------------------: |
| Baseline chunks → anchor only         |       25 → 25 |                9 / 9 |        51 → 47 |             17 / 21 |
| Anchor only → immediate neighbors     |       25 → 26 |                4 / 3 |        47 → 51 |              12 / 8 |
| Baseline chunks → immediate neighbors |       25 → 26 |                9 / 8 |        51 → 51 |             18 / 18 |

| Question type             | Anchor-only → neighbors full evidence | Became / ceased full | Turn gains / losses |
| ------------------------- | ------------------------------------: | -------------------: | ------------------: |
| Knowledge update          |                                 4 → 3 |                1 / 2 |               2 / 5 |
| Multi-session             |                                 0 → 2 |                2 / 0 |               4 / 1 |
| Single-session assistant  |                               11 → 12 |                1 / 0 |               1 / 0 |
| Single-session preference |                                 0 → 0 |                0 / 0 |               2 / 0 |
| Single-session user       |                                 7 → 6 |                0 / 1 |               0 / 1 |
| Temporal reasoning        |                                 3 → 3 |                0 / 0 |               3 / 1 |

| Cohort and arm                         | Preparation tokens | Wire tokens | Wire slots |
| -------------------------------------- | -----------------: | ----------: | ---------: |
| Answerable, baseline                   |            180,680 |     153,418 |        165 |
| Answerable, anchor only                |            183,147 |     162,500 |        281 |
| Answerable, immediate neighbors        |            182,520 |     157,118 |        195 |
| Eight abstentions, baseline            |             15,682 |      13,533 |         16 |
| Eight abstentions, anchor only         |             16,014 |      13,483 |         23 |
| Eight abstentions, immediate neighbors |             15,756 |      12,991 |         15 |

Equal caps do not make realized token utilization or slot counts equal.
The abstention figures are retrieval costs, not correctness estimates.

Compared with anchor-only retrieval, immediate context regained some
evidence but also displaced other matches. Against full chunks, the
near-zero net change conceals substantial case-level churn. Weighted
whole-chunk ranking on this cohort reached 34/92 in a separate paired
comparison; this audit did not directly pair that arm against the
neighbor policy. These data do not justify a runtime change. A future
adoption decision would require a further fixed sample and a direct
comparison, not choosing a larger window based on this result.
