# Project Memory Pilot — 2026-11-19

This is an isolated public-data pilot, not an official LongMemEval score or approval for Nest integration. No user memory was used.

## Evidence

- [Reviewed aggregate results](2026-11-19-summary.json): counts, category summaries, token/latency totals and measurement limits only.
- The completed local pilot contains 90 generation arms for 30 cases. Per-case predictions, source identifiers, prompts, raw benchmark data and execution logs remain local and are not published.
- The separate 30-case mock run verifies pipeline execution and does not measure model quality. The live synthetic A/B check verified dispatch and expected provenance; the final prose omitted the requested citation.

Baseline Core: `c120f125a81a7ac5fcb1b277b5c8bbd4cdc94315`. The pilot started before the final preparation-time scope guard/non-UUID compatibility checks; those checks are covered by deterministic tests and do not change the fixed-scope UUID benchmark cases. Initial build bytes were not archived.

Model: `gemma4:12b`, digest `4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c`, Ollama `0.40.16`, Q4_K_M. Generation settings: temperature 0, thinking off, context 8,192 and output cap 512.

Official cleaned LongMemEval-S revision: `98d7416c24c778c2fee6e6f3006e7a073259d48f`; the checksum is in the aggregate and the selection algorithm is in the harness. Five cases per category, including four abstention cases. Ingestion stores one question-blind 1,200-character source-session prefix per chronological session, with canonical Core provenance. No extraction model was evaluated.

## Aggregate measurements

Accuracy below is from a fallible local model judge. Four initial grading calls returned only two judgments; one syntax-only retry per failed case used a fixed three-boolean schema. Local per-case records preserve the original errors and retry telemetry; only safe totals are published. Generated answers, retrieved IDs and generation telemetry were verified unchanged.

| Arm                  | Local judge accuracy | Strict reference-containment proxy | Source recall at 6 | Search dispatch | Mean arm latency | Input / output tokens |
| -------------------- | -------------------: | ---------------------------------: | -----------------: | --------------: | ---------------: | --------------------: |
| No retrieval         |         9/30 (30.0%) |                               4/30 |        0/46 (0.0%) |            0/30 |            3.76s |           4,317 / 920 |
| Host pre-retrieval   |        13/30 (43.3%) |                               7/30 |      18/46 (39.1%) |            0/30 |           20.00s |          65,697 / 712 |
| Model-invoked search |        17/30 (56.7%) |                               8/30 |      24/46 (52.2%) |           25/30 |           20.30s |        59,110 / 1,854 |

All arms used the same stored memories. Tool retrieval ran in 25/30 cases (25 dispatches, 55 model calls); no/pre arms used 30 model calls each. All 90 generation arms completed. All four designated abstention cases used the required marker correctly in every arm. Additional abstentions on answerable cases were 19 / 14 / 10 for no/pre/tool, respectively.

## Accuracy by category

Each cell is correct / 5 according to the local judge.

| Category                  | No retrieval | Host pre-retrieval | Model-invoked search |
| ------------------------- | -----------: | -----------------: | -------------------: |
| knowledge-update          |          1/5 |                3/5 |                  3/5 |
| multi-session             |          3/5 |                4/5 |                  5/5 |
| single-session-assistant  |          0/5 |                1/5 |                  3/5 |
| single-session-preference |          0/5 |                0/5 |                  0/5 |
| single-session-user       |          3/5 |                3/5 |                  3/5 |
| temporal-reasoning        |          2/5 |                2/5 |                  3/5 |

The model did not call search on any of the five preference questions. The historical generic judge labeled all five incorrect in every arm; these are not settled official-rubric judgments. Publishing a tool does not guarantee its use. The strongest observed category gain was multi-session recall, but five cases are too few for a general quality claim.

## Diagnostic attribution on incorrect answers

| Arm                  | Ingestion miss | Retrieval miss | Answer error | Execution/provider error |
| -------------------- | -------------: | -------------: | -----------: | -----------------------: |
| No retrieval         |              9 |             12 |            0 |                        0 |
| Host pre-retrieval   |              8 |              7 |            2 |                        0 |
| Model-invoked search |              7 |              5 |            1 |                        0 |

These are hierarchical diagnostics on failed answers, not independent causal estimates. The strict ingestion check asks whether a complete annotated answer message survived a prefix; partial evidence can still suffice. Source recall counts original sessions, not answer-bearing passages, so a retrieved prefix can count while omitting the answer.

## Cost and measurement limits

Generation used 115 model calls, 129,124 input tokens and 3,486 output tokens. Known judge usage, including retries, is 6,795 input / 300 output tokens; usage and latency for four malformed initial judge calls were not retained. Provider charges were USD 0; electricity and hardware cost are unknown. Latencies were collected while repository validation also ran, so they are not isolated performance measurements.

This 30-case English sample does not qualify production automatic extraction, Japanese recall, embeddings, full-transcript retrieval, or the full 500-case benchmark. The same-model judge can be biased, and the strict containment proxy is incomplete. A separate judge/human audit and a better ingestion baseline are needed before product decisions.

The official preference rubric accepts correct use of relevant personal information
without requiring every rubric point. The initial generic grader compares responses
to a reference and does not implement that category-specific rule. A subsequent
read-only review identified possible false negatives and alternative relevant
history outside the annotated answer Session, without changing the historical
scores above. The five cases also mix missing late-turn preferences, retained
but unselected information, and absent tool dispatch. Per-case returned text and
Core-to-dataset mappings were not retained, so source-recall zero is not proof
that no relevant information was used. Priority follow-ups are category-aware
blind grading, an auditable evaluation-only retrieval manifest, question-blind
turn coverage, and personalized-advice tool-use controls. This PR does not change
those grading or ingestion policies.

Official rule: [preference evaluation rubric](https://github.com/xiaowu0162/LongMemEval/blob/main/src/evaluation/evaluate_qa.py#L34).

## Reproduction

See [the evaluation guide](../../../docs/project-memory-evaluation.md) for the pinned download, deterministic tests, mock/live commands, and optional syntax regrading. No models are downloaded and no cloud fallback is available.

## Implementation validation

- Full `npm test`: 1,396 passing (includes ten search controls).
- Separate evaluation integrity tests: five passing.
- Header check, TypeScript/GUI build and independent package-consumer test: passed.
- Changed-file ESLint: zero errors; ten complexity/depth/parameter warnings.
- `git diff --check`: passed. The implementation is proposed for review; no merge or Nest integration is implied.
