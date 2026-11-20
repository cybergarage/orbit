# LongMemEval-S paired ingestion replay (2026-11-20 UTC)

The same 30 pinned public cases were replayed with the original 1,200 UTF-16
code-unit source-session prefix and with chronological whole-turn chunks. The
dataset SHA-256 and selection are unchanged from the
[historical pilot](../../../docs/project-memory-evaluation.md#pinned-public-data-pilot).
The replay completed **30/30 pairs**, without inference, a judge, or model
delivery. These are evidence-coverage proxies, not quality scores.

| Replay stage | Prefix: full annotated turns | Turn chunks: full annotated turns | Prefix: questions with all annotated turns | Turn chunks: questions with all annotated turns |
| --- | ---: | ---: | ---: | ---: |
| Original source histories | 47/47 | 47/47 | 26/26 | 26/26 |
| Admitted to the catalog | 25/47 | 47/47 | 7/26 | 26/26 |
| In the first six positive-overlap candidates before budgets | 13/47 | 18/47 | 3/26 | 8/26 |
| In the returned entries after preparation and serialization budgets | 11/47 | 10/47 | 2/26 | 5/26 |

The chunk policy retained all 47 annotated turns in this sample. The unchanged
128-entry cap omitted 1,223 candidate chunks across 30 cases; the 8,192-byte
single-entry cap separately excluded 15 oversized turns across 13 cases. No
additional omission came from the 1 MiB Project body cap, and no counted
omission contained a full annotated turn. This does not mean the omitted text
was irrelevant or that the sample represents other histories.

At top six, chunks preserved more annotated turns. After budgets, chunks
returned one fewer annotated turn overall but fully covered three more
questions. A larger catalog and better top-six coverage did not translate
into higher total returned-turn coverage under the same limits. Partial
passages and unannotated context can still be useful; all turns present is
not proof the model could answer.

## Any versus all evidence and source diversity

"Any" counts a question with at least one fully retained annotated turn. "All"
requires every annotated turn. Both columns use the same 26 answerable questions.

| Stage | Prefix: any / all | Turn chunks: any / all |
| --- | ---: | ---: |
| Admitted to the catalog | 15 / 7 | 26 / 26 |
| Before budgets, first six positive-overlap entries | 10 / 3 | 15 / 8 |
| After budgets, returned entries | 9 / 2 | 10 / 5 |

Six entries need not represent six different source Sessions. Match each selected
entry ID to its original Session offset map, count distinct Session indices
within the case, then sum the per-case counts across the same 30 pairs.

| Replay stage | Prefix: entries / distinct sources | Turn chunks: entries / distinct sources |
| --- | ---: | ---: |
| Before budgets, first six positive-overlap entries | 180 / 180 | 180 / 135 |
| After budgets, returned entries | 119 / 119 | 59 / 50 |

The comparison keeps the entry limit, ranking and budgets fixed, rather than
forcing the same number of distinct source Sessions. These counts identify a
difference in evidence granularity and source variety; they do not alone prove
why a particular fixed query missed a useful turn.

## Reproduction boundary

The [study guide](../../../docs/project-memory-evaluation.md#paired-ingestion-study-and-private-tracing)
documents the fixed-query replay, whole-turn packing, and the separate model
and judge mode. Replay uses the historical host query and the current Core
selector, plus a local reproduction of the serialized result limit. Synthetic
entry IDs and monotonic fixture timestamps keep ties deterministic; this is
not a reconstruction of a prior live request, model search query, or provider
acceptance. Local-model runs and eligible paired accuracy counts must be
reported separately. No local or hosted model was run for the replay above.

## Interrupted live local comparison: 24/30 pairs

This is separate from the complete replay above. The live run used local Ollama
Gemma 4 12B at the pinned model digest, the pinned public dataset, and frozen
harness commit [`b79afed`](https://github.com/cybergarage/orbit/commit/b79afed20dafd5fd79349ec5857fad600fffd5d9).
It made no cloud or paid requests. Only 24 paired cases were saved; all **144**
answers in them completed and received a valid judgment from the same Gemma
model acting as a separate local judge. This is not official LongMemEval grading.
No context overflow or rejected provider requests were observed in the saved
cases. The process ended before a final summary was written; its exit cause and
code are unknown. The last six pairs have no measured result and are not counted
as failures. No rerun or pooling was performed.

| Retrieval arm | Prefix correct | Turn chunks correct | Both correct | Turn chunks only | Prefix only | Neither correct |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| No search (negative control) | 5/24 | 9/24 | 4 | 5 | 1 | 14 |
| Host prefetch | 9/24 | 14/24 | 8 | 6 | 1 | 9 |
| Model-invoked search | 12/24 | 17/24 | 10 | 7 | 2 | 5 |

For the 21 answerable cases in the partial sample, prefix and chunks admitted
**19/38** and **38/38** complete annotated turns, respectively. All annotated
turns were admitted for **5/21** questions with prefix and **21/21** with chunks.
Complete annotated turns delivered in acknowledged model requests were **7 → 7**
for host prefetch and **9 → 10** for tool search. The model dispatched search on
**19/24** questions in each tool arm. The delivery counts are annotation proxies,
not proof that the model used a passage or had sufficient evidence.

The no-search score also shifted **5 → 9**, even though that arm receives neither
a tool nor prefetched evidence. The intended no-search prompt and settings are
unchanged; generation pins temperature zero but not a seed, and each condition
is judged separately with all three sibling answers in its judge request.
The aggregates cannot distinguish generation variation from judge sensitivity.
The two search arms each gained five correct judgments, but similar improvement
in the control and small absolute changes in evidence delivery prevent assigning
those gains to ingestion.

The frozen runner writes individual case files but cannot resume the same run:
it requires a new directory, starts at the first case, and writes the summary
only at the end. Keep this partial result separate. For a future evaluation on
the same 30 cases:

1. Generate and judge one shared no-search response per case, or run a separate
   repeated-seed noise assessment rather than mixing repetitions into this pair.
2. Judge each hypothesis independently under a fixed, blinded rubric, without
   the sibling responses or the ingestion condition in the judge input.
3. Before any continuation, verify the exact harness commit, dataset checksum,
   model digest, settings, and planned case IDs against the saved manifest.
   Count only validated complete pairs. Without a verified restart path, a new
   execution is a separate run, not a continuation of these 24 pairs.
