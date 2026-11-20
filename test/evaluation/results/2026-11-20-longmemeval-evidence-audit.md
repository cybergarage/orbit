# LongMemEval evidence audit and local oracle diagnostic (2026-11-20)

This follow-up looks for evidence bottlenecks in the same 30-case LongMemEval-S
pilot selection. It is a diagnostic, not a new official-method quality grade, a
full 500-case benchmark, or a provider ranking. The tables report separate
measurements: deterministic replay, recorded run outcomes, and a local
same-model oracle comparison.

[Back to the LongMemEval results index](../../../e2e/results/README.md#longmemeval)

## Scope and provenance

- [LongMemEval paper](https://arxiv.org/abs/2410.10813) and
  [cleaned LongMemEval-S dataset at the pinned revision](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/blob/98d7416c24c778c2fee6e6f3006e7a073259d48f/longmemeval_s_cleaned.json).
  The dataset revision is `98d7416c24c778c2fee6e6f3006e7a073259d48f`; the
  checksum and selection policy are in the [public pilot guide](../../../docs/project-memory-evaluation.md#pinned-public-data-pilot).
- All 30 pinned questions were included; 26 were answerable and four were
  unanswerable. The 26 answerable questions have 47 annotated answer turns.
- Development base: Orbit `969a9ea8cf3535954d8cb9a5e378e01ae12e537d`
  plus local evaluation-harness changes. The pinned dataset and code base
  identify the conditions; the public repository does not reproduce this
  follow-up end to end. Only reviewed aggregates are published.

## Deterministic replay: retained and returned annotations

Two runs of the same deterministic replay agreed. The
question-level column requires **all** annotated turns for a question to
survive; the earlier [read-only audit](../../../docs/project-memory-official-evaluation.md#read-only-audit-of-the-existing-30-case-pilot)
reported **at least one** fully retained turn, a different measure (15/26).

| Stage | Entire annotated turns preserved | Answerable questions with all annotated turns |
| --- | ---: | ---: |
| Original source histories | 47/47 | 26/26 |
| First 1,200 JavaScript UTF-16 code units per source session (historical ingestion) | 25/47 | 7/26 |
| Candidates available to replayed search | 25/47 | 7/26 |
| Top six ranked candidates, before applying the token budget | 13/47 | 3/26 |
| After the 2,048-token return/input budget in replay | 11/47 | 2/26 |

This separates three possible bottlenecks: truncation during ingestion, ranking
to six candidates, and the token budget after ranking. It does not establish
that the annotations are necessary or sufficient for any particular answer:
partial turns or other relevant passages can help, and preserved text may
not answer the question. The replay is not a per-cloud-request reconstruction
of what a model saw.

The reconstruction matched the 120 recorded initial-input hashes. Original
follow-up prompts, returned search text, and the mapping from returned entries
to source passages were not retained in the available records. The initial
hash match therefore cannot establish what was later delivered or attribute
individual errors to missing evidence, retrieval, or answering.

## Recorded tool-arm outcomes

These are outcomes in the recorded answer runs, not counts from the replay.
An empty retrieved-ID record is not proof that a model received an empty
result body. Columns may overlap; do not sum them into a failure total.

| Answer model | Search did not run | Search ran, no retrieved IDs recorded | Input limit hit |
| --- | ---: | ---: | ---: |
| OpenAI GPT-5.4 | 4 | 1 | 0 |
| Anthropic Claude Sonnet 5.5 | 0 | 0 | 17 |
| Ollama Gemma 4 12B | 5 | 0 | 0 |
| Apple system model | 8 | 2 | 0 |

All 17 no-search cases and all three searches without retrieved IDs were
judged incorrect in the earlier official-method evaluation. Five of the
17 Claude input-limit cases never received any tool result. Across the graded
arms, 125 of the 253 answers judged incorrect consisted only of the abstention
marker. These observations describe the recorded cases; they do not prove that
a search call or a higher limit would have made an answer correct.

## Local direct-evidence oracle

An already installed Ollama Gemma 4 12B ran 90 local inference calls for this
diagnostic, with no external paid calls. The same local model acted as an
unofficial judge. The comparison uses the saved tool-arm answers as one
condition and new answers given annotated evidence directly as the other.
The oracle bypasses ingestion and search and uses answer annotations only for
this diagnostic, not as deployable retrieval.

| Answer condition | Correct / graded by the local same-model judge |
| --- | ---: |
| Saved tool-arm answers | 13/30 |
| Direct-evidence oracle answers | 25/30 |

Changing presentation alone flipped one judgment. The older **11/30** Gemma
tool-arm result under the paper-compatible `gpt-4o-2024-08-06` grader is a
separate measurement; do not compare it as if it were the oracle's baseline.
The [pinned official-grading procedure](../../../docs/project-memory-official-evaluation.md#pinned-evaluation-inputs)
identifies the grader and protocol. The local comparison is neither an official
score nor evidence that a different retrieval policy would deliver this gain.

## Next controlled comparison

1. Record evaluation-only source/chunk alignment, search queries, which results
   actually reached the model, and stop reasons. Keep raw traces local and
   benchmark labels out of ordinary ingestion, retrieval and generation.
2. Compare question-independent turn/chunk ingestion with the unchanged prefix
   baseline on these same cases, keeping the grader and retrieval policy fixed.
3. Then change ranking and cumulative input budgeting separately. Track cases
   where no query ran, no usable result arrived, or the input limit stopped
   delivery rather than treating them as one class.
4. Manually inspect oracle misses and unstable judgments before expanding the
   sample or claiming improved benchmark quality.
