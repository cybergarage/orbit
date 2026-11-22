# Chronological preparation on a disjoint LongMemEval cohort

This offline retrieval test follows the [answer discordance audit](2026-11-22-longmemeval-answer-discordance.md).
It asks whether a narrowly gated chronological admission rule retains
more update or temporal evidence under the existing budgets. It does
not change Orbit runtime behavior or use a model.

## Frozen protocol

Input: cleaned public LongMemEval-S at repository
`xiaowu0162/longmemeval-cleaned`, revision
`98d7416c24c778c2fee6e6f3006e7a073259d48f`, SHA-256
`d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442`.
Verify and exclude the original 30 plus the exact 100-case holdout,
including the 18-case answer-diagnostic and turn-neighbor subsets.
No overlap was found with those 130 distinct known question IDs;
this does not assert no reuse by a model during training or in
unrecorded external studies.

Sort each remaining question type by SHA-256 of
`orbit-chronological-preparation-v1:<question_id>`. Take up to two
abstentions and fill to 12 with answerable questions per type. Retain
the short preference stratum (eight eligible), rather than reuse
prior cases or substitute from another type. Freeze the 68 distinct
cases (60 answerable, eight abstentions) before measurement, at
ordered SHA-256
`b4b8487e4a591df633857167ab92d40ece3f5129c9e7549b7cf9d63d0a92368f`.

The baseline is the #56 weighted whole-chunk replay. For the treatment,
require explicit current/latest/last-occurrence wording in the question.
Among the first 12 positive weighted-ranked candidates, try admitting
one with the newest valid source timestamp not after the question
timestamp. Equal dates keep weighted order. Invalid times and questions
outside the gate are unmodified. This is a lexical relevance proxy,
not semantic knowledge-update recognition. Do not use benchmark type,
annotation labels or reference answers to select. Restore actual
weighted rank for preparation rendering and result ordering. Candidate
set, scoring, 2,048-token preparation and wire caps, renderers, and
16/6-slot limits are otherwise unchanged.

Reserve inference for a result of at least two gains in _full_
serialized evidence across answerable knowledge-update and temporal
questions, strictly more gains than losses, with no new post-question
wire slots or changed untreated controls. The pre-existing baseline can
already include future-labeled distractors; treatment is not a global
future filter, and it is never allowed to promote a future entry.

## Results

| Cohort             | Questions | Wording gate / promoted | Full evidence after preparation | Full evidence on wire | Complete marked turns on wire |
| ------------------ | --------: | ----------------------: | ------------------------------: | --------------------: | ----------------------------: |
| Knowledge update   |        10 |                   3 / 2 |            See combined targets |                 2 → 0 |                 12 → 10 of 20 |
| Temporal reasoning |        10 |                   1 / 0 |            See combined targets |                 0 → 0 |                   5 → 5 of 19 |
| Combined targets   |        20 |                   4 / 2 |                           3 → 1 |                 2 → 0 |                 17 → 15 of 39 |
| All answerable     |        60 |                   6 / 4 |                         24 → 21 |               21 → 18 |                 45 → 42 of 92 |

For these paired comparisons, the target cohort had **zero gains and
two losses** in full evidence; all answerable questions had zero gains
and three losses (two updates and one single-session assistant).
There was no change before admission: of 39 target marked turns, 35
were admitted and remained lexically eligible in both arms. Preparation
retained 18 → 16 and serialization retained 17 → 15; the new losses first
occurred in preparation, not in lexical matching or additional wire
truncation. Temporal wording triggered once, but no position changed,
so this is not evidence against a treatment designed for all temporal
questions.

All **62 ungated** controls serialized byte-identically, including all
eight abstentions. Abstentions had 16 wire slots, 15,781 preparation
tokens and 13,894 wire tokens in both arms. No abstention correctness
inference follows from an unchanged context. Answerable totals were
116,978 → 116,877 preparation tokens, 99,552 → 99,524 wire tokens and
107 wire slots in either arm. Three post-question wire slots already
existed across answerable cases and five across abstentions; no new
future-labeled slots were introduced.

**Stop at retrieval.** The no-cost gate failed. No answers or grades
were generated. This small test suggests that reserving capacity for
the newest positive match can evict stronger relevant evidence;
it does not establish that all chronology-aware designs fail. The
observed preparation loss does not justify runtime recency weighting.

## Reproduce without inference

```sh
npm ci
npm run build
node bin/project-memory-chronological-preparation.mjs --manifest < /path/to/longmemeval_s_cleaned.json
node bin/project-memory-chronological-preparation.mjs < /path/to/longmemeval_s_cleaned.json
```

Both commands verify the frozen cohort. Output includes aggregate and
ordinal-only paired counts, with no questions, reference answers,
evidence text or raw dataset IDs.
