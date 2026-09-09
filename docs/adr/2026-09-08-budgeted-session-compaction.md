---
status: accepted
proposed-date: 2026-09-08
decision-date: 2026-09-09
implementation-status: partial
implementation-completed-date: null
implementation-commits:
  - 2a33ed20e27a5a526d1923cad20890cc46185135
  - 8fbfee61243b27d5d243aeaf0d127d019af32261
superseded-by: []
---

# Budgeted Session Compaction

## Purpose

Let a coding agent continue after accumulated file and test output approaches a
model's input limit, while retaining the original conversation and explaining
exactly which context is restored after restart. A saved Session alone does not
solve bounded model input.

## Decision

**Accepted on 2026-09-09; implementation partial.** Use a managed asynchronous
context-preparation step that produces a validated, synchronized compaction
checkpoint, followed by a pure synchronous projection of that checkpoint and
retained conversation. The application enables this behavior through an
explicit model profile; it does not implement its own history deletion.

### Complete-request budget and public boundary

Introduce an optional `ContextPolicy` on Agent/Service with an explicit disabled
mode and a budgeted mode. An absent policy retains disabled compatibility mode.
Budgeted mode requires model identity, context-window
size, output reserve, safety margin, trigger and target input sizes, maximum
summary output and a request estimator. Names are proposed; implementation may
refine names without changing these contracts.

For window `W`, reserved output `R` and safety margin `M`, usable input is
`B = W - R - M`. Validate finite integer values with `0 < target < trigger <= B`
and `R > 0`. Do not guess a window from a model name. A changed provider/model
requires a matching profile and a fresh estimate. Supply no universal optimal
numeric profile; the book fixture uses declared artificial limits, and product
values require later application measurements.

The estimator consumes the same frozen provider projection used for the actual
request, including instructions, tool schemas, selected messages and modality
accounting. Return the model/provider and estimator version, total, components,
and whether values are estimated, measured or unknown. A measured previous
response is not a measurement of this request. Unknown required components
reject budgeted preparation; an estimate is not a hard provider guarantee.

Add an output-token cap to the model invocation boundary. A budgeted adapter
must map that cap to its provider request and declare the mapping supported;
unsupported adapters refuse budgeted use rather than ignore the reserve.
Custom models can supply compatible estimation and capped invocation contracts.
Raw Model invocation and explicitly disabled legacy Agent calls retain their
existing behavior, which must be documented as unbudgeted. CLI/GUI display the
active mode; the book's final application enables budgeting through Service.

At or above `trigger`, attempt compaction to at most `target`. Below trigger,
use the validated current projection. If protected content alone exceeds `B`,
stop with an input-budget error. Never trim trusted instructions or the latest
user request to force a fit. Adapter overflow after estimation stops the Run;
there is no automatic oldest-message deletion or repeated blind retry.

### Protected boundary and summary contents

In budgeted mode, before each model call validate tool-call/result IDs, ordering and complete
multi-call groups. The current user turn is retained whole, including its
completed tool groups. Only older complete user turns are candidates. An
unresolved, duplicate or mismatched call/result prevents ordinary invocation
and compaction until the existing execution/recovery path establishes a usable
history; a summary cannot invent a missing outcome. Journal unknown outcomes
and pending approval also prevent compaction.

Preserve the trusted prefix verbatim outside the summary. Deep-copy or freeze
projected nested payloads so preparation cannot mutate canonical messages.
The summary is an explicitly labeled untrusted conversation checkpoint,
projected as user-level context, never as system policy or an approval grant.

Use a versioned structured summary with goals and constraints, observed facts,
changed paths, test evidence, unfinished work and uncertainties. Factual entries
reference existing source message IDs; test records distinguish the target,
revision/condition, outcome and unavailable evidence. Missing evidence remains
unknown. Validate schema and source membership, reject invented source IDs,
and retain original history for inspection. These checks do not prove semantic
truth or guarantee that the model omitted no important fact.

### Managed preparation

Keep `SessionContextBuilder.build` synchronous and side-effect free. A separate
async preparer runs before it within the owning Run. It snapshots the source
head and previous checkpoint, plans a complete-turn cut and estimates both the
summary request and resulting ordinary request. Concurrent mutation invalidates
the candidate and stops preparation; it does not silently rebase it.

