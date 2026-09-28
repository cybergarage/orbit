---
status: current
investigation-date: 2026-09-29
orbit-commit: 1be53b4effb0f4b1c10849660f1d6c40f9340e97
related-adrs:
  - docs/adr/2026-09-29-source-derived-tool-observations.md
  - docs/adr/2026-09-08-budgeted-session-compaction.md
  - docs/adr/2026-09-25-long-turn-context-recovery.md
superseded-by: []
---

# Structured Tool Observations Across Compaction

## Purpose and Research Questions

Investigate whether completed edit and command facts can survive independently
of model-written summaries. Determine what the existing runtime actually knows,
what a bounded projection can preserve, and whether the model reliably consumes
that projection. This note is non-binding research, not implementation approval.

## Findings

A deterministic evaluation-only extractor recovers omitted saved-edit and latest
selection facts in one frozen checkpoint: summary-only 0/3, summary plus records
3/3. A second checkpoint from the same source remains 0/3 in both conditions:
the model reports a coarse failure instead of zero tests selected, and the
record-assisted answers misspell a required JSON key. All twelve answers keep
behavior unverified; that criterion shows no improvement.

These results support preserving observations independently of prose. They do
not establish reliable model interpretation, better summarization, or better
coding capability. The consumer receives more information in the candidate
condition, and all repetitions share one seed. See the
[complete report](../../e2e/results/2026-09-29-context-observations.md) and
[individual answers](../../e2e/results/2026-09-29-context-observations.json).

## Orbit Baseline

Source was inspected at `1be53b4effb0f4b1c10849660f1d6c40f9340e97` on 2026-09-29.
The evaluation prototype was committed as
`a86f1b60d8b095dc6c95f8bca92df543260d5b77` and
`36832127a3a957e1f39fb1ffc93d0ce378eec153`; neither changes core behavior.

