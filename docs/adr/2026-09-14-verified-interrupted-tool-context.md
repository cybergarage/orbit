---
status: proposed
proposed-date: 2026-09-14
decision-date: null
implementation-status: not-started
implementation-completed-date: null
implementation-commits: []
superseded-by: []
---

# Verified Context for Interrupted Tool Groups

## Purpose

Allow a new, explicitly requested conversation turn after a narrowly identifiable cancellation without falsifying the previous execution. Preserve raw transcript evidence and refuse continuation when nonexecution, storage or ownership cannot be established. This proposal does not authorize implementation or change the chapter-19 application's existing admission stop.

## Decision

**Proposed, not accepted:** retain strict refusal by default and introduce an explicit, versioned `verified-not-dispatched` context policy. The name is provisional. Core would derive provider-facing error-form tool responses only for eligible missing results, preserve canonical messages, and synchronize separate provenance before using the view. This is a new conversation request, never resumption of an interrupted tool or Graph node.

### Eligible history and evidence

The initial scope is an earlier managed **cancelled** Run whose terminal and recording are verifiable and whose resources are all settled. The raw assistant call exists, its result is absent, and complete required evidence proves that this particular call was never dispatched. All missing calls in the affected history must qualify; do not repair one group and ignore another.

Verify under the existing registered Session/journal ownership boundary:

1. The original message IDs, order, turn association, source head, raw digest and existing compaction ancestry are valid. The old Run has finished; an active Run's pending calls are not eligible.
2. The required journal, key and terminal sequence are readable and complete through the terminal, including relevant later records. No unknown complete records, torn tails, invalid sequence, failed recording, unknown operations, unresolved owners or cleanup failures are accepted as negative evidence. Ordinary tolerant observation of a truncated journal does not qualify it for this operation.
3. The live terminal had acknowledged the required storage level, or a restored terminal is independently revalidated with current storage/ownership checks and required synchronization. Restoration remains `recovered`; it does not manufacture a historical success response. A recorded failed/unknown outcome remains failed/unknown.
4. Match each call using its Session, turn, assistant message ID, ordinal, ID and name. The current intent HMAC includes the call ID but not that full identity. It may be used only where the entire enclosing Run's raw calls and intents admit an unambiguous correspondence. Repeated IDs across groups, unavailable call IDs/keys and unmatched intents refuse eligibility. A Graph visit narrows identity but does not distinguish repeats inside its Agent loop.
5. Every missing call has no corresponding dispatch intent. Earlier reads or other completed groups may have intents and results, provided their attribution is unambiguous. The absence of intent is meaningful only because the adopted runtime synchronizes it before dispatch; it is not inferred from a missing optional log or approval display text.

A complete denied tool result remains unchanged. A dispatched call with missing output is excluded even if its effect is known successful: inventing a failure can encourage repeating an edit. Unknown results and originally unknown terminals remain excluded even after later settlement in this initial scope. Orphan results, duplicate IDs within a group and mismatched names are corruption, not cancellation. A cancellation before any assistant tool call requires no projection.

For memory recording, require the complete same-process journal and existing ownership guarantees; do not claim crash durability or allow reconstruction from a detached snapshot. Required file evidence is read without creating a replacement key or repairing journals. Failure to read or bound the evidence refuses admission.

### Original records and the derived input

Keep the original assistant calls, actual tool results, terminal outcomes and operation records unchanged. Construct a copied view by inserting an error-form tool response only at each verified missing position. Its matching ID/name come from the original call; its deterministic derived ID comes from the source identity and projection revision. Do not use wall-clock time to distinguish the same projection.

Use fixed wording that identifies a context-only notice, a checked absence of dispatch, and the original cancellation. It must say that no actual tool output is available and that the notice is not permission to retry. Do not invent success, file contents, exit status, timestamps, provider reasoning, signatures or continuation tokens. A provider may still induce another call; existing operation authorization remains mandatory and model quality is unverified.

Keep synchronous `SessionContextBuilder.build()` as a raw copied-view API. The owning Agent preparation path, shared with Graph, performs asynchronous verification and projection when the policy is selected. Apply it before any ordinary model request both with and without input budgeting. An opt-in legacy invoke-only model that cannot consume the prepared view must refuse rather than silently bypass verification. With the policy off, preserve existing behavior, without claiming that today's unbudgeted malformed history is accepted by real providers.

