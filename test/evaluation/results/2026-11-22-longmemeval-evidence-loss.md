# Exact-turn redundancy and evidence loss in the LongMemEval replay

This no-cost follow-up to [source-first selection](2026-11-22-longmemeval-source-diversity.md)
uses absolute lexical rank order in every run. It does not repeat the
source-first intervention, call a model, or change retrieval.

```sh
npm ci
npm run build
node bin/project-memory-evidence-loss.mjs < /path/to/longmemeval_s_cleaned.json
```

The checksum-verified public LongMemEval-S input and pinned 30-question
sample, 2,048-token caps, preparation and wire renderers, and slot limits
are those in the [complete-turn packing audit](2026-11-22-longmemeval-turn-packing.md).
Redundancy is measured for each question before aggregating. An exact
copy means another entry contains the same complete role/content turn
from the same source and same offsets. Identical text at different
positions is counted separately: it could describe another occurrence
or matter in a different temporal context. No content is emitted.

## No safe duplicates to remove

In the principal whole-chunk run, the 26 answerable cases and four
abstentions held 10,725 and 1,819 complete turn occurrences before selection,
217 and 37 after preparation, and 174 and 32 after serialization.
**Zero** exact copies of a turn were observed at any stage in either
cohort. With packing at both boundaries, serialized counts were 183 and
33, again with no exact copies. The historical prefix control also
had no exact copies (124 and 23 serialized occurrences).
These counts exclude partially represented turns.

The whole-chunk catalog contained 45 repeated role/content strings at
different offsets across the answerable cases and 62 in the abstention
cases (counting repeats after their first occurrence within a question).
Only one such repeat, at a different offset in the same source, survived
serialization in each chunk arm, both in answerable cases. This is not
an identical occurrence and was not removed. Dropping only verified
duplicate occurrences therefore has zero observed opportunities and
would change neither selection nor coverage on this sample; no alternate
deletion policy was run.

## Where the 47 annotated turns first drop out

Annotational analysis starts after the replay. A turn has to be fully
present in one excerpt; partial offsets are not joined. Later columns
count losses only if the turn survived all earlier stages.

| Rank/order held fixed                   | Ingestion | No positive lexical match | Preparation | Prepared result slots | Serialization | Serialized coverage |
| --------------------------------------- | --------: | ------------------------: | ----------: | --------------------: | ------------: | ------------------: |
| Turn chunks, whole entries              |         0 |                         0 |          37 |                     0 |             0 |                  10 |
| Turn chunks, packing at both boundaries |         0 |                         0 |          34 |                     0 |             3 |                  10 |
| Historical prefix, whole entries        |        22 |                         0 |          14 |                     0 |             0 |                  11 |

For the preparation misses, the first qualifying positive candidate
was ranked 1–6 for 8 turns, 7–16 for 12, and 17 or later for 17 in the
whole-chunk replay. With packing, the counts were 5, 12, and 17. In
each case at least one evidence-bearing entry or allowed packed prefix
would fit the preparation renderer **on its own** under the same
2,048-token budget. This checks fit after the fact; it does not use
the gold annotation to change selection or assert that all would fit
together. Positive overlap means that the ranker found a lexical match,
not that its score correctly prioritized the evidence.

The experiment rules out exact-copy elimination here and makes a
blanket claim that evidence entries are individually too large
untenable for this sample. Some evidence is already ranked in the
top six but cannot survive greedy cumulative allocation; lower-ranked
evidence also merits separate investigation. If continuing, test a
strictly score-preserving budget allocation control against rank-only
changes, with a separate held-out sample before drawing general
conclusions. No thresholds were selected from this audit, and no
claim about answer quality or abstention correctness follows.
