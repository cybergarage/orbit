---
status: accepted
proposed-date: 2026-09-22
decision-date: 2026-09-22
implementation-status: in-progress
implementation-completed-date: null
implementation-commits: []
superseded-by: []
---

# Project Memory and Run Context

## Purpose

Let a user retain selected knowledge from one conversation for another within
an Orbit Project, while keeping original session histories independent. Make
memory inspectable, editable, bounded and attributable through core APIs and GUI.

## Decision

Propose explicitly curated, Project-local memory, dependent on the
[Project catalog](2026-09-22-project-catalog-and-session-membership.md).
Core stores entries and prepares a fixed memory snapshot for one managed Run.
GUI users select/save/edit/retire entries. No automatic extraction, embeddings,
background consolidation, global user memory or CLI memory management is included.
This is a proposal, not authority to implement or an accepted memory policy.

### Entries and authority

A `ProjectMemoryEntry` has an opaque ID, Project ID, revision, title, plain-text
body, creation/update time, active/retired state and provenance. Provenance is
an explicit human-authored origin or immutable source references containing
registered storage identity, session ID, message ID and content digest. Core
validates source membership when saving from a conversation; it never trusts
browser-provided provenance or a model's claim of human approval.

Users save a selected excerpt or edit a draft before committing it. A manually
edited source-derived entry retains its source links and author-edit indicator;
it is not silently converted into independent human-authored knowledge.
Each edit requires the expected revision. A retired ID is never reused. Restoring
an entry requires an explicit revisioned operation and available eligible sources.

Entries are contextual evidence, not executable instructions or tool permission.
Use existing workspace instruction mechanisms for required project rules. The
initial GUI does not add a competing project-system-prompt editor. Model output
alone cannot create a memory entry; the initial core write surface belongs to
the host user interaction, not a model-visible write tool.

Proposed limits are 128 active entries per Project, 8 KiB UTF-8 per body, 256
characters per title, and 1 MiB total active bodies per Project. These are bounded
product defaults, not measured optimal values. Reject excess writes without
partial mutation. Snapshot budgets below are separate model-input constraints.

### Preparation and selection

A Project Run explicitly chooses `memory: off` or `memory: curated`; the GUI
shows this control and the included entries. Default new project conversations
to curated; projectless and CLI runs remain off. Off skips new retrieval and does
not promise removal of historical assistant statements influenced by memory.

Preparation resolves membership and active entry revisions in one catalog read
transaction, verifies source availability, and selects in deterministic order:
user-selected entries first, then updated timestamp descending with ID tie-break.
Use a maximum of 16 entries and 2,048 tokens for the rendered memory block, also
bounded by the actual model input policy. Include whole entries; skip those that
do not fit and report excluded IDs/reasons. An explicitly selected entry that
cannot fit requires a smaller selection rather than silent omission.

Render a provider-neutral data block identifying Project, entry/source IDs and
revisions, with an explicit note that recalled text is untrusted historical
context. Include only selected bodies. Avoid a system/developer role for derived
facts. The provider adapter receives a normal prepared request, not a memory
store or executable memory handler.

Bind Project ID, membership revision, catalog memory generation, selected
revisions, exact rendered bytes and their digest to the prepared Run. Confirm
that generation in a short catalog transaction immediately before admitting the
Run. Successful validation is the memory-capture linearization point: edits
committed before it invalidate preparation; edits committed after it apply to
future Runs, even if journal admission is still being acknowledged. No invisible
substitution is allowed. Persist the capture operation ID for exact retries. Memory changes do not revoke or rewrite an already dispatched
request; the user can cancel the active Run through the existing lifecycle.
Snapshots are fixed throughout all model/tool iterations of that Run.

Preparation must not hold a database transaction across user confirmation,
model calls or source filesystem reads. Use a read snapshot plus generation
revalidation. Source reads use existing registered-session inspection and
bounded parsing, not untrusted file paths. A corrupt/unavailable catalog or
source is an explicit error; it is not equivalent to an empty memory set. The
user can retry or explicitly proceed with memory off.

### Recording without changing transcript versions

Use a new execution-journal version 3 for memory-enabled Runs, retaining v1/v2
read support and the existing version-2 Graph rules. Add one `project-context`
record after `run-admitted` and before model/MCP/tool effects. It contains the
exact bounded snapshot, provenance, selection policy revision, counts and digest,
plus the session/Run identity. Require acknowledgement before using the block.
The transcript remains version 1, 2 or 3; memory is not a new transcript entry.

The admission configuration input gains `projectContext` with the snapshot
digest and policy version. Existing `RunSupervisor` records an HMAC digest of
that configuration, not the configuration object itself. Do not mistake the
journal's `configuration` field for a place to append arbitrary nested JSON.
Keep raw configuration, including MCP settings that may carry secrets, out of
snapshot records. Exact snapshot bytes live in the new bounded context record;
its validation and ordering bind the data to this Run before any model call.

