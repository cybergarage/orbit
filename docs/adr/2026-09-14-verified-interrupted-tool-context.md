---
status: accepted
proposed-date: 2026-09-14
decision-date: 2026-09-14
implementation-status: partial
implementation-completed-date: null
implementation-commits:
  - b2489fa512010d5c90555f8b32e96cbbc77bf7e8
superseded-by: []
---

# Verified Context for Interrupted Tool Groups

## Purpose

Allow a new, explicitly requested conversation turn after a narrowly identifiable cancellation without falsifying the previous execution. Preserve raw transcript evidence and refuse continuation when nonexecution, storage or ownership cannot be established. This adoption record does not authorize implementation in the current task or change the chapter-19 application's existing admission stop.

Current implementation state: **accepted / partial**, recorded below after the implementation commit. The adoption-only statements that follow describe the 2026-09-14 acceptance task and are retained as history. The completion date remains null.

## Decision

**Accepted on 2026-09-14; implementation not started:** retain strict refusal by default and introduce an explicit, versioned `verified-not-dispatched` context policy. The name is provisional. Core will derive provider-facing error-form tool responses only for eligible missing results, preserve canonical messages, and synchronize separate provenance before using the view. This is a new conversation request, never resumption of an interrupted tool or Graph node.

### Author acceptance — 2026-09-14

The author explicitly accepted the recommendation including the 2026-09-14 review corrections. The pre-adoption HEAD is `c293fe6bc8741f9bb07e0182489206aa0943522e`; no source, test or proposal changes occurred after that review. Current code still equals implementation baseline `16e4a49c1e0632870e02380f958492430ea393b5`. No new material contradiction with the accepted scope was found. Public main was independently checked at `1cb6f4f2abe3e89e27c1bdb32f1049183ef0e960` and is not substituted for the local baseline.

The adopted scope is opt-in context-only projection for uniquely proven nondispatch in a cancelled Run, with original messages/outcomes intact and synchronized, retained evidence. Missing calls with any intent, dispatched calls with lost output, ambiguous IDs, unknown outcomes, failed recording and unsettled resources remain excluded. Intent presence is not redefined as actual execution.

The author accepts verification that cannot be bypassed for projection-dependent input, separate read-only observation, replay comparison before history preflight, and preflight before effectful work. The author accepts transcript v3 and coordinated readers, retained Skill/checkpoint validation, unchanged historical Graph high-water positions, the separate byte-preserving v2-to-v3 migration and retention of old artifacts. Latest-turn protection, mandatory notices in budgeting, no Skill in summaries or historical Skill reactivation, Graph sharing and same-ID no-repreparation remain required.

Initial producer/format bounds are adopted as unmeasured starting points; implementation trials must verify them without presenting them as optimal. Existing input-budget delegation and other adoptions were not used as authority for this decision. The original proposal and review wording below are historical, not outstanding requests for re-adoption.

This task records acceptance only. `implementation-status` remains `not-started`, completion is null and implementation commits are empty. The ten earlier accepted/partial decisions and their adoption reasons, prior maintenance-timeout uncertainty, real-model connection conditions, unanswered backup deletion and author-deferred trials remain unchanged. Acceptance includes **no permission to delete backups**, change the book example, implement, publish or operate autonomously.

Acceptance validation reran `headers:check`, `build` and all 651 existing tests on an isolated macOS Node 26.5.0 copy of the unchanged implementation. Lint retained 56 existing warnings and no errors. No runtime or fixture changes occurred. This is regression evidence for the baseline, not implementation evidence for projection or v3 migration. Earlier maintenance-timeout uncertainty and deferred environmental trials remain open.

### Eligible history and evidence

The initial scope is an earlier managed **cancelled** Run whose terminal and recording are verifiable and whose resources are all settled. The raw assistant call exists, its result is absent, and complete required evidence proves that this particular call was never dispatched. All missing calls in the affected history must qualify; do not repair one group and ignore another.

Verify under the existing registered Session/journal ownership boundary:

1. The original message IDs, order, turn association, source head, raw digest and existing compaction ancestry are valid. The old Run has finished; an active Run's pending calls are not eligible.
2. The required journal, key and terminal sequence are readable and complete through the terminal, including relevant later records. No unknown complete records, torn tails, invalid sequence, failed recording, unknown operations, unresolved owners or cleanup failures are accepted as negative evidence. Ordinary tolerant observation of a truncated journal does not qualify it for this operation.
3. The live terminal had acknowledged the required storage level, or a restored terminal is independently revalidated with current storage/ownership checks and required synchronization. Restoration remains `recovered`; it does not manufacture a historical success response. A recorded failed/unknown outcome remains failed/unknown.
4. Match each call using its Session, turn, assistant message ID, ordinal, ID and name. The current intent HMAC includes the call ID but not that full identity. It may be used only where the entire enclosing Run's raw calls and intents admit an unambiguous correspondence. Repeated IDs across groups, unavailable call IDs/keys and unmatched intents refuse eligibility. A Graph visit narrows identity but does not distinguish repeats inside its Agent loop.
5. Every missing call has no corresponding dispatch intent. Earlier reads or other completed groups may have intents and results, provided their attribution is unambiguous. The absence of intent is meaningful only because the adopted runtime synchronizes it before dispatch; it is not inferred from a missing optional log or approval display text.

Partition intents by their recorded variant and validated Graph visit before matching assistant calls. `mcp-startup` intents are not assistant tool-call intents: retain and verify their outcomes/ownership without interpreting them as missing assistant results. A direct Graph tool visit likewise needs a validated bound descriptor/path and visit attribution; do not drop an unexplained intent simply because no raw assistant call matches. If those categories cannot be established from retained evidence, refuse. Repeated call IDs inside the relevant Agent proof domain remain ambiguous; never pair by display text, result ordering or guessed tool name.

An intent may exist even when a later pre-dispatch revalidation prevents execution. Intent presence is therefore an **ineligibility condition for this narrow projection**, not proof that an effect occurred. The original `cancelled-before-start` or unknown status is preserved. Extending proof to such cases requires a later decision.

A complete denied tool result remains unchanged. A dispatched call with missing output is excluded even if its effect is known successful: inventing a failure can encourage repeating an edit. Unknown results and originally unknown terminals remain excluded even after later settlement in this initial scope. Orphan results, duplicate IDs within a group and mismatched names are corruption, not cancellation. A cancellation before any assistant tool call requires no projection.

For memory recording, require the complete same-process journal and existing ownership guarantees; do not claim crash durability or allow reconstruction from a detached snapshot. Required file evidence is read without creating a replacement key or repairing journals. Failure to read or bound the evidence refuses admission.

### Original records and the derived input

Keep the original assistant calls, actual tool results, terminal outcomes and operation records unchanged. Construct a copied view by inserting an error-form tool response only at each verified missing position. Its matching ID/name come from the original call; its deterministic derived ID comes from the source identity and projection revision. Do not use wall-clock time to distinguish the same projection.

Use fixed wording that identifies a context-only notice, a checked absence of dispatch, and the original cancellation. It must say that no actual tool output is available and that the notice is not permission to retry. Do not invent success, file contents, exit status, timestamps, provider reasoning, signatures or continuation tokens. A provider may still induce another call; existing operation authorization remains mandatory and model quality is unverified.

Preserve synchronous `SessionContextBuilder.build()` for histories that do not depend on this projection, including its existing ordinary checkpoint behavior. It is not a raw-history accessor today. For a model view dependent on a persisted projection record or projection-aware checkpoint, this synchronous API must report `verified-context-required` rather than return an unverified or silently shortened model view. Callers needing original evidence use the existing raw Session message/entry accessors; they do not acquire projection authority from those values.

The owning Agent preparation path, shared with Graph, performs asynchronous verification and projection when the policy is selected. It must select that path before calling the synchronous builder, including the first unresolved history that has no projection record yet. An unmanaged raw accessor or direct Model invocation is outside this verified-context guarantee. Apply it before any ordinary model request both with and without input budgeting. An opt-in legacy invoke-only model that cannot consume the prepared view must refuse rather than silently bypass verification.

Budget mode and interruption policy are independent. With the interruption policy off, a history depending on projection refuses new model use, including when ordinary budgeting is disabled. It does not fall back to raw incomplete messages or a lossy summary. For histories without this dependency, preserve existing behavior, without claiming that today's unbudgeted malformed history is accepted by real providers.

Serialize using the existing OpenAI tool ID, Anthropic error `tool_result`, and Ollama tool-name mechanisms. Validate grouping, same-name calls, provider-specific assistant content and preserved metadata for each supported adapter. A provider representation that cannot preserve the needed distinction must refuse this policy. Adapter-only normalization must not establish eligibility.

### Provenance, transcript compatibility and compaction