Invoke the configured summarizer with no tools, a bounded output cap and the
same Run cancellation, deadline, model-call accounting and resource ownership.
The summary call consumes a model call. It must fit its own configured window;
if the source cannot fit, stop with a compaction-input error. Initial delivery
does not recursively summarize chunks or start a nested Agent. Allow at most
one summary attempt per ordinary model iteration. A response containing tool
calls is invalid and never dispatches tools.

Validate the candidate, estimate the full post-compaction request again, save
and synchronize the checkpoint, then activate it. Empty, malformed, oversized,
non-reducing or above-target output is a compaction failure. On a summary-only
failure, the unchanged original projection may be used only when it fits `B`
and the Run is still active with budget remaining; emit a visible failure event.
Cancellation, exhausted Run budgets, unresolved resources and storage failures
never use this fallback. Memory-only Sessions use the same validation and
atomic in-memory activation but do not claim durable recovery.

### Transcript v2 and replay

Add a version-2 transcript compaction entry rather than disguise a summary as an
assistant message. Keep all original message entries and IDs. Storage binding
version 2 and transcript version 2 are distinct schemas and migrations.

A checkpoint contains a unique ID, Session ID, source head ID, summarized prefix
end ID, first retained message ID, previous checkpoint ID or null, canonical
source digest and digest algorithm/version, structured summary, projection
version, model/provider identity, estimator/profile revision, before/after token
estimates, summary usage when available and creation time. The source digest
covers the exact original entries in the summarized prefix in deterministic
encoding; the previous checkpoint is validated separately. IDs denote a prefix
on the Session's linear history, not numeric offsets or an independent branch.

Replay verifies source IDs, order, digest, complete-turn boundary and predecessor
chain. The newest valid checkpoint replaces only its covered prefix in model
input; it does not erase the transcript. A second checkpoint can summarize the
previous summary plus newly eligible complete turns, while its digest still
refers to the expanded original prefix. Reopening never regenerates a summary.
Invalid complete checkpoints fail closed rather than silently selecting an
older view. A malformed final partial line follows the established transcript
recovery contract; execution journal recovery remains separate.

Appending is not activation. With a persistent Session, use the verified writer
and the Run's required persistence level, including transcript synchronization,
before publishing the active checkpoint or starting the next model call. On
failure, stop and retain the resources/evidence required by the existing Run
contract. A complete checkpoint that survived a crash may be adopted on reopen
only after validation and re-synchronization under the writer; this does not
claim that the previous API returned success. Losing an unsynchronized suffix
returns to the preceding valid view, with no fabricated operation result.
The checkpoint is context data, never proof of external side-effect completion.

### Compatibility and migration

New readers support v1 as uncompacted history and v2 as the new format. New
budgeted persistent Sessions use v2. Do not append v2 entries under a v1 header
or silently upgrade a live Session. Existing unbudgeted v1 callers continue
until explicit migration; enabling persistent compaction for v1 reports that
migration is required.

Provide an exclusive migration command/service: stop external admission and
all restart sources; retain a backup; acquire the stable Session scope and
maintenance guard; validate closed transcript, journal and registration; write
and sync a v2 copy in the same directory; atomically replace the transcript;
sync the parent; validate the resulting file; release maintenance only after
success. Preserve Session/message IDs, registration and deletion records.
A migration intent records source and target digests before replacement and
remains under the guard until completion. A surviving guard refuses admission;
exclusive maintenance identifies whether the original or replacement matches
that intent, re-synchronizes and validates before release. An ambiguous or
missing file remains refused. Never remove a guard just because its PID died.

Old readers reject v2; stopping old binaries is a migration cost, not a fallback
mechanism. Read-only inspection must report migration/invalid state without
repairing it. Normal release, isOpen and deletion continue using the same stable
scope; migration cannot race them. Deletion uses SessionDeletionService and
retains the minimal deletion record. No new checkpoint may revive a deleted ID.

## Consequences