| Inspected source                                                                                          | Verified behavior                                                                                             | Limit                                                                                              |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/core/tools/builtins/edit.ts`, `write.ts`                                                             | Successful atomic write returns path and byte details.                                                        | An operation acknowledgement does not establish current contents after later changes.              |
| `src/core/tools/builtins/bash.ts`                                                                         | Reports process exit, stdout/stderr, timeout and truncation.                                                  | Exit 0 does not identify tested assertions or edited revision.                                     |
| `src/core/tools/builtins/factory.ts`, `src/core/tools/registry.ts`, `src/core/execution/authorization.ts` | Frozen definitions retain source identity; prepared operations bind source/call/run information.              | A tool name alone does not identify a trusted built-in adapter.                                    |
| `src/core/agent.ts`, `createToolResultMessage`                                                            | Conversation payload stores request input, name, call ID, error and result.                                   | It does not currently store a dedicated runtime-origin binding alongside that result.              |
| `src/core/session/session.ts`, `appendMessages`                                                           | Every appended message points to the immediately preceding message, including multi-result groups.            | Matching only the immediate parent to an assistant call loses chained results.                     |
| `src/core/session/compaction.ts`, `checkpointPrefix`, `sourceDigest`                                      | Source-validated checkpoint prose and protected user references are projected; canonical history is retained. | Source IDs authenticate references within the supplied source, not the meaning of generated prose. |
| `src/core/session/context-policy.ts`, `codec.ts`                                                          | Budgeted preparation assembles measured requests; persisted JSON payloads are validated.                      | A new provenance field still needs lifecycle and compatibility tests.                              |

This is source inspection. The prototype's execution does not demonstrate a core
observation implementation. Prior summary experiments and the restored runtime
are recorded in the [test-evidence follow-up](../../e2e/results/2026-09-28-context-test-evidence-followup.md).

## External Systems Investigated

Both systems were inspected from pinned primary source on 2026-09-29. No Codex
or Pi runtime was executed. Findings apply to these files and revisions, not to
a claim about every feature in either system.

### Codex

Revision: `aa380897f67b91e1a47d530d7286d497b6726d3f`.
Inspected `codex-rs/core/src/compact.rs` and
`codex-rs/core/src/context/compaction_summary.rs`.

[Compaction](https://github.com/openai/codex/blob/aa380897f67b91e1a47d530d7286d497b6726d3f/codex-rs/core/src/compact.rs#L354)
builds summary-based history, separately obtains initial context, inserts that
context, and replaces history with associated world-state baseline information.
The [summary fragment](https://github.com/openai/codex/blob/aa380897f67b91e1a47d530d7286d497b6726d3f/codex-rs/core/src/context/compaction_summary.rs)
is user-role contextual text.

Adopt the lesson that canonical context can be regenerated separately from
summary prose. Do not treat initial-context restoration as evidence that this
implementation verifies saved edits or test coverage; these inspected files do
not establish such a contract. Orbit's canonical transcript and persistence
rules remain its own constraints.

### Pi Coding Agent

Revision: `5fd446ca1843682e8da3fec4ceb71c42f56fbace`.
Inspected `packages/coding-agent/src/core/compaction/utils.ts` and
`packages/coding-agent/src/core/compaction/compaction.ts`.

The [file-operation extractor](https://github.com/badlogic/pi-mono/blob/5fd446ca1843682e8da3fec4ceb71c42f56fbace/packages/coding-agent/src/core/compaction/utils.ts#L29)
reads assistant tool-call names and paths, accumulating read/write/edit sets.
It does not consult completed tool results to establish success. The
[compaction result](https://github.com/badlogic/pi-mono/blob/5fd446ca1843682e8da3fec4ceb71c42f56fbace/packages/coding-agent/src/core/compaction/compaction.ts#L1079)
appends formatted file lists to summary text and also returns those lists in
structured details, carrying previous lists across later compaction.

Adopt separate structured file-operation information. Reject interpreting a
requested edit as confirmed success for Orbit's observed-fact use case. These
lists are useful navigation hints, not verification of saved contents or tests.

## Evaluation Evidence

The fixture contains public solver conversation from `pytest-dev__pytest-10356`,
base `3c1534944cbd34e8a41bc9e76818018fadefc9a1`. Its expected answers remain
independent grader input. The model never receives those answers, a gold patch,
or hidden tests. The second checkpoint comes from the previously committed
semantic replay; messages and expected answers are unchanged.

The extractor pairs requests/results within a complete call group, retains
source IDs and hashes, and emits chronological observations. Its view keeps
latest successful saves and later failed saves, plus recent commands. It refuses
oversized views. Controlled built-in provenance is a fixture assumption; this
is explicitly unsuitable as general name-based core authentication.

Eighteen Python tests cover group correlation, reused IDs, missing results,
cancellation without acknowledgement, reediting, failed saves, stale tests,
Session isolation, unknown external tools, deterministic extraction, bounded
views, JUnit validation, independent grading and request leakage controls.
Nineteen existing host tests and eleven semantic tests pass. Core headers/build
and the 1,038-test suite pass. Three final Python-only cases were added after the
full suite; no core change followed it.

Three isolated ARM64 Docker smoke checks preserve exit 0 with one reported pass,
exit 1 with one reported failure, and exit 5 with zero reported tests. The
optional evaluation-runner pytest/JUnit adapter reports counts and report hashes,
not coverage, deselection totals or workspace revision. Arbitrary stdout is not
parsed into a universal test verdict.

## Analysis and Non-binding Implications

There are two distinct failure surfaces: facts disappear or change in prose,
and the consumer misinterprets facts that remain available. The prototype helps
the first surface for one checkpoint, but the contrary trial leaves the second
unresolved. Deterministic evaluators should consume records directly rather than
ask another model to regenerate their meaning.

A narrow core direction is to reconstruct observed saves and generic command
status from canonical completed results, using runtime-owned source provenance.
Project that view alongside checkpoints without duplicating a persistent ledger.
Keep raw command output untrusted. Only a dedicated test adapter should produce
framework-specific counts, and neither process status nor counts should establish
behavioral verification. Reopening old sessions must not upgrade a tool name to
verified provenance.

## Risks, Limitations and Open Questions

- Controlled fixture provenance is weaker than a production runtime binding.
  Persistence/reopen must retain and validate that binding, including imported
  sessions and unavailable journals, or leave its origin unknown.
- A request without a result can have a physical effect before cancellation.
  Absence of a record means unknown; it must not trigger automatic replay.
- Shell/custom/external edits and external processes can invalidate current
  workspace assumptions. Saved-at-operation is deliberately narrower.
- Production projection needs measured token accounting with protected user
  inputs and complete recent groups. The prototype's byte ceiling is not enough.
- Observation views are additional untrusted model input. Ordering and omission
  rules need deterministic tests, not a promise of model obedience.
- No new official SWE-bench grading, core Agent/Graph integration, reopening,
  migration, or production-budget trial has been performed here.

## Related Decisions and References

This investigation extends the questions behind
[Budgeted Session Compaction](../adr/2026-09-08-budgeted-session-compaction.md)
and [Long-Turn Context Recovery](../adr/2026-09-25-long-turn-context-recovery.md).
It changes neither decision nor their implementation statuses.
The resulting [observation ADR proposal](../adr/2026-09-29-source-derived-tool-observations.md) is proposed / not-started and requires author acceptance.

- [Earlier context-exhaustion investigation](2026-09-25-book-workflow-context-exhaustion.md)
- [Maintained E2E instructions](../e2e-evaluation.md)
- [Prototype source](../../e2e/context_observations.py)
- [Consumer replay and independent grader](../../e2e/context-observations-replay.py)
- [Deterministic tests](../../e2e/context_observations_test.py)