New writers opt into journal v3 only for enabled Runs; journal readers validate
old records and the new record's shape/order. Older Orbit releases may refuse
journals containing v3 rather than silently omit context evidence. Support mixed
historical v1/v2 and new v3 Runs and extend Graph, offline inspection, maintenance,
delete and recovery readers consistently. This compatibility cost belongs to the
initial implementation and must be tested before enabling GUI memory.

A run-admitted record without an acknowledged project-context record does not
establish that memory reached a model. Recovery reports interrupted preparation
and never automatically replays the turn. Exact request retries retain existing
recovered-handle semantics; they do not recapture newer memory under the old Run.
A malformed, duplicate, oversized or out-of-order context record blocks further
managed dispatch. The maximum serialized context record is 256 KiB, within the
existing 1 MiB journal-record limit; reject metadata excess before admission.

The journal is the historical snapshot authority; the catalog stores current
entries, not a second mutable copy of Run evidence. Diagnostic export includes
context records when requested. Transcript-only export is explicitly incomplete
for external Run context. Editing or retiring an entry cannot erase an already
acknowledged journal snapshot; session deletion retains its existing journal
cleanup responsibility.

Memory is an additional input to prepared-context assembly, not a canonical
conversation message. Historical memory blocks are not replayed on every future
turn and are not folded into checkpoints merely because they were injected.
The compactor summarizes canonical conversation history; the current Run's
memory block is counted separately in the input budget and reattached once to
each prepared model request. The verified interrupted-context proof still runs
before augmentation. Memory never repairs missing tool results or bypasses it.
Assistant answers may quote memory; such quotes remain ordinary history and
cannot be automatically erased by retiring the source entry.

### Forgetting, movement and deletion

Retiring an entry increments the Project's memory generation and excludes it
from subsequent preparations. Its prior Run snapshots remain historical evidence;
label this operation “stop using” rather than claiming physical erasure.
Automatic re-extraction does not exist in this scope. Any later extraction
feature must honor retirement tombstones and source exclusions.

Moving/unlinking a source session invalidates source-derived entries in its old
Project. It does not move or copy memory into another Project. Explicitly
human-authored entries are unaffected. Recall rechecks recorded sources even
when they were deleted through a CLI that did not load the Project catalog.
When sources are missing, changed or deleting, those entries are ineligible and
the GUI reports why. Generation checks do not replace source checks.

Project-aware session deletion excludes the source before physical deletion and
uses the existing recoverable deletion path to remove its journal snapshots.
After legacy CLI deletion, catalog reconciliation cleans stale membership and
source eligibility; source-derived entries cannot be recalled while their
source is unavailable. SQLite free pages, backups, historical quoted messages and external
provider copies are not guaranteed erased. Secure physical erasure is outside
this decision and must not be claimed by the GUI.

A Project archive prevents new Runs as specified by the catalog ADR; memory
remains inspectable. Viewing another Project does not change the current Run's
snapshot. Scoped APIs validate Project and membership server-side; UI filtering
is not the access check. Project organization does not replace tool policy.

### CLI and public API compatibility

The CLI performs no new memory lookup or write, has no Project requirement and
loads no catalog by default. Existing histories, including assistant statements
influenced by earlier GUI memory, remain resumable. A CLI-created session may be
attached later through the GUI. Existing `SessionContextBuilder.build` continues
building one session; the managed host supplies memory augmentation explicitly.

Provide core `ProjectMemoryService` operations, a deterministic selection helper,
read-only snapshot inspection, and application-service wrappers. Keep storage
behind the catalog adapter and createAgent/model boundaries injectable. GUI adds
an entry list/editor, save-excerpt action, source navigation and a prepared-memory
preview with exclusions. Errors distinguish no entries, unavailable sources,
revision conflict, over-budget selection and recording failure.

## Consequences

- Positive: selected knowledge is reusable and attributable without mixing whole
  conversations; explicit updates have predictable Run boundaries.
- Negative: immutable historical snapshots retain additional sensitive text;
  provenance validation, deletion reconciliation and input-budget integration
  need tests beyond a simple notes editor.
- Neutral: automatic learning and semantic recall quality are not promised. A
  memory edit does not retroactively change history or a dispatched request.

## Context and Problem Statement

At Orbit `abc358ba69a6b9de24d2c7a16a6bd38b28aac00c`, SessionContextBuilder handles
single-session checkpoints; verified-context validates projection evidence;
`freezeModelRequest` fixes the serialized request. Skill records demonstrate
explicit provenance and input selection but are instruction artifacts with
existing transcript validation, not a generic memory store to reuse unchanged.
Journal `run-admitted.configuration` contains a digest of the configuration
object supplied to RunSupervisor; it is not the object itself. All of these
contracts constrain where additional model-visible text may enter.