Use **transcript v3**, with a strict `context_projection` revision-1 record and a compaction `projectionVersion: 2` referring to that provenance. The author accepted this compatibility cost on 2026-09-14. Current transcript v2 does not permit the new provenance record. It can retain an unresolved raw group when no checkpoint validation covers it, as the reproduction demonstrates; that fact alone does not make the file structurally corrupt. Budgeted preparation and version-1 checkpoint validation reject such groups. Adding provenance or projection-aware checkpoint semantics silently to those existing formats would violate old-reader contracts.

The new provenance record contains the owning new Run, original source head/digest and checkpoint ancestry, scoped source call identities, source Run/terminal identities, bounded journal high-water/digest references, projection algorithm revision and derived payload digest. It contains neither journal keys nor fabricated ordinary message entries. Structural decoding validates finite JSON, bounds, references and derivation; it does not execute filesystem reads. Runtime reuse additionally verifies the referenced evidence under ownership. A host-supplied JSON assertion alone is insufficient. Valid structure with unavailable external proof remains readable for observation, labeled unverified/unavailable; it refuses model use. Malformed structure still fails decoding. Observation must not run a model, invoke an adapter, repair storage or delete evidence. Same-ID outcome observation is not a request to requalify a projection.

Synchronize this record at the Session's required level **before the first model request that consumes it**. An incomplete append/sync or cancellation does not authorize invocation; unfinished I/O remains owned by the Run. Freeze the resulting view for that preparation. Recheck source head, raw hashes, checkpoint ancestry and evidence position before using or committing a new checkpoint. Do not turn an I/O failure into an unrecorded fallback prompt.

Raw `sourceDigest` and covered message IDs continue to identify the original raw prefix. Projection-aware checkpoint validation checks the raw source, provenance and resulting complete groups separately. Synthetic IDs cannot be passed off as factual source messages or tool results. Existing version-1 checkpoints retain their original strict validation. A v3-capable reader reads valid v1/v2 transcripts and earlier valid revisions; old readers must reject v3 explicitly. Implement explicit supported-version sets, not a blanket `version >= 2` test. The change includes header/entry codecs, Session creation, `validateSkillEntries`, `validateCompactionEntries`, Agent Graph/Skill/budget admission, Graph transcript inspection, service/CLI/GUI resume and migration inspection. Existing revision-1 Skill payloads and version-1 checkpoints remain valid in v3 with their original identity/order/bounds checks. A v2 header cannot contain the new records, even without a final newline; genuinely incomplete final JSON retains the separate recovery indication and cannot supply projection proof.

Graph journal `transcriptHighWater` continues counting **all data entries except the header**, including new projection entries. Migration must not insert such entries between old records or renumber old prefixes. Old Graph observations in v3 are validated with the v3-capable inspector against the preserved prefix, never by mislabeling the file v2. New provenance appended after cancellation cannot change the original terminal or synchronized entry boundary.

Summarization receives the original source serialized as untrusted data, not as an incomplete provider tool-message sequence, and an explicit untrusted description of the interruption; it must not receive the inserted notice as an actual tool execution. Keep deterministic nonexecution/cancellation notices outside the lossy model-authored summary so summarization cannot erase their status. Include those notices, summary wrapper, current Skill and complete ordinary request in budgeting. Oversized mandatory context refuses input, not truncation of proof or latest-turn protection. The latest ordinary user turn and Graph's full current turn remain protected by the existing rules. Summary-only requests remain tool-free and Skill-free, share existing model-call/token budgets, and do not authorize operations.

Preserve each needed source journal and provenance for as long as the Session view or its checkpoints depend on it. Missing evidence later makes that view unusable, even if a summary survives. Evaluation and transcript observations must distinguish derived context from actual output and retain the original cancellation. Existing Session deletion and exclusive maintenance remove associated data using the adopted lifecycle; this proposal adds no independent background deletion or new journal version.

The new migration accepts a complete, structurally valid v2 source only. Existing v1 data first follows the adopted v1-to-v2 migration, whose retained v1 backup preserves the original source; do not claim that current re-encoding is byte-preserving. The new v2-to-v3 stage preserves the entire source data-entry byte sequence and order after the header, including existing Skill/checkpoint records. Only the header changes during conversion; new projection entries are appended by a later owned Run.

