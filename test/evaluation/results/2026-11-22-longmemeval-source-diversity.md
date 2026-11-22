# Fixed-budget source-first selection in LongMemEval

This offline replay asks whether promoting one entry per source session
preserves more annotated evidence under the existing evaluation budgets. It
does not invoke a model, grade answers, or change Orbit runtime defaults.

## Setup

From a built checkout, run:

```sh
npm ci
npm run build
node bin/project-memory-source-diversity.mjs < /path/to/longmemeval_s_cleaned.json
```

The input and ordered sample are checksum-verified against the
[turn-packing replay](2026-11-22-longmemeval-turn-packing.md), derived from
cleaned public LongMemEval-S revision
`98d7416c24c778c2fee6e6f3006e7a073259d48f`. This is the same 30-case sample:
26 answerable cases with 47 marked turns, plus four abstention cases. Both
arms use the same dated query, catalog metadata, lexical ranking scores,
tokenizer, preparation renderer, JSON renderer, 2,048-token budget **at each
stage**, 16 preparation slots, and six result slots. The principal run uses
whole entries produced with complete-turn chunk ingestion. Two controls
hold the ingestion/rendering policy fixed between arms: historical prefix
ingestion with whole entries, and complete-turn packing at both boundaries.

The source-first arm stably partitions positive-overlap entries into the
highest-ranked one per source, then all remaining positive entries in
their original rank order. Nonpositive entries retain order and come last.
This is a priority rule, not a hard one-per-source quota: later entries
from the same source may fit in backfill. Neither policy gets gold labels
before selection. Source identity is the original haystack session ordinal
within each case, not the text-bearing benchmark session identifier. A
relevant source in this report contains at least one annotated turn even
if the selected excerpt does not contain it. Covering a turn requires the
entire span in one excerpt; overlapping fragments are not combined.

## Paired results

These are sums over the 26 answerable cases, except the full-evidence
column, which counts questions. An arrow means rank order → source-first.

| Whole-entry chunks, stage      | Turns (of 47) | Turn gains / losses | All sources | Relevant sources |     Slots | Full evidence (of 26) |
| ------------------------------ | ------------: | ------------------: | ----------: | ---------------: | --------: | --------------------: |
| Ranked top six, before budgets |       18 → 14 |               2 / 6 |   115 → 156 |          25 → 29 | 156 → 156 |                 8 → 5 |
| Prepared                       |        10 → 7 |               0 / 3 |     65 → 74 |          16 → 17 |   74 → 75 |                 5 → 5 |
| Prepared positive top six      |        10 → 7 |               0 / 3 |     65 → 74 |          16 → 17 |   74 → 75 |                 5 → 5 |
| Serialized                     |        10 → 7 |               0 / 3 |     42 → 51 |          16 → 17 |   50 → 51 |                 5 → 5 |

At ranked top six, one question gained turns on net, four lost, and one
swapped evidence at an unchanged count. Three transitioned out of full
evidence and none in. In the serialized result, three questions each lost
one turn; none gained, swapped, or changed full-evidence status. No annotated
text or question IDs are needed to reproduce the per-question pairing:
the local JSON includes only sample ordinals, counts, transitions and costs.

Total preparation tokens were 51,514 → 51,434, and total serialized tokens
46,458 → 46,588, so the fixed cap does not mean equal token utilization.
In the **four abstention cases**, preparation used 7,953 → 7,648 tokens;
serialization used 7,464 → 7,626 tokens, with 9 → 10 slots and 8 → 10
source occurrences. Annotated-turn and full-evidence metrics do not measure
abstention correctness. No answers were generated.

| Control (26 answerable cases)           | Serialized turns | Gains / losses | All sources | Relevant sources | Serialized slots | Full evidence |     Prep tokens | Serialized tokens |
| --------------------------------------- | ---------------: | -------------: | ----------: | ---------------: | ---------------: | ------------: | --------------: | ----------------: |
| Prefix / whole                          |          11 → 11 |          0 / 0 |   103 → 103 |          19 → 19 |        103 → 103 |         2 → 2 | 52,277 → 52,277 |   49,825 → 49,825 |
| Turn chunks / packed at both boundaries |           10 → 7 |          0 / 3 |     49 → 57 |          17 → 17 |          59 → 57 |         5 → 5 | 51,863 → 52,365 |   48,555 → 47,734 |

Prefix ingestion has only one entry per source, so the result is unchanged.
For the four abstentions in the prefix control, rank and source-first used
7,705 preparation tokens and 7,690 serialized tokens (16 serialized slots,
16 source occurrences). In the packed control abstentions, preparation
used 7,977 → 7,917 tokens and serialization used 7,556 → 7,506 tokens
(10 serialized slots and 10 source occurrences in each arm).

## Interpretation

This particular hard priority order increased observed source breadth but
reduced marked-turn coverage, even when allowing complete-turn packing.
Visiting a source containing an answer is not equivalent to retaining the
answer-bearing excerpt. This small, fixed replay provides no support for
making the policy a default or inferring changes in answer quality.