- Positive: bounded preparation is shared across Agent, CLI, GUI and library callers; original evidence and reproducible resume remain available.
- Negative: adapter accounting/output-cap contracts, explicit profiles and a transcript migration increase implementation and operational cost.
- Negative: whole-turn protection can stop a single very long coding turn even when older history was compacted; chunking and split-turn summaries require later evidence and a separate decision.
- Neutral: users may retain explicitly unbudgeted compatibility mode; it does not satisfy the book application's bounded-input goal.
- Neutral: deterministic mechanics tests cannot establish summary quality or optimal thresholds; deferred representative trials remain necessary.

## Context and Problem Statement

At `6a14c1a82fecef409492c74eddc1a2e1d1bd1660`, the builder returns full history,
shares nested payloads and performs no pairing or input-size validation. Agent
adds instructions and tool specs outside that builder. The v1 codec rejects a
compaction record. A memory-only reproducer confirmed these facts and 7 existing
Tokenizer/Session tests passed; neither is implementation evidence for this ADR.
See the [research note](../research/2026-09-08-input-budgets-and-compaction.md)
for the source list and exact external revisions.

The accepted [linear assembly ADR](2026-08-23-session-context-assembly.md) remains
the basis for canonical Session ownership. If adopted, this proposal extends
its implemented phase with optional budgeted projection and durable checkpoints;
it does not erase the original decision or relabel its future phases accepted.
It extends [Session persistence](2026-08-22-session-persistence.md) with a new
format and explicit migration, preserving v1 read behavior. This proposal alone
does not supersede or change the status of either record.

The five accepted/partial execution, authorization, journal, writer recovery
and registration ADRs retain their reasons and status. Their ownership,
unknown-outcome, synchronization, exclusion and deletion requirements apply to
this new preparation work without being adopted again.

## Decision Drivers

- Coding work needs the latest request and test evidence after long investigations.
- Provider inputs include more than transcript text.
- Summarization cannot grant permission or prove that an operation finished.
- Persisted context must reproduce across restart without deleting source evidence.
- Failure must be explicit and bounded by the existing Run, not an independent retry loop.

## External Implementation Research

Codex `5adb68a49933ae446bf11935662c83dba55a0804`, `compact.rs`, informed separation
of compaction from ordinary execution and explicit trusted-context restoration.
Its local overflow deletion is not recommended for Orbit.

Pi `b79e4cc834970cca69daebffab7df1da7d1e52c4`, `compaction.ts` and
`session-manager.ts`, informed checkpoint boundaries and retaining recent
context. Orbit does not adopt Pi's token defaults, tree history or split-turn
summary behavior. The research links the exact inspected primary sources;
these systems were not executed in this investigation.

## Considered Options

| Option                                                           | Assessment                                                                              |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Wait for provider overflow and delete old messages               | Rejected recommendation: late failure and broken evidence/pairing.                      |
| Let applications inject ordinary summary messages                | Insufficient: duplicates ownership and cannot define shared replay.                     |
| Make the existing builder asynchronous and effectful             | Viable alternative, but changes projection callers and obscures persistence ordering.   |
| Managed preparer, synchronous projection, append-only checkpoint | Recommended: separates bounded model work, durable activation and deterministic replay. |
| Rewrite the transcript to summary-only history                   | Lower storage use, but loses canonical evidence and makes recovery comparisons harder.  |

## Implementation and Confirmation

The author delegated acceptance after review on 2026-09-09. The acceptance
commit preserved `not-started`; the following later implementation evidence
records delivered behavior without changing the accepted reasons. Completion
remains null because the open items below are not confirmed.