Migration stops old processes, external admission and automatic restart sources and uses existing exclusive storage/maintenance conditions. Extend the migration intent with an explicit version and source/target format and digests. Use distinct v2-backup/v3-pending artifacts, never overwrite or reinterpret an existing v1 migration intent/backup. Recognize old pending intents with their original resume procedure. The new inspection/resume path covers pre-intent guard retention, every file/directory sync, replacement, guard release and intent removal. A second migration call on a completed v3 source inspects it and reports already migrated without recreating backups or changing old records. Retain the old transcript backup and validate/synchronize the replacement before external restart. Ambiguous replacement/response keeps admission stopped until exclusive inspection and synchronization. There is **no authorization to delete existing backups**. Do not allow an old automatic restart source to reopen the migrated pair.

### Run, Graph, Skill and replay

Projection does not release old owners, cancel resources, clear application markers, confer tool permission or change host selection transactions. A host separately offers a new explicit user turn; the chapter-19 example continues refusing until a later accepted and verified integration changes it. Explicit migration to another Session also requires separate human-facing context selection and cannot resolve unknown effects.

For an enabled new request, preflight prior-history eligibility under Session ownership before admitting work that can dispatch model/tool/Graph effects. Perform the same-ID lookup/comparison first; replay must not start this preflight. Pin the verified source/evidence snapshot, then recheck it before the synchronized projection is consumed. Normal new-turn/Skill entries added by this Run must be accounted for explicitly, not mistaken for an unchanged whole-transcript digest. If a host path performs authorized MCP startup before eligibility can be checked, that startup and its ownership remain real effects; such a path does not satisfy the proposed early-refusal condition and must be reordered for this policy rather than claim zero work. No older unknown Run becomes eligible through this preflight.

Graph shares the existing Run, turn, environment, catalog, Skill snapshot and budgets. Its Agent stages use the common preparation path. Direct tool nodes retain actual values and journal outcomes and do not receive synthetic Graph success. No unfinished node is restarted. Old Skills are not selected again from historical snapshots; only the current Run's selected Skill is applied to ordinary requests, never to summary-only requests.

Include the selected projection policy and algorithm revision in exact submitted configuration/encoding and prepared-context identity at all service, CLI, GUI, library and selection entrances. Preserve old default encodings when disabled. A changed policy with the same request ID conflicts rather than adapting an old receipt. Freeze the view once per preparation; a same-ID retry reuses the existing Run/result and must not repeat model, adapter, MCP, Skill or projection preparation. After restart observe the old outcome instead of acquiring another execution right. A distinct user request uses a new ID and fresh checks; it is not a workaround for unknown outcomes. Existing authorized MCP startup and actual snapshot checks remain in force.

### Bounds and author judgment

Provisional producer limits are 128 inserted notices per prepared view, 1 MiB projection metadata and 64 MiB cumulative raw evidence inspected per preparation. Exceeding a runtime budget means refusal, not partial verification. Use a fixed revision-1 JSON record maximum of 4 MiB, separate from adjustable producer limits. Lowering product limits must not render earlier valid stored records structurally invalid; reading and execution eligibility are separate. These are unmeasured starting values, not optimal limits.

Author choices recorded at proposal time (resolved by the explicit acceptance above):

- Whether to add this opt-in scope rather than retain refusal or offer only explicit new-conversation migration.
- Whether to limit initial eligibility to uniquely proven nondispatch in a cancelled Run, leaving dispatched/missing and unknown cases blocked.
- Whether to accept v3 migration, backups, evidence retention and separately persisted projection-aware checkpoints.
- Whether to accept ordinary-request coverage with budgets off, refusal by synchronous/unverified model-context entrances when projection is needed, refusal of incompatible legacy models, replay identity changes when enabled, and the proposed initial bounds.
- Whether to accept separate v1-to-v2 and byte-preserving v2-to-v3 migration, version-aware Graph/Skill readers and migration artifacts, early prior-history preflight for enabled requests, while keeping read-only outcome observation available without projection proof.

No earlier delegation for input budgets or adoption of Skill, Graph, evaluation or selection approves these choices.

## Consequences

A narrowly verifiable cancellation can become usable context without fabricating successful execution. Refusal stays available and unsupported or ambiguous history remains blocked. This does not guarantee useful model behavior or solve every interrupted conversation.

Costs include an owned asynchronous evidence read, retained journals, a persistent format migration, projection-aware compaction, provider-specific verification, additional budget consumption and a new configuration identity. Call-ID ambiguity in old journals deliberately reduces eligible cases. No broad automatic repair, new execution runner, new journal version, permanent backend or autonomous retry is introduced.

