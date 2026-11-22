# LongMemEval-S: equal-budget complete-turn packing (2026-11-22)

This evaluation-only replay compares current whole-entry selection with a
greedy complete-turn prefix. It makes no model requests, changes no runtime
default, and measures evidence retention, not answer accuracy.

[Back to Coding E2E history](../../../e2e/results/README.md#longmemeval) ·
[Paired ingestion study](2026-11-20-ingestion-replay.md) ·
[Prior fixed-query audit](https://github.com/cybergarage/orbit/pull/51#issuecomment-7050315098)

## Method

- Base: `4f3dd6bddcb414bd979a062eb2f5b99856900527` (#51 squash merge).
  Same pinned public dataset ([revision
  98d7416c](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/blob/98d7416c24c778c2fee6e6f3006e7a073259d48f/longmemeval_s_cleaned.json)).
  The script verifies the file SHA-256 and the ordered question selection
  digest, previously verified against the #51 run manifest. There are 30
  questions, of which 26 are answerable and contain 47 annotated turns.
- Fix the query to the historical current-date prefix followed by the
  question, cut at 512 JavaScript code units. Freeze candidate order and
  positive lexical overlap **before** packing (including ties and if a packed
  prefix no longer contains the original matching term). Use synthetic,
  repeatable metadata common to all arms to model the Core envelopes. This is
  not a byte-for-byte replay of live IDs, timestamps or provider requests.
- Independently cap preparation and result serialization at 2,048 tokens
  using their existing envelope layouts and the same tokenizer. Keep the
  16-prepared-entry and six-positive-result limits, preparation's skip-on-miss,
  and serialization's stop-on-miss. One original entry consumes at most one
  slot; packed turns preserve identity and metadata, and never reach outside
  the admitted span. Choose the longest fitting prefix of complete turns,
  with no labels used in selection. The whole baseline reproduces the
  reference replay's rank/preparation/result IDs for each question.
- Run separate crossed arms: whole/whole, packing at preparation only (packed
  text propagates unchanged), packing at serialization only, and packing at
  both gates. Serialization may only shorten what survived preparation and
  never promotes a seventh result. On the historical prefix condition the
  whole baseline may contain a trailing partial turn; packing may discard that
  fragment even if it fits. Neither arm restores any missing ingestion text.
- An annotation is covered only by a complete aligned turn. Source diversity
  counts distinct original sessions per question and sums over all 30,
  including the four abstentions. Annotations are read after selection; they do
  not establish necessity or sufficiency.

## Results

Cells show **complete annotated turns / questions with all annotations /
source-session sum**. Denominators are 47 turns and 26 questions. Top six is the
independent pre-budget ranking reference, not an intermediate subset of
preparation; the latter can also admit candidates ranked below six.

| Ingestion         | Arm (preparation / serialization) | Ranked top six |     Prepared | Prepared positive top six |   Serialized |
| ----------------- | --------------------------------- | -------------: | -----------: | ------------------------: | -----------: |
| Whole-turn chunks | Whole / whole                     |   18 / 8 / 135 |  10 / 5 / 76 |               10 / 5 / 76 |  10 / 5 / 50 |
| Whole-turn chunks | Pack / whole                      |   18 / 8 / 135 |  13 / 6 / 79 |               13 / 6 / 79 |  10 / 5 / 53 |
| Whole-turn chunks | Whole / pack                      |   18 / 8 / 135 |  10 / 5 / 76 |               10 / 5 / 76 |  10 / 5 / 54 |
| Whole-turn chunks | Pack / pack                       |   18 / 8 / 135 |  13 / 6 / 79 |               13 / 6 / 79 |  10 / 5 / 59 |
| Historical prefix | Whole / whole                     |   13 / 3 / 180 | 11 / 2 / 148 |              11 / 2 / 148 | 11 / 2 / 119 |
| Historical prefix | Pack / whole                      |   13 / 3 / 180 | 14 / 4 / 263 |              13 / 3 / 180 | 12 / 3 / 175 |
| Historical prefix | Whole / pack                      |   13 / 3 / 180 | 11 / 2 / 148 |              11 / 2 / 148 | 10 / 2 / 134 |
| Historical prefix | Pack / pack                       |   13 / 3 / 180 | 14 / 4 / 263 |              13 / 3 / 180 | 12 / 3 / 176 |

Before ranking, admitted whole-turn chunks retain 47/47 annotated turns,
versus 25/47 for the historical prefix. All candidates in both conditions
have positive lexical overlap on this sample. For whole-turn chunks,
packing at preparation raises coverage by three turns at that gate, but the
serialized result has no aggregate coverage gain in either packed arm. It
does carry more distinct source sessions, 59 versus 50 summed over 30
questions when packing both gates. On historical prefixes, packing both adds
one complete annotated turn and one question with all annotations; packing
only at serialization loses one complete turn. A longer or more diverse
result is not necessarily better evidence.

The token **caps** are equal; actual use is not. Whole-turn chunks average
1,982 prepared and 1,797 serialized tokens in the whole arm, versus 1,995
prepared and 1,870 serialized with both packing gates. The historical prefix
changes from 1,999/1,917 to 1,987/1,773 (rounded means). Envelope metadata is
held constant for a given entry and not removed; changes in counts and actual
token use are consequences of packing. Different total budgets, whole-turn
selection other than a prefix, and per-turn matching/ranking were not tested.
These results do not justify changing a default. The next tightly controlled
comparison could test round-robin minimum allocation under the same two caps,
or score relevant complete turns with separately labeled ranking changes.

## Reproduce

```sh
npm ci
npm run build
node bin/project-memory-turn-packing.mjs /path/to/longmemeval_s_cleaned.json
```

Use the pinned dataset and read its evidence locally. The script emits
aggregates only; it does not upload source histories, questions, traces,
answers, or record IDs. The synthetic suite checks complete turn boundaries,
stable metadata/rank, and canonical whole-entry baseline parity. This
small diagnostic does not make a model comparison or an official
LongMemEval scoring claim.
