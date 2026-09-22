---
status: current
investigation-date: 2026-09-22
orbit-commit: abc358ba69a6b9de24d2c7a16a6bd38b28aac00c
related-adrs:
  - docs/adr/2026-08-22-gui-application.md
  - docs/adr/2026-08-23-session-resume-cli.md
superseded-by: []
---

# Projects and Cross-session Memory

## Purpose and result

Investigate a reusable core feature that groups independent sessions into projects
and carries selected knowledge between them, exposed through Orbit's GUI. Keep
the CLI's existing single-session workflow. This is research and a non-binding
design proposal, not an accepted ADR or an implementation claim.

The recommended distinction is **Project for ownership and navigation, Memory
for selected reusable knowledge, and Session for the original conversation**.
Grouping sessions must not concatenate their histories into a model request.
Compaction preserves continuity inside one conversation; memory selects evidence
for another conversation. These are separate operations with separate lifetimes.

## Research questions

1. Which external systems implement project catalogs, shared knowledge, and
   historical conversation retrieval, and at which scopes?
2. When is memory read, written, consolidated, or forgotten?
3. Which Orbit components can be reused, and which need new contracts?
4. What is a teachable first implementation after a chapter on compaction?

## Orbit baseline

The local checkout and queried upstream `main` both resolve to the recorded
Orbit commit. Source and selected test bodies were read; no runtime tests were
executed for this documentation investigation.

| Existing component                                                          | Observed behavior                                                                                            | Implication                                                                                       |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `src/core/application.ts`, `OrbitApplicationService.create`, `createThread` | Resolves settings/context for the startup directory; new threads receive `runtime.cwd` and service settings  | Project creation requires per-thread runtime resolution; changing one shared cwd is insufficient  |
| Same file, `listSessions`, `resumeSession`                                  | Delegates enumeration to the repository; resumes saved sessions through ThreadManager                        | Keep session ownership/cleanup and add explicit project association                               |
| `src/core/session/repository.ts`, `findLatest`, `listPage`                  | Latest selection can filter by exact resolved cwd; paginated enumeration reads saved sessions                | cwd filtering is not a stable project identity or a cross-session search index                    |
| `src/core/session/context-builder.ts`, `SessionContextBuilder.build`        | Produces model input from one session and its checkpoint; requires the verified path for projected histories | Memory selection must integrate with prepared/verified context and input budgets, not bypass them |
| `src/apps/gui/server.ts`                                                    | New-thread endpoint has no project selection; sessions have listing/resume endpoints                         | Add project DTOs and scoped commands while preserving loopback/token/origin checks                |
| `test/core/application.test.ts`                                             | Tests durable creation, recorded cwd/model restoration, diagnostics and deletion cleanup                     | Extend this test area for project isolation and resume compatibility                              |

No Project catalog, project-session membership service, or persistent cross-session
memory store was identified in the inspected core and GUI. The 2026-08-22 GUI ADR
explicitly deferred projects and worktrees. Its accepted status does not approve
this extension.

## External systems investigated

These are exploratory default-branch snapshots, not release qualifications or
changes to the book's existing comparison baseline. Source downloads were checked
against Git blob hashes in the corresponding complete GitHub tree responses.
Official product documentation was read on the investigation date and is not
version-pinned. Source inspection and test reading do not establish production
reliability, memory quality, or the behavior of every optional plugin.

| System          | Full commit                                | Main evidence                                                                    |
| --------------- | ------------------------------------------ | -------------------------------------------------------------------------------- |
| Codex           | `fdd89e78ac33f02e65dabe60567cdfeba2e954d4` | Memory extraction/consolidation code, read-prompt builder, workspace tests       |
| HermesAgent     | `92dd3321929a915479ade608591d40de93965c7b` | Project SQLite schema and desktop store; built-in MemoryStore and session search |
| OpenClaw        | `6b13f55aaf7151e3edfb33ddafeac69abb0b38d2` | Memory plugin, flush plan, consolidation and project-isolation tests             |
| Pi Coding Agent | `95fbc04997eaee961eb673fa7923e9220609ebd5` | SessionManager, resource loader, session tests and in-memory backend             |