This decision partially supersedes the strict complete-group admission/compaction clause of [budgeted Session compaction](2026-09-08-budgeted-session-compaction.md). Its original reasons and history remain intact. The ten existing accepted/partial ADRs retain their current status and adoption rationale; the compaction record links this limited supersession without changing its accepted / partial status or original reasons. The exception applies only to the new verified policy and format; current runtime refusal remains until separately implemented. Managed lifecycle, authorization, required journal, recovery/storage guards, Skill, Graph, evaluation and selection continue to own their existing contracts.

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

A separately requested implementation must update public APIs, current architecture/concepts/features and migration instructions. This acceptance changes none of those maintained implementation documents. Completion requires full implementation hashes and results in a later ADR record commit, not this adoption commit.

### Implementation evidence — 2026-09-14

Implementation commit: `b2489fa512010d5c90555f8b32e96cbbc77bf7e8` (`feat(context): verify interrupted tool history before new runs`). The implementation started from adoption commit `b18a27592d3a7005acbd643ba82d8d288fab6d27`; no intervening source/test change or new architectural decision was substituted for the acceptance. This later documentation commit records **partial**, not completed. The ten other partial ADRs and their reasons are byte-for-byte unchanged.

The opt-in policy is `interruptionPolicy: {mode: 'verified-not-dispatched', revision: 1}` on Agent or workspace/service settings. Default request encoding and the book application's admission stop remain unchanged. New enabled Sessions use v3; existing data requires explicit migration. The [maintained feature guide](../interrupted-context.md) owns API, limits and offline recovery instructions; architecture, concepts, settings, Session, Skill, Graph and compaction guides now describe the implemented paths.

| Contract                               | Source and executed evidence                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Eligibility and raw truth              | `session/interrupted-context.ts` validates unique raw call correspondence, complete cancelled/acknowledged/quiescent evidence and Graph attribution; any missing call with an intent remains ineligible, including known success or cancelled-before-start. `interrupted-context.test.ts` checks ambiguity, denied responses and terminal failures. Original messages and outcome remain unchanged.                                                            |
| Owned verification and refusal         | `verified-context.ts`, Recorder and journal perform bounded synchronized evidence reads under current ownership, before effectful preparation and before consumption/checkpoint saving. `context-projection-evidence.test.ts` verifies missing/torn/unknown evidence, lost output, source mutation, disabled-policy refusal, replay before recheck and cancelled pending I/O with retained ownership and unchanged terminal.                                   |
| Durable views and repeated preparation | `context_projection` records bind current raw head/digest, checkpoint ancestry, proof position and deterministic view. A new raw head or checkpoint gets a new synchronized projection in the same Run. `context-projection-integration.test.ts` covers Agent/Graph approve/deny/cancel, budgets on/off, actual summary triggering, direct-tool-first Graphs, reopen, same-ID observation, another tool/model iteration and missing retained journals.         |
| Providers                              | `context-projection-providers.test.ts` captures frozen OpenAI/Anthropic/Ollama requests with injected SDK doubles, including same-name calls, call IDs or Ollama names, explicit error notices and retained provider metadata. No provider connection or model-quality result is implied.                                                                                                                                                                      |
| Format and migration                   | `context-projection-format.test.ts` checks explicit v3, old-format refusal, raw/derived/ancestry/order validation, incomplete versus complete unknown JSON and byte-identical data after the changed header. V1 backups remain intact. `context-projection-migration.test.ts` injects before/after failures at every synchronous write, sync, rename and unlink reached by this migration, then verifies resume or the required preserved empty-guard refusal. |
| Bounds                                 | The current 128-call limit admits 128 and refuses 129 in the runtime. A valid 129-call historical record still decodes under the separate fixed format limit. The 1 MiB metadata and cumulative 64 MiB evidence limits are enforced but were not characterized as optimal operating limits.                                                                                                                                                                    |
| Skill and checkpoint combination       | A temporary variant of the committed integration fixture selected a BOM/CRLF Skill in the first two Runs, triggered summaries, reopened v3 and executed a later unselected Run. Both OS runs passed six controls: ordinary input contained the current Skill, summaries and the later unselected Run did not, and exact stored source remained intact. This is supplemental fixed-double evidence, not a general real-provider Skill trial.                    |

Validation on macOS arm64 / Node 26.5.0 and Linux arm64 / Node 22.23.2:

- `headers:check`, native `build`, and full `npm test`: **693 passed on each OS**; 651 existing tests plus 42 new tests. Lint: **0 errors / 64 warnings**, compared with 56 previously recorded warnings. The related research fixture received mechanical lint/format fixes only; its six default-policy controls still reproduce cancellation refusal.
- Tests ran in isolated copies; all 39 related files were checked byte-for-byte against the installed implementation and against the Linux copy after formatting. The actual Orbit path then passed headers/build and the **42-test targeted suite**, and its default-policy research fixture passed all six controls. The package/lockfile did not change.
- Linux dependencies were installed from the unchanged lockfile into an isolated copy with lifecycle scripts disabled; native build and tests then ran in a network-disabled container. No host settings, provider credentials, live MCP service or book example was used.
- An initial sandbox run had three localhost `EPERM` failures. An intermediate unrestricted run observed two child-loader errors while source edits were still in progress; it is not the final source's verification. Stable final runs above passed. No final maintenance-recovery timeout occurred; the historical timeout's cause remains unconfirmed.

Detailed local logs, tested copies, fingerprints and the supplemental Skill variant are under `/private/tmp/orbit-interrupted-implementation/`. This path is disposable evidence, not a permanent runtime dependency. The source tests and implementation commit provide reproducible retained coverage.

Remaining confirmation before completion:

- The new projection's full process-death matrix around append/sync, and per-open/read/close failure injection across every new evidence-I/O boundary, are not established by the migration exception tests or the generic pending-I/O test. Add isolated child-process fault fixtures; require explicit boundary exit and preserved evidence, not a timeout.
- Combined v3 policy coverage at every CLI/Ink/GUI/selection receipt entry, hostile path/root replacement during proof reads, and older Skill/checkpoint migration fault combinations need expanded targeted integration evidence. Existing surface/storage/Skill regression tests passed, but are not substitutes for every new combination.
- The producer metadata/raw-byte upper boundaries need dedicated load/failure trials; the call-count boundary and strict persisted-format checks do not establish suitable production sizes.
- Real provider acceptance/meaning preservation, selected live MCP conditions and representative applications need isolated connection/target settings. Windows, representative usage, production SLI/SLO and physical storage-failure trials remain author-deferred. No initial limit is claimed optimal.

These gaps keep this ADR **partial**. They do not authorize loosening eligibility, automatic recovery, backup removal, changing the chapter-19 application, or re-adopting existing decisions. Continue core verification before a separately requested application integration.

### Proposal review — 2026-09-14

Reviewed against proposal commit `f218635c4397431239f160f41ad90b0a50a06d9e`; source and tests still equal the original implementation baseline. No acceptance or implementation is recorded. The original proposal history remains in that commit.

The review corrected five underspecified boundaries:

1. Current `SessionContextBuilder` already projects checkpoints; calling it raw was inaccurate. Disabling budgeting/policy or using the synchronous builder must not bypass required verification after projection-dependent history exists. Read-only evidence/outcome access remains available separately.
2. Current Graph, Skill, compaction and inspection explicitly check transcript version 2. v3 is a coordinated reader/admission change, not a header-only migration. A raw unresolved group can already survive in a valid v2 file; failure of budgeted input is distinct from structural corruption. Preserve existing data-entry positions for old Graph high-water observations.
3. The existing migration re-encodes entries and targets v2 only. A distinct v2-to-v3 stage must meet the new byte-preservation promise and retain older backups and pending-intent semantics.
4. Intent proves that dispatch was prepared, not that it occurred. Keep the conservative exclusion, separate startup/direct-node intent categories and do not synthesize an output for a dispatched call lost in the same cancelled group.
5. Checking only at a later Agent node can allow an earlier direct Graph tool to run before history is rejected. Enabled requests need an owned prior-history preflight after replay comparison and before effectful preparation/dispatch. This ordering is an additional implementation condition, not a capability verified by the current fixture.

Additional source and temporary diagnostic evidence is recorded in the research review addendum. The recommendation remains narrowly verified nondispatch with default refusal. These corrections enlarge explicit compatibility/verification costs; none has been adopted.

Additional implementation confirmation is required for: policy-off and synchronous builder bypass attempts; read-only observation with missing proof; prior version-1 checkpoints and Skill records inside v3; original Graph high-water positions before/after migration; old/new migration intent coexistence and interruption; same-ID replay before proof preparation; Graph direct-tool-first and MCP-startup ordering before eligibility; mixed startup/direct-node/Agent intents; a successful read lost beside a cancelled write; and intent followed by failed pre-dispatch revalidation. All remain unexecuted tests for the proposed feature.

## Follow-up Work

The reviewed decision is now accepted. In a separately requested implementation, implement core first and verify the confirmation matrix before separately changing the completed example's refusal policy or manuscript. Broader recovery, new-conversation UX and model-quality trials need separate scope.

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
