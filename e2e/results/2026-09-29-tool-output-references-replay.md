# Lossless tool-output factoring — identical-history comparison, 2026-09-29

**Input duplication was reduced without changing canonical history. The candidate completed compaction, but the final summary still lost important work-state facts. No speedup is established.** The baseline stopped after 841.55 seconds without a checkpoint; the candidate completed all 77 messages and saved a checkpoint after 1,488.13 seconds. Both conditions received the same frozen history and UUIDs.

This is a complete core-compaction diagnostic with real Ollama summaries and a fixed final consumer. It is **not a new SWE-bench solve or official grade**, and one serial baseline/candidate pair does not establish a success rate or general latency improvement. [Curated JSON](2026-09-29-tool-output-references-replay.json) contains identities, source coverage, requests, validation events, usage and the saved summary.

## Input invariant and measured outcome

For one rendering of all 77 canonical messages, 21 repeated stream strings were factored. Serialized source size fell from **162,302 to 127,176 UTF-8 bytes**, saving **35,126 bytes (21.64%)**. Every projected message independently reconstructed to the original field values. This is an offline source-size measurement, not a reduction in total provider tokens.

Only a `stdout`/`stderr` string exactly contained in one text block is replaced, with its named stream and UTF-16 slice retained. Other metadata, whitespace, source IDs and content remain intact. Short, empty and unmatched streams remain literal. Canonical history and source digests retain original results. Opaque runtime proofs were already excluded from summary input and were removed from this replay fixture; **authenticated observation projection is not exercised**.

| Measurement | Baseline core `08097e5` | Factoring core `be5a77a` |
| --- | ---: | ---: |
| Assigned frozen messages / UUIDs | Same 77 | Same 77 |
| Unique messages submitted before termination | 51 | 77 |
| Accepted checkpoints | 0 | 1 |
| Compaction disposition | Failed; raw-history fallback | Completed |
| Diagnostic Run outcome / quiescence | Completed / true | Completed / true |
| Wall time inside driver | 841.55 s | 1,488.13 s |
| Summary invocations | 11 | 17 |
| Measured summary time | 841.36 s | 1,487.77 s |
| Output-length detections | 2 | 4 |
| Missing-field corrective generations | 0 | 1 |
| Provider input / output tokens (summaries only) | 57,561 / 17,199 | 108,059 / 29,390 |
| Original message fields preserved | Yes | Yes |
| Prepared-request estimate before / after saved compaction | No checkpoint | 17,119 → 2,192 |

The baseline's 4,096-token expansion also ended with `length`; it could not shrink that single complete source group further. The framework then continued with raw history, which still fit the input budget. **The fixed consumer's completed Run is not a successful compaction.** The candidate recovered from four length responses and one missing-field response, covering all source messages before checkpoint activation. Its 28 stream references across invocations include repeated sources during retries; the single-render count is 21. Provider usage is complete for all summary calls, including invalid/truncated replies. It excludes ordinary inference because the consumer was fixed and made no provider request.

Total candidate usage and time increased while processing more history. Comparing these totals as if both conditions completed equal work would be misleading. Neither condition had an environment error or unresolved cleanup; both disposable containers were removed.

## Meaning review

The candidate's final JSON passed core shape/source-ID validation and preserved the unimplemented repository fix. It did not falsely report tests passed. However, two focused semantic checks **failed**:

- The latest two executions of `/tmp/repro2/test_collect_markers.py` failed during setup with `fixture 'pytester' not found`, exit code 1. Neither source ID survives in the final summary. It instead describes an earlier proposed test as unexecuted and unsaved.
- Temporary reproduction files were created and loaded by pytest. The statements that all tool activity was read-only and no saved test exists are incorrect. The narrower statement that repository source was not fixed is consistent with the frozen run's empty patch.

These errors are in generated prose, not lost input fields: the complete original commands/results were restored and submitted. Other source-code interpretation claims were not exhaustively reviewed. The replay has no authenticated observation proofs, so it cannot establish that the live direct-observation projection would lose the same facts.

Before another size-tuning experiment, add/check a regression requiring the latest public test failure to survive, with a live authenticated observation control. Longer output allowance alone did not guarantee accuracy. A later lossless output-size candidate is temporary short aliases for source UUIDs, resolved to original IDs before validation/storage: the final summary contains 41 UUID occurrences totaling 1,476 bytes, about 30.6% of its 4,818-byte JSON. This is a size diagnostic, not proof of the cause of truncation; aliases are not implemented here.

## Reproduction and validation

The fixed [history](../fixtures/context-tool-output-history.json) SHA-256 is `ea452897cc34223e032a9c4a97f84f8542ef4917ca39823d61385dbb8af479e3`. Origin: the earlier [smaller-batch Verified run](2026-09-29-compact-batches-swe.md), `pytest-dev__pytest-10356`, solve `dd0089f6-2510-4a4b-9a91-ec4d3c902521`. No reference patch or grader expectation is given to the model. All source UUIDs, timestamps and generation settings are fixed. The final consumer is explicitly a test double, while every summary and corrective response comes from the actual model.

- Ollama 0.34.4; `ornith-1.5:9b`, Q4_K_M; digest `e5df7dcdd8a263994df62d610317e07be0d6af23f96fcbd8543273058fce575e`.
- Actual context 32,768; summary output 2,048 / expanded output 4,096; seed 42, temperature 0.6, top-p 0.95, thinking disabled.
- Same diagnostic profile: trigger 8,000 / target 7,000, 1,800,000 ms deadline; these are forced evaluation thresholds, not a production-default recommendation. No agent iteration cap is added.
- Docker 29.8.1, ARM64, VM memory 4,107,141,120 bytes; identical pinned Node 22 base. The metadata records image identities and source fingerprints for both conditions. Inference was serial, with baseline first; cache/order effects are not controlled by a single pair.
- Measured candidate code `be5a77a`; replay commit `677e992`. A subsequent defensive guard escapes native outputs using reserved reference/literal encodings, preserving them without requiring the original message to decode. It adds a literal-format instruction only when needed; this fixed history has zero such outputs. Final validation and an identical-prepared-request control are recorded in the JSON.
- Final guard `9a687637e4e0cf66bcdd6cf70788f567a26103de`: headers/build passed; full suite **1,070**, focused compaction/encoding checks **95**. A fixed-summary control completed both measured/final images with all **12 prepared summary requests identical**. This is not a second real-model timing trial; live interpretation of reserved native encodings remains untested.
- The change is private summary serialization: no public API, canonical persistence format, authorization rule or dependency changes. No new ADR was required. Book manuscripts were not edited.

Build baseline from the recorded source, then run the current replay driver against both images:

```sh
mkdir -p tmp/e2e/tool-output-baseline-src
git archive b13c11b | tar -x -C tmp/e2e/tool-output-baseline-src
docker build -f tmp/e2e/tool-output-baseline-src/e2e/Dockerfile \
  -t orbit-e2e:tool-output-baseline tmp/e2e/tool-output-baseline-src
docker build -f e2e/Dockerfile -t orbit-e2e:tool-output-references .
python3 -B e2e/context-tool-output-compare.py \
  --baseline-image orbit-e2e:tool-output-baseline \
  --candidate-image orbit-e2e:tool-output-references \
  --output tmp/e2e/tool-output-references-repeat
```

The launcher refuses an existing output directory, preserves responses/events/results on failure, enforces an outer timeout and removes each disposable container. Use a new output path for every repeat. Raw local artifacts remain under `tmp/e2e/tool-output-references-replay`; curated evidence and the public-data fixture are tracked.