| Verification        | Required evidence                                                                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounting          | Prefix/tool schema/adapter wrappers are included; unknown modality, model changes and unsupported output caps refuse budgeted use. Capture actual provider requests against estimator input.               |
| Thresholds          | Below/at/above trigger, invalid profiles, protected input overflow, summary request overflow and non-reducing candidates; no hidden unbounded retry.                                                       |
| Conversation        | Nested payload isolation, complete multi-tool groups, missing/duplicate results, latest-turn preservation and pending/unknown execution refusal.                                                           |
| Summarizer          | Fixed-model success, tool-call response rejection, empty/invalid/too-large output, cancellation, timeout and model-call exhaustion. No tools execute during preparation.                                   |
| Replay              | Identical source IDs and selected messages before/after close; two checkpoints, bad digest, missing predecessor, stale source head and invalid boundary refusal.                                           |
| Storage             | Faults before/after checkpoint append and each required sync; no live activation on failed sync, valid surviving checkpoint re-sync, truncated-tail recovery separate from journal.                        |
| Migration           | v1 read, explicit upgrade, old-reader rejection, interruptions around intent/copy/sync/rename/parent sync/guard removal, refusal during inspection/release/deletion races and safe exclusive restart.      |
| Surfaces            | Agent/Service/CLI/GUI/library share policy and emit visible compaction outcomes without logging transcript bodies by default.                                                                              |
| Unix                | Target tests, headers:check, build and full test on macOS/Linux; timeout alone is not success.                                                                                                             |
| Application quality | Deterministic fixtures preserve source references and expected facts; real-model semantic preservation, cost and representative task tests stay separately identified and deferred until conditions exist. |

After implementation, record full implementation hashes and executed evidence
in a later documentation commit. Do not mark completed with required acceptance
checks still unverified. Existing five partial ADRs are not completed by this work.

### Implementation evidence — 2026-09-09

Implementation commit: `2a33ed20e27a5a526d1923cad20890cc46185135`.
Additional boundary tests: `8fbfee61243b27d5d243aeaf0d127d019af32261`.
The implementation includes public `ContextPolicy`, `ContextProfile`,
`RequestEstimator`, prepared model invocations, structured summaries, transcript
v2 entries and exclusive migration/inspection. Agent snapshots the JSON profile
per Run; injected estimator functions remain in memory. CLI, Ink, Service and
GUI consume the shared policy and context events. Maintained architecture,
concepts, glossary, settings/session guides and generated CLI help were updated.

| Area                     | Executed evidence and limits                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounting               | `test/core/prepared-model.test.ts` captures the same frozen request passed to fake OpenAI/Anthropic/Ollama SDK clients, including tool schemas and output caps. `context-compaction.test.ts` checks unknown accounting, mismatched/invalid profiles, protected overflow and summary-request overflow. These are SDK-boundary fixtures, not live provider measurements.                 |
| Thresholds and summaries | Below/at/above trigger, success, empty/oversized/invalid-test output, invented source IDs, tool-call output, original-input fallback and refusal when it cannot fit. Summary calls consume the owning Run's model allowance.                                                                                                                                                           |
| Ownership                | Cooperative cancellation activates no checkpoint. A noncooperative summary crosses the Run deadline, returns incomplete with retained ownership, and remains quarantined after late settlement until explicit stopped-work reconciliation. The original result stays unchanged.                                                                                                        |
| Replay                   | Original IDs and latest input survive compaction/reopen; repeated checkpoints validate predecessor and digest. Tampered originals, missing predecessors, stale heads and invalid retained boundaries reject replay. Nested projected payloads are isolated.                                                                                                                            |
| Saving                   | `compaction-save-interruption.mjs` reports 27 passing cases: observed append/sync boundaries and injected sync failure. A failed sync does not activate the live candidate; surviving complete entries are validated and re-synchronized when reopened.                                                                                                                                |
| Migration                | `compaction-migration-interruption.mjs` reports 38 passing boundaries around guard/intent/backup/replacement writes, syncs, rename and removal. Each child must reach the named boundary and exit with the expected code; timeout or a crash elsewhere fails. Normal admission/isOpen and generic recovery refuse pending migration; exclusive resume validates source/target digests. |
| CLI and application      | Actual storage command tests cover read-only Session inspection, explicit v1 upgrade and repeated-upgrade rejection without a stranded guard. Service integration verifies new persistent v2 Sessions and `context.prepared` diagnostics. GUI/Ink display changes are source/build verified; this work does not claim new visual interaction or transport-fault trials.                |
| macOS                    | Node 26.5.0 arm64: headers:check, build and full test succeed, 474 passing. ESLint reports 0 errors and 19 warnings (15 existing warnings and four complexity warnings in changed runtime paths).                                                                                                                                                                                      |
| Linux                    | Fresh Node 22.23.2 arm64 Debian container: reproducible npm ci, headers:check, native build and full test succeed, 474 passing. No real credentials, models or personal Session roots are used.                                                                                                                                                                                        |

