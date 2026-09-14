---
status: current
investigation-date: 2026-09-14
orbit-commit: 16e4a49c1e0632870e02380f958492430ea393b5
related-adrs:
  - docs/adr/2026-09-14-verified-interrupted-tool-context.md
  - docs/adr/2026-09-08-budgeted-session-compaction.md
  - docs/adr/2026-09-07-required-execution-journal.md
superseded-by: []
---

# Cancelled Tool Calls and Subsequent Model Context

## Purpose

Investigate why a managed Run can finish cancellation with acknowledged storage and quiescent resources while its next budgeted conversation fails. Compare model-input projection, continued refusal, and explicit migration to another conversation. This note supplies non-binding evidence for a narrowly scoped proposal; it neither repairs history nor approves implementation.

## Research Questions

- Which persisted boundary leaves a complete assistant call without a tool result?
- Does the failure depend on Graph, triggering summarization, or ordinary refusal?
- Can input normalization avoid inventing execution outcomes or weakening required recording?
- What evidence, compatibility and retention costs follow when compaction consumes a derived view?

## Findings

The failure is reproduced in both ordinary Agent and one-Agent-node Graph execution. A read completes; the model then requests a write. Cancelling during write approval leaves that call without a result message. The next budgeted Run fails with `Unresolved tool call group` before model preparation or invocation, even below the compaction trigger. Both original transcript prefixes remain unchanged.

Refusing approval is contrary evidence to a broad cancellation/refusal diagnosis: the current runtime can store an error tool result for refusal, return a final assistant message, and continue normally. In this fixed double, that first Run is `completed` with one `denied` operation. Run completion is not proof that the requested edit occurred.

**Non-binding recommendation:** retain refusal by default. Offer explicit, evidence-checked projection only for missing calls proven not dispatched in a confirmed cancelled Run. Keep canonical messages and terminal outcomes immutable. Dispatched calls with missing output, unknown results, ambiguous call identity, incomplete recording and unresolved resources remain ineligible. Persist projection provenance separately before use and account for it in later compaction; ordinary prompt-only insertion alone is insufficient.

## Orbit Baseline

The inspected HEAD is `16e4a49c1e0632870e02380f958492430ea393b5`, unchanged from the chapter-19 investigation. The working tree was clean. Public main was checked with `git ls-remote` at `1cb6f4f2abe3e89e27c1bdb32f1049183ef0e960`; the local implementation is the inspection baseline, not an assertion that public main contains it. The book's integrated example is at `4614f701408d2f159f7056bf786fe6a6225c880e`; its refusal/marker behavior is not changed. No existing equivalent interruption-projection ADR was found. The input-budget research is reused for counting and compaction background, not rewritten as though it already solved interruption.