## Decision Drivers

Project-local reuse; human-editable provenance; bounded exact model input;
no implicit authority promotion; predictable revision timing; no transcript
migration solely for initial memory; explicit journal-version compatibility; existing CLI compatibility; honest
forgetting and historical retention semantics.

## External Implementation Research

Inspected on 2026-09-22; source links and test-reading limits are in the research.

- Codex `fdd89e78ac33f02e65dabe60567cdfeba2e954d4`: `ext/memories/src/prompts.rs`
  builds a bounded summary prompt; phase 1/2 extract and globally consolidate
  previous rollouts. Adopt bounded summary/detail separation. Do not copy global
  scope, developer-role elevation or unattended generation into the initial UI.
- HermesAgent `92dd3321929a915479ade608591d40de93965c7b`:
  `tools/memory_tool_store.py` freezes a load-time prompt snapshot and supports
  locked mutations; `session_search_tool.py` reads actual messages without an LLM.
  Adopt explicit edits and predictable snapshots; choose Run refresh rather than
  an entire-session freeze, and Project scope rather than profile-wide storage.
- OpenClaw `6b13f55aaf7151e3edfb33ddafeac69abb0b38d2`:
  `dreaming-consolidation.ts` validates project-group operations and
  `session-search-visibility.ts` separates recall visibility from memory prose.
  Adopt explicit scope/source validation, not its larger background lifecycle.
- Pi `95fbc04997eaee961eb673fa7923e9220609ebd5`: SessionManager/resource-loader
  show history and reusable context files; harness MemoryStorage is volatile
  storage. Preserve this simpler baseline without claiming that its name proves
  a semantic-memory feature or that all extensions were audited.

## Considered Options

1. **Selected proposal: curated entries and Run snapshots.** Small explicit
   scope with deterministic mechanics and observable selection.
2. **Append memory as ordinary history on every turn.** Simpler insertion but
   duplicates stale notes and conflates evidence with conversational events.
3. **Persist new memory_context transcript entries.** Strong transcript-only
   replay, but adds conversation-format migration as well as reader changes.
   The selected journal record keeps external context with execution evidence.
4. **Automatic extraction plus vector retrieval immediately.** Broader recall
   but adds model evaluation, budgets, scheduling and write-authority decisions
   before basic project ownership is established.
5. **One shared MEMORY.md across all Projects.** Easy to inspect but insufficient
   for explicit scope, revisions and linked source invalidation.

## Implementation and Confirmation

### Author acceptance — 2026-09-22

The author explicitly accepted both linked proposals and authorized implementation,
validation and the book chapter, with incremental commits. Acceptance includes
the Node 20-compatible database candidate and qualification conditions, recoverable
Project/session coordination, curated memory, journal-v3 compatibility work and
unchanged CLI feature scope. Implementation is not started at this acceptance;
completion evidence will follow actual implementation commits. The original
proposal wording below records the design adopted by this decision.

### Implementation evidence

Not started at acceptance; both linked ADRs were accepted together. Implement and verify the complete journal-v3 reader/writer compatibility
matrix and prepared-input binding before enabling memory. Required tests:
no A-to-B leakage; same-cwd Projects; snapshot determinism; whole-entry budgets;
explicit selection overflow; source changed/deleted/moved; stale preparation;
mid-Run edits; exact replay; admission/context-record interruption; missing
snapshot evidence; mixed journal versions; v1/v2/v3 transcripts; compaction without memory duplication;
verified-context refusal; CLI no catalog access; retirement and retained-history
labels; deletion retry; GUI token/origin and source path rejection.

Inspect exact provider requests with deterministic adapters, including tool
iterations. Run full headers/build/test checks sequentially and package validation
with the dependent store. Update maintained concepts/glossary, architecture,
context-compaction, GUI/integration and Projects guides. Do not label memory
quality evaluated from fixed-response tests or mark the book's implementation
section complete before code and relevant UI behavior are verified.

## Follow-up Work

Automatic candidates/consolidation, cross-project/global memory, semantic
retrieval, secure erasure and multi-user authorization are distinct future
choices. User-authored project instructions may be added separately if existing
workspace instructions do not meet a demonstrated need. Initial limits must be
revisited using real workloads without presenting these defaults as optimal.

## References

- [Project catalog ADR](2026-09-22-project-catalog-and-session-membership.md).
- [Research and pinned source links](../research/2026-09-22-projects-and-cross-session-memory.md).
- [Prepared operation authorization](2026-09-07-prepared-operation-authorization.md).
- [Budgeted compaction](2026-09-08-budgeted-session-compaction.md).
- [Verified interrupted context](2026-09-14-verified-interrupted-tool-context.md).