The book's isolated `examples/context-compaction-demo.mjs` runs on both Unix
environments through the real public Agent/Session APIs. With explicitly
artificial character accounting, the request changes from 4,496 to 835 units;
4 original messages remain, the projected conversation has 3 messages, and
reopen uses one ordinary call without regenerating the summary. It checks
failed-summary fallback and protected-input refusal. These numbers describe
this deterministic fixture only, not provider tokens or optimal settings.

### Open confirmation and restart conditions

- Migration retains a `.v1-backup` containing the original conversation. The
  existing deletion service does not remove that additional copy. A scoped
  implementation that validates its Session ID, v1 format, canonical location
  and single-link identity before removing it during explicit Session deletion
  is awaiting the author's specific permission after automatic approval review
  rejected that code change. No backup-deletion code or real-data deletion was
  performed. Do not claim all conversation copies are erased. Resume this
  integration only after the backup policy is confirmed, then test rejection
  and interrupted deletion before recording completion.
- Live model semantic preservation, actual provider counting/cost and product
  thresholds remain unmeasured. Resume with an isolated coding target, model
  configuration, representative long outputs and explicit quality criteria.
- Windows, real operational exclusion/restart control and physical storage
  failures remain deferred by the author. Resume when a supported environment,
  target application/storage and relevant SLI/SLO conditions are available.
- The existing five accepted/partial execution and storage ADRs retain their
  statuses and accepted reasons. This change neither completes their deferred
  trials nor adopts unrelated Skill/Graph/evaluation designs.

### Review and delegated acceptance — 2026-09-09

Reviewed against clean source at `d5939bb1cf7746748bac659dcc18f3bf30dbe3ab`;
there were no implementation changes after the proposal. The author explicitly
delegated acceptance if review found no blocking problem. Accept the recommended
contract, including explicit profiles, compatibility mode, protected whole turns,
managed tool-free summaries and exclusive transcript migration. Prior decisions
retain their rationale and status. The following implementation clarifications
preserve, rather than replace, the proposed safety requirements:

- Generic writer recovery must refuse a pending transcript migration intent;
  only migration-aware exclusive recovery may validate its digests and finish it.
- The frozen request inspected by the estimator must be the request sent by the
  adapter, with the validated output cap already applied. Re-projecting mutable
  inputs after estimation is not sufficient.
- Disabled compatibility mode does not silently consume compaction records as
  ordinary transcript messages. A v2 Session with checkpoints still replays its
  validated context; disabling the budget only disables automatic preparation.

No implementation or new platform/quality evidence is claimed by acceptance.

## Follow-up Work

The delegated acceptance includes (1) explicit profiles and an unbudgeted
compatibility mode, (2) whole-turn protection with explicit stopping, (3) a
managed tool-free summarizer, and (4) transcript v2 with exclusive migration and
replay activation distinct from a previous API acknowledgement. These form one
cohesive bounded-context contract.

Implement and verify before drafting chapter 10's operational
claims. Update architecture, concepts, context/session/model documentation,
API exports and migration instructions. Initial profiles must be labeled as
trial values; measurements cannot be inferred from deterministic fixtures.
Cross-session memory, recursive/chunked or split-turn summarization and a global
model catalog remain outside this proposal.

## References

- [Input budgets and compaction research](../research/2026-09-08-input-budgets-and-compaction.md).
- [Linear context assembly](2026-08-23-session-context-assembly.md).
- [Session persistence](2026-08-22-session-persistence.md).
- [Managed Run lifecycle](2026-09-07-managed-run-lifecycle.md).
- [Operation authorization](2026-09-07-prepared-operation-authorization.md).
- [Required execution journal](2026-09-07-required-execution-journal.md).
- [Writer recovery](2026-09-08-session-writer-recovery-guard.md).
- [Storage registration](2026-09-08-session-storage-registration-guard.md).