Serialize using the existing OpenAI tool ID, Anthropic error `tool_result`, and Ollama tool-name mechanisms. Validate grouping, same-name calls, provider-specific assistant content and preserved metadata for each supported adapter. A provider representation that cannot preserve the needed distinction must refuse this policy. Adapter-only normalization must not establish eligibility.

### Provenance, transcript compatibility and compaction

Propose **transcript v3**, with a strict `context_projection` revision-1 record and a compaction `projectionVersion: 2` referring to that provenance. This cost requires author acceptance. Current transcript v2 and compaction projection version 1 do not permit these records or unresolved raw groups; quietly accepting them in those formats would violate old-reader contracts.

The new provenance record contains the owning new Run, original source head/digest and checkpoint ancestry, scoped source call identities, source Run/terminal identities, bounded journal high-water/digest references, projection algorithm revision and derived payload digest. It contains neither journal keys nor fabricated ordinary message entries. Structural decoding validates finite JSON, bounds, references and derivation; it does not execute filesystem reads. Runtime reuse additionally verifies the referenced evidence under ownership. A host-supplied JSON assertion alone is insufficient.

Synchronize this record at the Session's required level **before the first model request that consumes it**. An incomplete append/sync or cancellation does not authorize invocation; unfinished I/O remains owned by the Run. Freeze the resulting view for that preparation. Recheck source head, raw hashes, checkpoint ancestry and evidence position before using or committing a new checkpoint. Do not turn an I/O failure into an unrecorded fallback prompt.

Raw `sourceDigest` and covered message IDs continue to identify the original raw prefix. Projection-aware checkpoint validation checks the raw source, provenance and resulting complete groups separately. Synthetic IDs cannot be passed off as factual source messages or tool results. Existing version-1 checkpoints retain their original strict validation. A v3 reader reads valid v1/v2 transcripts and earlier valid revisions; old readers must reject v3 explicitly.

Summarization receives the original source serialized as untrusted data, not as an incomplete provider tool-message sequence, and an explicit untrusted description of the interruption; it must not receive the inserted notice as an actual tool execution. Keep deterministic nonexecution/cancellation notices outside the lossy model-authored summary so summarization cannot erase their status. Include those notices, summary wrapper, current Skill and complete ordinary request in budgeting. Oversized mandatory context refuses input, not truncation of proof or latest-turn protection. The latest ordinary user turn and Graph's full current turn remain protected by the existing rules. Summary-only requests remain tool-free and Skill-free, share existing model-call/token budgets, and do not authorize operations.

Preserve each needed source journal and provenance for as long as the Session view or its checkpoints depend on it. Missing evidence later makes that view unusable, even if a summary survives. Evaluation and transcript observations must distinguish derived context from actual output and retain the original cancellation. Existing Session deletion and exclusive maintenance remove associated data using the adopted lifecycle; this proposal adds no independent background deletion or new journal version.

Migration stops old processes, external admission and automatic restart sources and uses existing exclusive storage/maintenance conditions. Preserve original message bytes, IDs and order when copying into v3; only the header and new record types differ. Retain the old transcript backup and validate/synchronize the replacement before external restart. Ambiguous replacement/response keeps admission stopped until exclusive inspection and synchronization. There is **no authorization to delete existing backups**. Do not allow an old automatic restart source to reopen the migrated pair.

### Run, Graph, Skill and replay

Projection does not release old owners, cancel resources, clear application markers, confer tool permission or change host selection transactions. A host separately offers a new explicit user turn; the chapter-19 example continues refusing until a later accepted and verified integration changes it. Explicit migration to another Session also requires separate human-facing context selection and cannot resolve unknown effects.

Graph shares the existing Run, turn, environment, catalog, Skill snapshot and budgets. Its Agent stages use the common preparation path. Direct tool nodes retain actual values and journal outcomes and do not receive synthetic Graph success. No unfinished node is restarted. Old Skills are not selected again from historical snapshots; only the current Run's selected Skill is applied to ordinary requests, never to summary-only requests.

Include the selected projection policy and algorithm revision in exact submitted configuration/encoding and prepared-context identity at all service, CLI, GUI, library and selection entrances. Preserve old default encodings when disabled. A changed policy with the same request ID conflicts rather than adapting an old receipt. Freeze the view once per preparation; a same-ID retry reuses the existing Run/result and must not repeat model, adapter, MCP, Skill or projection preparation. After restart observe the old outcome instead of acquiring another execution right. A distinct user request uses a new ID and fresh checks; it is not a workaround for unknown outcomes. Existing authorized MCP startup and actual snapshot checks remain in force.

### Bounds and author judgment