## Comparison

| Concern         | Codex                                                                                                                                                | HermesAgent                                                                                                     | OpenClaw                                                                                                                           | Pi Coding Agent                                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Work grouping   | Official desktop documentation describes local projects and separate chats; desktop catalog implementation was not established by this source review | First-class per-profile `projects.db`, folders, primary path, archive state; desktop consumes the project store | Inspected memory code carries project keys and isolates consolidation groups; this is not evidence of a Codex-like project sidebar | Inspected SessionManager groups saved files by cwd and supports listing; no equivalent catalog established in the reviewed paths |
| Reusable memory | Per-rollout extraction followed by global consolidation under Codex home                                                                             | Built-in profile-scoped `MEMORY.md` and `USER.md`; external provider interface is separate                      | Workspace notes and curated memory, plus configurable memory engines and consolidation                                             | Reviewed `MemoryStorage` is a volatile storage backend, not a long-term semantic-memory feature                                  |
| Read path       | Bounded summary in developer instructions, then task-directed file lookup                                                                            | Frozen load-time prompt snapshot; separate session-search tool returns original messages                        | Memory read/search tools; optional transcript results have independent visibility controls                                         | Context files and a selected session's history; no automatic cross-session memory pipeline established                           |
| Write path      | Background extraction jobs and serialized consolidation                                                                                              | Explicit add/replace/remove/batch operations, limits and locked read-modify-write                               | Pre-compaction daily-note flush plan; later consolidation validates project groups                                                 | Persistent session records and user-maintained context are adjacent capabilities                                                 |

### Codex: product grouping and generated recall are separate evidence