| Source                                                         | Verified current behavior                                                                                                                                                                                                                      |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/agent.ts`, `runAgentStage`                           | Stores the assistant response before calling `ToolRuntime.executeAll`. Appends returned tool messages after that call returns. Abort/throw can bypass the result append. Graph reuses this same loop.                                          |
| `src/core/session/context-policy.ts`, `prepareSessionContext`  | Copies the complete conversation and calls `validateToolGroups(all)` before preparing or estimating the ordinary request. The error occurs below trigger as well as above it. The unbudgeted path does not use this validator.                 |
| `src/core/session/compaction.ts`                               | Validates pending IDs, duplicates, names and ordering. Persisted compaction validation also applies this check to raw messages. `projectionVersion` is currently exactly 1.                                                                    |
| `src/core/session/context-builder.ts`                          | Builds copied canonical messages, optionally preceded by an untrusted checkpoint. It is synchronous and does not inspect journal evidence.                                                                                                     |
| `src/core/execution/authorization.ts`                          | Denial returns an error result. Authorized execution writes/synchronizes intent before dispatch. Intent contains a Session-keyed digest of the call ID, not a portable full assistant-call identity.                                           |
| `src/core/execution/run.ts`, `recovery.ts`, `journal.ts`       | Quiescence, terminal recording, late settlement and ownership are separate from conversation completeness. A recovered result is not a new acknowledgement. Unknown complete records and invalid sequence must not become successful evidence. |
| `src/core/processor/graph-execution.ts`, `graph-inspection.ts` | Shared Run/turn, visit identity and transcript high-water positions exist. Interrupted nodes are observed, not automatically restarted.                                                                                                        |
| `src/core/models/adapters/{openai,anthropic,ollama,tools}.ts`  | Tool payloads are translated to provider-specific fields; adapters do not establish journal-backed nonexecution. See the provider discussion below.                                                                                            |
| `src/core/session/codec.ts`, `entries.ts`                      | Current transcript v2 has a strict set of records and versioned compaction/Skill payloads. Adding derived provenance has reader and migration consequences.                                                                                    |

Maintained `docs/context-compaction.md` explicitly refuses missing/duplicate/mismatched results and preserves original messages; `docs/processor-graphs.md` shares the whole-turn protection and forbids intermediate-node restart. `docs/session.md` keeps persistence separate from model context. These documents describe current behavior and are not rewritten to present the proposal as implemented.

The intent `call` HMAC does not include the assistant message ID or iteration. IDs can legally recur in later groups. Graph visit identity narrows some cases but does not identify every repeated ID within an Agent visit. Approval records alone cannot be paired to an assistant call merely by display text or array position. This is a reason to reject ambiguous historical evidence, not guess a mapping.

## Reproduction and Validation

The accompanying [research probe](fixtures/cancelled-tool-history.mjs) uses the actual built public APIs, file Sessions/journals and built-in read/write tools. Only the model is a fixed double. It creates and retains isolated temporary data; no provider, MCP server, user settings or book application is invoked. From the repository root, after preparing the inspected build:

```sh
ORBIT_ROOT="$PWD" node docs/research/fixtures/cancelled-tool-history.mjs
```

The probe requests a read, then a write, and waits for an actual approval request. It approves, denies, or requests stop; it then starts a distinct explicit explanatory Run on the same Session. Starting that second Run is diagnostic use of core, not removal of the book application's refusal policy. It checks terminal and recording results, no new model preparation/invocation in failure cases, and byte preservation of the old transcript prefix. Timeout is failure. Generated evidence remains under the printed temporary directory.

| Entry | First control          | First outcome / operations                  | Second outcome           | New model preparations / invocations |
| ----- | ---------------------- | ------------------------------------------- | ------------------------ | ------------------------------------ |
| Agent | approve                | completed / succeeded read, succeeded write | completed                | 1 / 1                                |
| Agent | deny                   | completed / succeeded read, denied write    | completed                | 1 / 1                                |
| Agent | cancel during approval | cancelled / succeeded read                  | failed, unresolved group | 0 / 0                                |
| Graph | approve                | completed / succeeded read, succeeded write | completed                | 1 / 1                                |
| Graph | deny                   | completed / succeeded read, denied write    | completed                | 1 / 1                                |
| Graph | cancel during approval | cancelled / succeeded read                  | failed, unresolved group | 0 / 0                                |

All first controls finished quiescent with `file-and-directory-sync` and `acknowledged`. This verifies an incomplete model-input group, not uncertain completion of the write. It does not generalize to abort after dispatch. The six cases were executed on macOS/Node 26.5.0 and Linux/Node 22.23.2 using identical baseline TypeScript and lockfile contents; Linux used the existing native build with read-only mounts and no network. An initial probe attempted a late approval reply after stop and correctly received `RunStoppedError`; it was corrected to avoid replying after cancellation, not counted as a reproduction success.

The existing context-compaction, context-interruption, Graph and Session test files passed 71 tests on macOS. These regression tests are not implementation tests for the proposed projection. In an isolated copy of the inspected source, `headers:check` and `build` passed. The first sandboxed full suite had 647 passes and four failures: three loopback `EPERM` failures and one maintenance-recovery timeout. Repeating the full gates with local networking allowed passed 651 tests; lint reported 56 existing warnings and no errors. The earlier maintenance timeout cause remains unresolved; this rerun does not establish its cause. The six diagnostic cases also passed against the newly built isolated source. No real-model response quality, actual provider acceptance, physical-storage failure, Windows behavior or representative deployment trial was measured.

## External Systems Investigated

These are the exact comparison snapshots already used in prior Orbit research. The relevant files were retrieved again on 2026-09-14; they are not claims about the latest releases. Source was inspected, not executed. Initial guessed modular paths were absent; the paths below were verified against each full Git tree.

| System and revision                              | Inspected source and observed behavior                                                                                                                                                                                                                                                                                                                  | Transferable lesson and limit                                                                                                                                                                                                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Codex `5adb68a49933ae446bf11935662c83dba55a0804` | `codex-rs/core/src/context_manager/history.rs`: `for_prompt_annotated` normalizes the model-visible view. `normalize.rs`: `ensure_call_outputs_present`, `synthetic_output_id`, `remove_orphan_outputs` add absent function/custom outputs and remove orphan results. Synthetic function output uses `aborted`; stable IDs derive from the source item. | Separate prompt normalization from original evidence; use deterministic derived identity. Do not infer cancellation or safe nonexecution from absence alone. Tool-search output synthesis uses completed/empty semantics that Orbit must not copy as actual execution evidence.                  |
| Pi `b79e4cc834970cca69daebffab7df1da7d1e52c4`    | `packages/ai/src/api/transform-messages.ts`: second pass inserts an error tool result with `No result provided`, tracks each group, and skips assistant messages marked error/aborted. `packages/agent/src/agent-loop.ts`: cancelled tool paths create error results and emit result messages.                                                          | Explicit missing-result wording and result pairing are useful. Dropping an aborted assistant wholesale would hide Orbit's canonical requests/metadata. Pi's transform does not establish Orbit journal/lease/recording eligibility, and generated timestamps are not stable projection identity. |

These systems demonstrate usable provider-facing normalization patterns. Neither source comparison proves that a missing result means a tool was not run, nor validates Orbit's proposed evidence policy.

## Analysis

### Eligibility requires more than quiescence

The proposed narrow case requires a verified cancelled terminal, successful recording at the Session's required level, complete readable source evidence, no unknown operations or unresolved owners, and unambiguous absence of dispatch intent for each missing call. Earlier completed reads are allowed. All related intent records must be attributable; duplicate/reused IDs or missing keys make negative proof unavailable. A later settlement does not rewrite an originally unknown terminal into this initial scope.

A missing output for an actually dispatched operation is not the same problem. Even a known successful side effect with a lost textual response must not receive a synthetic failure that encourages repeating it. Keep such cases blocked and require separate result-reconstruction/reconciliation work. Refusal with an actual error response needs no insertion. Malformed pairs, orphan results and duplicate IDs are corruption, not interruption candidates.

### Provider and compaction consequences

OpenAI Chat Completions uses `role: tool` and `tool_call_id`; Orbit renders error text explicitly. Anthropic uses user-role `tool_result` blocks with `tool_use_id` and `is_error`. Ollama uses tool-role messages and names; its less expressive ID mapping needs duplicate-name/group tests. The derived payload must state that it is context-only, that non-dispatch was checked, and that it is neither successful tool output nor permission to retry. Do not fabricate reasoning blocks, provider signatures or provider continuation state.

Simply inserting this payload at serialization leaves raw `validateCompactionEntries` unable to read a later checkpoint. The proposed ADR therefore includes versioned provenance, a v3 transcript migration, and projection-aware compaction validation. Raw source hashes remain hashes of raw messages. Deterministic derived notices stay separate from model-authored summary claims and are budgeted outside the lossy summary. This compatibility cost is a recommendation awaiting author judgment.

### Ownership and application behavior

Core verifies and builds a view; a host decides whether to offer a new explicit user turn. No projection resumes an old Run, transfers selection dispatch rights, invokes a tool or resolves an uncertain host transaction. The chapter-19 marker and admission stop remain intact in this work. An explicit move to a new conversation can be offered by a future host with provenance and human-selected context, but cannot release old owners or hide unknown effects.

## Implications for Orbit

1. Preserve strict refusal as the default and add only an opt-in, bounded verified-nondispatch path.
2. Keep raw messages and terminal results immutable, persisting a distinct description of the input view rather than forged tool messages.
3. Use the same preparation path for ordinary Agent and Graph, with or without token budgeting; summary calls remain tool-free and Skill-free.
4. Treat migration, evidence retention, replay identity and shutdown as part of the feature, not cleanup after implementation.
5. Leave denied-with-result, dispatched-but-missing-output, unknown, partial-storage and ambiguous historical groups distinct.

## Risks and Limitations

A truthful error-form tool payload can still influence a model to request another operation. The host must require a new user request and existing one-operation approvals; this is not a semantic guarantee about a model. Filesystem trust is unchanged: journal digests are not signatures against a party replacing the whole dataset and key. External checks and automatic-restart controls remain necessary.

All ten accepted/partial ADRs, prior maintenance-recovery timeout root-cause uncertainty, unconfirmed model settings, pending backup-deletion permission and author-deferred Windows/representative/operational/physical-fault trials remain open. Model-input feasibility is not evidence of target-test success, application correctness or real-model quality.

## Open Questions

Author judgment is required for the opt-in scope, v3 migration and retention costs. Broadening to dispatched calls with missing output, cross-session migration UX, or unknown results is deliberately excluded. The confirmation matrix in the proposal must pass before claiming implementation completeness.

## Related Decisions

The [new proposal](../adr/2026-09-14-verified-interrupted-tool-context.md) would refine the strict complete-group rule of [budgeted compaction](../adr/2026-09-08-budgeted-session-compaction.md) only after acceptance. It preserves managed lifecycle, authorization, required journal, ownership, Skill, Graph, evaluation and selection decisions. This note does not supersede the older compaction research; that remains its original baseline evidence.

## References

- [Codex history](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/core/src/context_manager/history.rs)
- [Codex normalization](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/core/src/context_manager/normalize.rs)
- [Pi message transform](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/ai/src/api/transform-messages.ts)
- [Pi Agent loop](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/agent/src/agent-loop.ts)
- [Original input-budget investigation](2026-09-08-input-budgets-and-compaction.md)
- Book `books/ai/ai-orbit/analysis/orbit-application-example.adoc`, chapter-19 integration findings at `4614f701408d2f159f7056bf786fe6a6225c880e`.