Provisional producer limits are 128 inserted notices per prepared view, 1 MiB projection metadata and 64 MiB cumulative raw evidence inspected per preparation. Exceeding a runtime budget means refusal, not partial verification. Propose a fixed revision-1 JSON record maximum of 4 MiB, separate from adjustable producer limits. Lowering product limits must not render earlier valid stored records structurally invalid; reading and execution eligibility are separate. These are unmeasured starting values, not optimal limits.

Author choices still required:

- Whether to add this opt-in scope rather than retain refusal or offer only explicit new-conversation migration.
- Whether to limit initial eligibility to uniquely proven nondispatch in a cancelled Run, leaving dispatched/missing and unknown cases blocked.
- Whether to accept v3 migration, backups, evidence retention and separately persisted projection-aware checkpoints.
- Whether to accept ordinary-request coverage with budgets off, refusal of incompatible legacy models, replay identity changes when enabled, and the proposed initial bounds.

No earlier delegation for input budgets or adoption of Skill, Graph, evaluation or selection approves these choices.

## Consequences

A narrowly verifiable cancellation can become usable context without fabricating successful execution. Refusal stays available and unsupported or ambiguous history remains blocked. This does not guarantee useful model behavior or solve every interrupted conversation.

Costs include an owned asynchronous evidence read, retained journals, a persistent format migration, projection-aware compaction, provider-specific verification, additional budget consumption and a new configuration identity. Call-ID ambiguity in old journals deliberately reduces eligible cases. No broad automatic repair, new execution runner, new journal version, permanent backend or autonomous retry is introduced.

If accepted, this would refine the complete-group admission/compaction clause of [budgeted Session compaction](2026-09-08-budgeted-session-compaction.md). Its original reasons and history remain intact. The ten existing accepted/partial ADRs retain their current status and adoption rationale; no supersession metadata changes while this is proposed. Managed lifecycle, authorization, required journal, recovery/storage guards, Skill, Graph, evaluation and selection continue to own their existing contracts.

## Context and Problem Statement

At Orbit `16e4a49c1e0632870e02380f958492430ea393b5`, `Agent.runAgentStage` appends an assistant call before `ToolRuntime.executeAll` and appends results only after it returns. Cancelling during approval can skip that append. `prepareSessionContext` checks all raw groups before estimation and trigger selection, so the next Run fails even when no summary is needed. Persisted checkpoint validation applies the same raw-group rule.

A fixed model first reads a file and then requests a write. Both Agent and Graph produce `cancelled`, quiescent, acknowledged recording, followed by a distinct budgeted Run failing with `Unresolved tool call group`, zero new preparations/invocations and no operations. Approve and deny controls continue successfully; the denied edit itself remains denied. These six controls pass on macOS Node 26.5.0 and Linux Node 22.23.2. No source/runtime or book-example behavior was modified.

The [research note](../research/2026-09-14-cancelled-tool-history-and-context.md) contains the source mapping, retained executable probe and test evidence. This establishes the problem, not the proposed feature's correctness.

## Decision Drivers

- Preserve factual transcript, cancellation and execution outcomes.
- Use required evidence rather than optional diagnostics or model assertions.
- Keep latest-turn protection, ownership, cancellation, storage and replay invariants.
- Make normal and Graph input preparation consistent without another loop or runner.
- Expose compatibility and retention costs before implementation.

## External Implementation Research

At Codex `5adb68a49933ae446bf11935662c83dba55a0804`, context-manager history/normalization derives missing function outputs for prompts and assigns stable synthetic identities. At Pi `b79e4cc834970cca69daebffab7df1da7d1e52c4`, the message transform supplies error-form missing results and the Agent loop emits cancellation error results. Exact paths and pinned links are in the research note.

Reuse the distinction between canonical evidence and model input, deterministic identity and explicit missing-result wording. Do not copy absent-result inference, dropping aborted assistant evidence, or completed/empty tool-search semantics. Neither comparison proves nonexecution under Orbit's journal/ownership contract. Only source was inspected; these snapshots were not run or asserted to be latest.

## Considered Options