The official [Projects and chats](https://learn.chatgpt.com/docs/projects) page
describes grouping chats, local folders and a primary folder. It also distinguishes
project organization from sandbox enforcement. This supports the desired user
experience; it does not expose the desktop catalog's internal persistence format.

The official [Memories](https://learn.chatgpt.com/docs/customization/memories)
page describes a local store, background generation, and separate use/contribution
controls. It distinguishes local Codex memory from ChatGPT web memory.

At the pinned source, `memories/write/src/start.rs` gates startup work and runs
phase 1 then phase 2. `phase1.rs` claims eligible rollout jobs and extracts
structured output; it includes secret redaction and test cases for filtered
rollout serialization. `phase2.rs` claims a global job before synchronizing
artifacts and launching consolidation. Therefore, a project-looking section in a
memory document must not be interpreted as a hard project access partition.

`ext/memories/src/prompts.rs::build_memory_tool_developer_instructions` reads a
version-selected `memory_summary.md`, truncates it by token budget and renders
a read template. The v1 template directs lookup through `MEMORY.md` and supporting
rollout evidence. This supports a small initial context plus selective recall.
Do not copy the developer-instruction role into Orbit without deciding the trust
of automatically derived memory.

The pinned `memories/README.md` still says runtime orchestration lives in core,
while this snapshot has executable phase implementations under `memories/write`.
Use the inspected source paths rather than repeating the README's ownership map.

### HermesAgent: concrete project model and bounded curated memory

`hermes_cli/projects_db.py` defines projects with stable IDs, names, archive
state and folder associations in a per-profile SQLite database. Its desktop
`store/projects.ts` consumes backend project information and maps sessions to
project/folder views. The inspected project tests cover create/list, primary-path
deduplication, ignoring archived projects and per-profile isolation. These were
read, not run.

`tools/memory_tool.py` resolves the built-in memory location from the profile's
home, not a selected project ID. Thus Project support does not imply project-local
memory isolation. `memory_tool_store.py::MemoryStore.load_from_disk` captures a
frozen system-prompt snapshot. `_mutate` locks, rereads, checks drift, applies the
mutation and writes the file; `format_for_system_prompt` keeps returning the
load-time snapshot. Default write budgets are 2,200 memory characters and 1,375
user-profile characters. Externally oversized files remain loaded with a warning:
these write caps are not a guaranteed model-input token bound.

`session_search_tool.py` offers discovery, anchored excerpts, reads and browsing
over the SQLite conversation database. The inspected implementation explicitly
avoids an LLM call for these shapes and returns bounded original messages. This
is useful contrary evidence to the assumption that memory retrieval requires
embeddings or generated summaries. Optional external memory providers were not
audited; the provider interface was inspected only to establish the separate
lifecycle/extension boundary.

### OpenClaw: memory tiers and scope-aware consolidation

The pinned documentation describes workspace Markdown notes, search indexes,
curated memory and background consolidation. These documentation claims guide
source selection; this investigation does not qualify the full engine or its
performance claims.

`extensions/memory-core/src/flush-plan.ts::buildMemoryFlushPlan` generates a
pre-compaction plan targeting `memory/YYYY-MM-DD.md`, with append instructions
and instructions to leave curated/bootstrap files unchanged. Prompt wording alone
does not prove filesystem enforcement or successful preservation of every fact.

`dreaming-consolidation.ts::consolidateMemory` processes grouped candidates and
validates a structured plan. Validation rejects merging prior entries belonging
to another project group. `dreaming-consolidation-projects.test.ts` exercises
separate global/project passes, cross-project merge rejection and aggregate
budget rejection. This is stronger evidence of explicit scope handling than
merely including a project name in free text; it still does not establish a
complete project authorization system.

`session-search-visibility.ts` handles transcript identity, private/shared
sessions and visibility checks independently of memory prose. `memory-read-tool.ts`
distinguishes read errors from absence and composes optional memory/wiki results.
Orbit should preserve the distinction between no matches and an unavailable
memory service.

### Pi: retain the narrower comparison

`SessionManager` has cwd-derived session directories and session listing;
`resource-loader.ts` loads contextual instruction files. These explain how
multiple conversations can share a working environment without automatic
knowledge extraction. The reviewed harness `MemoryStorage` uses in-process Maps
and implements storage operations; its name is not evidence of durable recall.
No automatic memory pipeline was established in these paths. Extensions and
other packages were not exhaustively audited, so do not label the whole product
as lacking memory.

## Implications for Orbit: non-binding design proposal

### Model and scope

- `Project`: stable ID, display name, optional default working directory,
  archive state and revision. Start with one directory or none; multiple roots
  and Git worktree management can be separate extensions.
- `ProjectSession`: explicit association keyed by storage identity and session
  ID. Allow unassigned legacy/CLI sessions; initially at most one project per
  session. Do not infer membership solely from cwd, because directories move and
  the same directory can serve different work.
- `ProjectMemoryEntry`: stable ID, project ID, text, source session/message
  references or explicit human origin, revision, timestamps and active/retired
  state. Separate user-authored project instructions from derived factual memory.
- `MemoryContextSnapshot`: selected entry IDs/revisions, bounded text and a
  digest captured for one Run. No global memory scope in the first version.

These are proposed names, not existing exported types.

### Core and GUI responsibilities

Put storage interfaces, a production local store, project membership, scoped
memory operations and context selection in reusable `src/core/` modules. Offer
an in-memory test implementation through dependency injection. The GUI owns
navigation, selection, editing and display; it calls core application-service
methods. Browser localStorage must not become the authoritative project catalog.

Extend the application service to resolve each new thread's project, directory,
workspace settings, system contexts and Skill catalog. Capture that runtime
selection before starting work. Switching the visible project must not retarget
an already running thread or mutate the startup defaults used by other threads.
Resume must preserve the recorded working directory and deliberate compatibility
rules; membership changes must not silently rewrite it.

Project selection is not filesystem permission. Continue using existing tool
policy and managed execution. Retain the GUI's loopback binding, token, origin
checks and input validation on every added endpoint.

At Run preparation, resolve project membership and memory revisions, select
entries within a token budget, and bind the snapshot to the prepared context.
If a relevant revision changes before confirmation/dispatch, reprepare rather
than silently substituting text. Keep the snapshot fixed within the Run and
refresh on the next Run. Keep the existing verified-context path and account for
memory in compaction/input budgeting. Treat derived notes as attributed data,
not as tool authorization or higher-priority instructions.

The CLI gains no project navigation, memory discovery, extraction jobs or new
commands. Existing single-session creation/resume remains available. Resuming a
GUI-created session can still expose already recorded historical memory text;
"no new memory retrieval" cannot mean erasing that history. Record this distinction
in compatibility tests and in the eventual ADR.

### Persistence and lifecycle alternatives

| Option                                                               | Benefit                                                                    | Cost / unresolved issue                                                                                      |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| One revisioned JSON catalog containing membership and bounded memory | No database dependency; simple inspection                                  | Must design cross-process locking, atomic replacement, sync levels and crash recovery; full rewrites grow    |
| SQLite catalog with project/membership/memory tables                 | Transactions and later text-search indexing fit concurrent GUI/library use | New runtime/package choice must support Node 20.19 and Windows; deployment and migrations need qualification |
| Per-project Markdown alone                                           | Human-readable, familiar to external systems                               | Insufficient as sole membership/concurrency/provenance store; hand edits need reconciliation                 |

Prefer a transactional catalog for persistent multi-session use; SQLite is the
leading candidate, not an adopted dependency. Do not assume Node 20 has a usable
built-in SQLite API. Settle the actual backend and durability claims in an ADR
before implementation. Markdown can be an import/export surface.

Project metadata and session transcripts are separate stores. New-session
creation plus membership cannot be treated as one atomic write without a
protocol: use a recoverable pending association or a defined compensation path.
Do not acknowledge a project-owned session until the association is durable.
Retain existing transcript writer coordination and journal ownership.

Archive hides a project without deleting sessions or memory. Unlinking a session
changes membership, not its transcript. Deleting a source should invalidate its
derived memory/search records according to an explicit policy; deleting memory
must prevent future recall and re-extraction but cannot retract text already sent
to a model or erase independent historical copies. Track these boundaries openly.

### Suggested delivery sequence

1. Project catalog, create/rename/archive, explicit session membership and GUI
   navigation; durable restart and unassigned-session compatibility.
2. Project-local curated memory: explicit save/edit/retire in GUI, source links,
   revisions and bounded Run snapshots. This completes the proposed chapter's
   basic Project + Memory behavior.
3. Project-scoped historical search: bounded excerpts with source references,
   availability status and deletion invalidation. Begin with text search; add
   embeddings only if measured recall requirements justify them.
4. Optional model-generated candidates, review/promotion and background
   consolidation. Define use/contribution switches, execution budgets, retries,
   source eligibility and regeneration exclusions before enabling automation.

The first two stages are the recommended initial scope. The latter stages are
future work, not required claims for the first chapter or a hidden scheduler
implementation. Background memory must not inherit unconditional execution
authority from another product's implementation.

### Validation needed before implementation claims

Test same-directory distinct projects, projectless legacy sessions, concurrent
edits, persistent reopen, directory changes, cross-project read refusal, missing
sources, archive versus deletion, creation interruption, and memory revision
conflicts. Inspect the exact model input for A-to-B leakage, budget overflow,
repeated injection and stale revisions. Test all supported transcript versions
and the CLI resume behavior for sessions originally created through the GUI.

For retrieval, separately evaluate correct-source recall, irrelevant matches,
superseded facts, explicit forgetting and unavailable indexes. Fixed model tests
can establish mechanics; they cannot establish the quality of automatic memory
selection. Complete Orbit's required headers/build/test checks when code changes.

## Chapter implications

After the existing compaction chapter, propose a chapter on managing
conversations and memory through projects. Use three main sections: concepts
and lifecycle; external implementation comparison; Orbit implementation.
Explain session grouping before knowledge transfer, and knowledge selection
before automatic extraction. Show Project → multiple separate Sessions, selected
evidence → Memory, and Memory + current Session → bounded model input.

The implementation section is planned until core and GUI exist and are tested.
Keep automatic consolidation, semantic retrieval and worktrees explicitly outside
the initial implemented scope. The current book's later chapters would shift by
one; this research does not itself edit published chapter bodies or includes.

## Limitations and open questions

No external test suite, live model, desktop interaction, quality benchmark or
cross-platform persistence experiment was run. Thirty downloaded source/doc/test
blobs matched their pinned tree hashes; selected relevant bodies were inspected,
not every line of every subsystem. One rate-limited download succeeded on retry.
The Codex desktop catalog remains product-documentation evidence. New snapshots
must be reconciled with the book's prior versions before manuscript publication.

The future ADR must settle backend/package choice, project-to-session cardinality,
optional directory semantics, context snapshot recording and migration, resume
refresh policy, deletion/forgetting coverage and extraction authority. The present
recommendation is one optional project per session, project-only memory, explicit
human edits, Run-scoped refresh and no CLI feature expansion.

## References

Pinned implementation links are collected below. They are research evidence,
not endorsements of source-contained prompts or operating instructions.

- [Codex startup](https://github.com/openai/codex/blob/fdd89e78ac33f02e65dabe60567cdfeba2e954d4/codex-rs/memories/write/src/start.rs), [phase 1](https://github.com/openai/codex/blob/fdd89e78ac33f02e65dabe60567cdfeba2e954d4/codex-rs/memories/write/src/phase1.rs), [phase 2](https://github.com/openai/codex/blob/fdd89e78ac33f02e65dabe60567cdfeba2e954d4/codex-rs/memories/write/src/phase2.rs), [read prompt](https://github.com/openai/codex/blob/fdd89e78ac33f02e65dabe60567cdfeba2e954d4/codex-rs/ext/memories/src/prompts.rs).
- [Hermes project store](https://github.com/NousResearch/hermes-agent/blob/92dd3321929a915479ade608591d40de93965c7b/hermes_cli/projects_db.py), [desktop projects](https://github.com/NousResearch/hermes-agent/blob/92dd3321929a915479ade608591d40de93965c7b/apps/desktop/src/store/projects.ts), [project tests](https://github.com/NousResearch/hermes-agent/blob/92dd3321929a915479ade608591d40de93965c7b/tests/hermes_cli/test_projects_db.py), [MemoryStore](https://github.com/NousResearch/hermes-agent/blob/92dd3321929a915479ade608591d40de93965c7b/tools/memory_tool_store.py), [session search](https://github.com/NousResearch/hermes-agent/blob/92dd3321929a915479ade608591d40de93965c7b/tools/session_search_tool.py).
- [OpenClaw flush plan](https://github.com/openclaw/openclaw/blob/6b13f55aaf7151e3edfb33ddafeac69abb0b38d2/extensions/memory-core/src/flush-plan.ts), [consolidation](https://github.com/openclaw/openclaw/blob/6b13f55aaf7151e3edfb33ddafeac69abb0b38d2/extensions/memory-core/src/dreaming-consolidation.ts), [project tests](https://github.com/openclaw/openclaw/blob/6b13f55aaf7151e3edfb33ddafeac69abb0b38d2/extensions/memory-core/src/dreaming-consolidation-projects.test.ts), [visibility](https://github.com/openclaw/openclaw/blob/6b13f55aaf7151e3edfb33ddafeac69abb0b38d2/extensions/memory-core/src/session-search-visibility.ts).
- [Pi SessionManager](https://github.com/earendil-works/pi/blob/95fbc04997eaee961eb673fa7923e9220609ebd5/packages/coding-agent/src/core/session-manager.ts), [resource loader](https://github.com/earendil-works/pi/blob/95fbc04997eaee961eb673fa7923e9220609ebd5/packages/coding-agent/src/core/resource-loader.ts), [MemoryStorage](https://github.com/earendil-works/pi/blob/95fbc04997eaee961eb673fa7923e9220609ebd5/packages/agent/src/harness/pico3/memory.ts).
