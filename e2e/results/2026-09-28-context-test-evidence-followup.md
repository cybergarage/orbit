# Test evidence in summaries — 2026-09-28

## First focused attempt

Prompt `b3026e6` distinguishes observed execution from behavioral verification and explicitly warns that an empty passing test or a test name does not prove a feature. This is a local instruction change; no public API, checkpoint schema, stopping rule or dependency changes, so no ADR is required. Unit validation passed: 47 context-compaction tests, 11 fixed semantic tests, headers check, build and 1,038 full-suite tests.

The same committed source fixture and unchanged grader were replayed once per condition with `ornith-1.5:9b`, Q4_K_M, context 32,768, output cap 2,048, seed 42, temperature 0.6, top_p 0.95, thinking disabled, JSON mode. Baseline `1a69535`: fail (111.2 s, saved edit/latest test pass, unsupported success fail). Candidate `b3026e6`: needs-review (122.2 s, saved edit pass, two other checks need review). Both responses completed as valid JSON without unknown source IDs.

Source review does not accept the candidate as faithful: it removed the recognized unsupported-success statement, but omitted later passing/deselected test runs and left an earlier collection error as the only test. It also confused incomplete behavioral verification with no test having run. The grader was not loosened to turn this into pass. Original outputs, exact prompt hashes, fixture/source hashes, model digest and evidence are preserved in [JSON](2026-09-28-context-test-evidence-followup.json). Requests/responses remain in ignored `tmp/e2e/context-test-evidence-20260928/`.

This is a fixed-history diagnostic, not a SWE-bench solve or a general semantic-accuracy estimate. The next iteration must preserve actual observations even when assertion coverage is unknown.

## Second attempt and budget correction

Adding more preservation instructions made one narrow and full-suite budget test fail before any model request. The 3,423-character instruction exceeded the synthetic 8,000-character window. This draft was not committed. Instructions were consolidated to 2,766 characters without changing budgets or the grader; commit `598f2b8` passed 47 narrow tests, 11 semantic tests, headers/build and 1,038 full-suite tests.

The second live comparison still rejected the candidate: baseline `1a69535` failed unsupported success again (112.6 s); candidate `598f2b8` passed that check but failed saved-edit and latest-test/remaining-work checks (124.3 s). It called confirmed saved edits unsaved and repeated a misleading explanation of deselection. Both complete JSON outputs had valid source IDs. This candidate is not treated as a successful overall improvement. The next trial restores the earlier main instructions and adds a concise review after the serialized source, so raw observations can override the stale checkpoint before the model returns its draft.
