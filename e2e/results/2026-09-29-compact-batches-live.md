# Smaller batches and cumulative summaries — reopened diagnostic, 2026-09-29

The final implementation completed real-model compaction and retained **2/2 acknowledged saves** after persistent Session reopening. The consumer reported both files and explicitly stated that no tests or behavioral verification occurred. Runtime was quiescent, without unresolved operations or cleanup errors.

| Metric | Previous core `f7d7fe4` | Current core `08097e5` |
| --- | --- | --- |
| Summary requests | 1 full | 1 full |
| Compaction duration | 46.96 s | 45.11 s |
| Estimated request tokens | 10,066 → 1,222 | 10,066 → 1,253 |
| Actual provider input/output totals, including consumer | 12,247 / 756 | 12,330 / 712 |
| Direct observations | Pass, 2/2 saves | Pass, 2/2 saves |

This six-message history takes the short-history one-shot route. It **does not measure eighth-sized batching**, and no exact duplicate summary items were generated: the eight items remained 1,286 UTF-8 JSON bytes before/after deduplication. The current summary request estimated 11,356 tokens, had output cap 2,048 and a soft cumulative target of 1,024. This small trial does not establish a timing or size improvement; source UUIDs and Docker versions differ. The separate natural Verified run exercises longer histories.

## Changes and validation

Core commit `08097e57a1f57cdd19b68e035bd8ae259cf506e2`:

- Large histories begin with at most one eighth of their complete groups, with a marginal source estimate target of twice `summaryOutput`. Short histories and verified-interruption one-shot behavior are retained. A single complete tool group may exceed the target if it fits the actual input budget.
- The model is asked for a compact cumulative summary of about half `summaryOutput`. Evidence is not mechanically truncated to this soft target.
- Exact duplicate items are merged within their category, retaining the union of source IDs. Distinct text, test target, revision and outcome remain distinct. Only validated summaries are compacted; canonical source history and existing checkpoints remain unchanged.
- Diagnostics record prior-summary bytes, estimated input tokens and before/after summary item counts/bytes. Expansion/correction, model-call accounting, deadlines, interruption proofs and atomic checkpoint activation remain in place.

These are internal changes to the existing policy, with no public setting, transcript format or authorization change; no new ADR was needed. Headers and build passed; final full suite **1,063**, focused compaction/integration **64** (compaction **60**), host checks **19**, direct checker **4**, semantic evaluator **11**. Initial full validation caught one regression: eagerly checking raw interrupted tool groups prevented the existing one-shot summary. Validation was deferred until actual splitting, and the full suite passed after the fix. Invalid nondispatched calls are never converted into fabricated results. Unrelated E2E formatter changes were restored before image creation.

The deterministic tests verify original source order, tool-group integrity, smaller marginal-source selection, exact duplicate source-ID unions, distinct test outcomes/revisions/targets, cancellation/budget handling and Agent/Graph interruption replay. Shape/source-ID validation and this direct observation checker are not full model-semantic grading. Limited review confirms the two saved paths and absence of test outcomes in this diagnostic; it does not validate every phrase or categorization of fixture filler in the model summary.

[Curated JSON](2026-09-29-compact-batches-live.json) records accepted summary, answer, full identity, settings and measurements. Docker **29.8.1**, native ARM64, memory **4,107,141,120 bytes**; preceding report used 29.8.0. Host Ollama 0.34.4, `ornith-1.5:9b`, Q4_K_M, digest `e5df7dcdd8a263994df62d610317e07be0d6af23f96fcbd8543273058fce575e`. Context 32,768, output reserve 2,048, seed 42, temperature 0.6, top-p 0.95, thinking disabled. Diagnostic trigger/target 3,500/2,500; deadline 300 seconds. Final image `sha256:d83c2c90273a5169a299320212a72462eb91275236b476fa451d1fe548bdff62`.

Reproduce with the [live reopened diagnostic](../../docs/e2e-evaluation.md#live-reopened-projection-diagnostic), a freshly rebuilt image and new container/output directory, without fault injection. Copy output before cleanup and run the direct checker. Raw journals and private paths remain ignored; the [results index](README.md) links official coding evaluations separately.