| Option                            | Benefit                                                               | Cost / disposition                                                                                                                                                                          |
| --------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Continue refusal                  | No new format or inference; today's application policy remains clear. | Cannot continue the same conversation after the reproduced safe cancellation. Valid default and alternative.                                                                                |
| Explicit new conversation         | Host can ask a person which verified context to carry.                | Breaks continuity, needs provenance and migration UX; must not hide unresolved effects or transfer old execution rights. Separate future application work, not an implemented escape hatch. |
| Verified input projection         | Preserves source while enabling a narrow new turn.                    | Requires evidence, compaction changes, v3 migration and retention. Recommended only with the conditions above.                                                                              |
| Unconditional adapter completion  | Small change and provider-shaped groups.                              | Missing output does not prove nonexecution; bypasses compaction persistence and ownership. Not recommended.                                                                                 |
| Append invented canonical results | Existing readers see complete groups.                                 | Confuses observation with actual output and retroactively rewrites evidence semantics. Not recommended.                                                                                     |
| Recover every dispatched result   | Could cover more interruptions.                                       | Requires separate external reconciliation/result reconstruction; outside this proposal.                                                                                                     |

## Implementation and Confirmation

**Not started.** The following are implementation conditions, not passed tests. The diagnostic probe reproduces current behavior only.

| Area                   | Required confirmation before completion                                                                                                                                                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline and scope     | Approve/deny unchanged; cancellation before call, during approval after prior reads, multiple pending calls and partial dispatch; only proven nondispatch is eligible.                                                                                                 |
| Evidence               | Reused IDs, missing key, unmatched HMAC/intent, stale head, mismatched root, unknown records, torn tails, failed storage and unsettled resources refuse; known dispatched success with absent output also refuses. Memory evidence never becomes durable recovery.     |
| Canonical truth        | Raw message bytes/IDs/order and original terminal/operations unchanged; observations/evaluation do not count synthetic notices as output or success.                                                                                                                   |
| Providers              | Capture OpenAI/Anthropic/Ollama requests with fixed doubles; verify ID/name/order/error content, same-name groups and provider metadata. Real acceptance/quality requires separately specified isolated connections.                                                   |
| Budget and compaction  | Below/above trigger, budgets disabled, oversized protected turn, Graph multi-stage latest turn, source races, checkpoint decode/restart, raw hash/provenance, mandatory notices and summary failure. No old Skill reapplication or Skill/tool submission in summaries. |
| Persistence            | Interrupt before/after provenance append/sync and v3 migration steps; malformed complete vs broken trailing records remain distinct; old-reader refusal, v1/v2 reads, backup retention and response-unknown refusal.                                                   |
| Cancellation/ownership | Pending evidence open/read/close/sync remains owned; cancellation never starts model/tool dispatch or releases an unfinished resource; no unrecorded fallback.                                                                                                         |
| Graph and replay       | Common Agent loop, direct tool nodes, no node resume; same-ID all entrances/restart does not reprepare; changed enabled policy conflicts; selection receipts and existing MCP authorization/snapshot checks hold.                                                      |
| Retention/bounds       | Deletion/maintenance coordinate with active views; missing retained evidence refuses later use; metadata/raw limits separated; lower producer limit preserves valid historical decode.                                                                                 |
| Validation level       | Unix headers:check/build/test and targeted fault tests; distinguish core/application/target tests and real-model quality. Report unmeasured initial bounds and environment-dependent checks separately.                                                                |

Implementation would update public APIs, current architecture/concepts/features and migration instructions only after acceptance. Completion requires full implementation hashes and results in a later ADR record commit, not this research commit.

## Follow-up Work

Review the narrow proof, format/compaction consistency, author choices and confirmation matrix before adoption. If accepted later, implement core first and verify it before separately changing the completed example's refusal policy or manuscript. Broader recovery, new-conversation UX and model-quality trials need separate scope.

Keep ten accepted/partial ADRs, the earlier maintenance-timeout cause, model connection conditions, pending backup deletion and author-deferred Windows, representative, operational and physical-fault trials open. This proposal closes none of them.

## References

- [Investigation and pinned comparison sources](../research/2026-09-14-cancelled-tool-history-and-context.md)
- [Managed Run lifecycle](2026-09-07-managed-run-lifecycle.md)
- [Prepared operation authorization](2026-09-07-prepared-operation-authorization.md)
- [Required execution journal](2026-09-07-required-execution-journal.md)
- [Storage registration](2026-09-08-session-storage-registration-guard.md)
- [Budgeted compaction](2026-09-08-budgeted-session-compaction.md)
- [Run-scoped Skill](2026-09-09-run-scoped-skill-selection.md)
- [Managed Graph](2026-09-12-managed-processor-graph.md)
- [Evidence-based evaluation](2026-09-12-evidence-based-workflow-evaluation.md)
- [Application-owned selection](2026-09-13-application-owned-workflow-selection.md)
