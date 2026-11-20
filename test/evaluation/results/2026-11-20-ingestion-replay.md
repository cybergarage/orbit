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

## Reproduction boundary

The [study guide](../../../docs/project-memory-evaluation.md#paired-ingestion-study-and-private-tracing)
documents the fixed-query replay, whole-turn packing, and the separate model
and judge mode. Replay uses the historical host query and the current Core
selector, plus a local reproduction of the serialized result limit. Synthetic
entry IDs and monotonic fixture timestamps keep ties deterministic; this is
not a reconstruction of a prior live request, model search query, or provider
acceptance. Local-model runs and eligible paired accuracy counts must be
reported separately. No local or hosted model was run for this report.
