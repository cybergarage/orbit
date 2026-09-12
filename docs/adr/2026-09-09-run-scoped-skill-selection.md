---
status: accepted
proposed-date: 2026-09-09
decision-date: 2026-09-12
implementation-status: partial
implementation-completed-date: null
implementation-commits:
  - a77919e501a118418b31be445983d47f34b2d568
  - 09b93b01152c5635beb58cb05552effe7561f617
superseded-by: []
---

# Run-scoped Skill Selection

## Purpose

Let a user choose a reusable code-investigation or test-review instruction from
a visible catalog, apply exactly the selected version to one coding Run, and
inspect that choice after Session restart. Avoid silent same-name replacement,
standing prompt accumulation and treating instructional text as tool permission.

## Decision

**Accepted on 2026-09-12 by the author; implementation partial.** Introduce a bounded, source-identified
Skill catalog and explicit selections on managed Agent/Service Runs. Preserve
the existing single-file Skill API. Core owns reading, validation, per-Run input
and durable snapshots; the application chooses catalog roots and the user's
selection. Current exports and migration instructions are documented in
[Skills](../skills.md); the dated acceptance and review remain historical evidence.

### Author acceptance — 2026-09-12

The author explicitly accepts the recommendation including the 2026-09-12 review
in `7f7f3beb075a83887e6d29f024ea97bb98b6f555`. This is a direct decision on Skill
selection, not reuse of the earlier compaction delegation. The accepted costs are:

- Explicit roots and source IDs, bounded full-file listing, a strict parser with
  a maintained dependency, and preservation of the permissive legacy Skill API.
- One-Run application, exact source snapshots and compatible reader deployment,
  including complete unknown-record refusal and the existing torn-tail exception.
- Root rebinding and detected-replacement relisting, ordered replay identity at
  every entry point, dedicated-summary exclusion, BOM/body/order validation,
  pending-I/O ownership and the specified UI selection lifecycle.
- A revision-1 encoded-record ceiling of 4 MiB, distinct from product limits;
  lowering product limits does not invalidate previously valid stored records.

The bounds are initial, unmeasured values to validate in implementation trials,
not optimal settings. At acceptance, local HEAD is the review commit above, the
working tree is clean, and source/test/dependency content is unchanged from the
proposal. Public main is `7b4903fb88db5ed53cac7ef5986c75e22a626897`; its difference
from local HEAD consists only of the four reviewed documents. No new material
contradiction was found against the reviewed Run, budget and storage conditions.

This decision adds Skill selection to the existing architecture without
superseding or re-accepting any of the six accepted / partial execution, storage
and compaction decisions. Their reasons and implementation evidence remain
unchanged. The `.v1-backup` deletion authorization is still pending and is
explicitly excluded from this acceptance. Windows, representative application,
operational and physical-fault trials retain the author's existing deferrals.
Bounded managed Everything support remains verified; broad support is not implied.

Only the adoption record is authorized in this step. Implementation status is
not-started, completion date is null, and implementation commits are empty. No
runtime, dependency, test, manuscript, figure or completed example is produced.
The original investigation and dated review below are historical evidence; their
proposed/not-started statements describe their own point in time.

### Catalog, roots and identity

`SkillCatalog` accepts explicit `{id, directory}` roots and a limits profile.
Require unique root IDs, canonicalize all configured roots before exposing candidates, and report aliases to
the same real root as a configuration conflict. The library searches no implicit
home, ancestor or plugin locations. CLI/GUI may default to `.orbit/skills` under
the nearest marked workspace and show that root; additional roots are explicit
configuration, not hidden priority. Absence yields an empty catalog with a
source diagnostic. No root means no active Skill feature.

Discover only immediate child directories containing `SKILL.md`. Do not recurse
arbitrarily, follow candidate-directory/file symlinks, or auto-read scripts and
linked resources. Stream enumeration with bounded entries and bytes; sort the
bounded results for reproducible display. Initial product ceilings are 8
roots, 4,096 inspected directory entries, 128 candidates, 64 KiB per file,
2 MiB total bytes read per listing and 4 selected skills per Run. Validate
positive finite integers and report which limit stopped listing. Return
`complete: false` with issues on incomplete discovery; exact listed IDs remain
selectable because no name resolution depends on a supposedly complete list.
These are initial product bounds to measure, not optimal settings.
Counts and byte ceilings apply to the entire listing, including invalid candidates,
failed reads and overflow probes; bound each read before allocation. Sort returned
entries, but do not promise the same partial subset across filesystem enumeration
orders. Missing roots are diagnostics; invalid root IDs or canonical-root conflicts
reject the configuration as a whole before returning selectable candidates.

Each candidate has a stable opaque ID derived from its configured root ID and
canonical root path and relative file path (a versioned, unambiguous tuple, not inode alone), display name, description, source/root,
base directory, SHA-256 content digest and byte count. ID is not an authority
token and the client cannot supply a replacement path. Same-name candidates
remain visible with source labels; select by ID plus expected digest. Do not
silently choose a first, deepest or global winner. Duplicate selection IDs fail.

Listing reads bounded full files to compute metadata and digest but retains no
body in the catalog/model input. Activation reopens only selected files,
validates regular-file/single-link/canonical identity before and after reading,
checks the byte limit and digest, and freezes the resulting snapshot. Changes,
missing files or conflicts require a refreshed list and explicit reselection.
Do not silently load the latest changed body. Recheck while loading within the
owning Run; cached listings are not evidence that selected bytes still match.
Canonical-root identity and candidate observations are retained as private catalog
validation data, distinct from the stable public ID. Compare the current root,
directory and opened file with those observations and recheck after the bounded
read. A detected replacement, even with identical bytes, requires relisting.
Rebinding a root ID to another canonical directory changes candidate IDs and the
catalog configuration fingerprint. Labels and IDs are not signed provenance;
ordinary path checks cannot defend against every hostile ancestor race.
After resolution, use the frozen bytes even if the source later changes; never
re-read a selected body in later iterations of the same Run.

### Metadata and legacy behavior

Use a maintained YAML parser for catalog frontmatter, with duplicate-key,
alias/custom-tag and unexpected-shape rejection. Pin/install the dependency
through npm only after acceptance and verify its actual options in tests.
Require `name` and `description` string fields: name is 1–64 lowercase ASCII
letters/digits/hyphens, no leading/trailing or consecutive hyphen, and matches
the containing skill directory; description is nonempty and at most 1,024
characters. Allow quoted and block scalar strings, CRLF and an initial UTF-8
BOM. Require valid UTF-8, closed frontmatter and nonempty instructions. Reject
unknown metadata keys in this initial catalog format, with actionable issues.
Validate the parsed syntax tree before object expansion: one mapping with exactly
the two allowed scalar keys, no duplicate keys, aliases, anchors, explicit tags,
merge keys or additional YAML documents. Reject parser warnings as well as errors.
Measure description length in Unicode code points; render control characters as
escaped data in terminals and text in the GUI, never as terminal/HTML markup.
Hash original bytes before parsing. Decode UTF-8 fatally without discarding a BOM,
and retain BOM and CRLF in the stored source; remove at most the initial BOM only
in the parser view. Define body derivation as the text after the closing delimiter
with outer whitespace trimmed, under a named immutable projection revision.
Do not claim full Agent Skills specification compatibility or infer a tool
grant from unsupported metadata.

`new Skill({content|file})` retains its existing permissive behavior for legacy
callers; its instances are not automatically valid catalog selections. The
strict catalog parser is a separate path. The migration guide explains how to
fix duplicate keys, unsupported metadata, names and paths rather than changing
legacy parsing underneath existing applications.

### One Run of application, budget and permission

Expose selections on `Agent.startRun` and `OrbitApplicationService.startRun` as
IDs plus expected digests. Keep existing Service calls with a request-ID string valid through an overload or
an additive options entry point; do not silently reinterpret a string as options.
Snapshot configured catalog/profile identity at admission. Include the ordered
selection IDs/expected digests and immutable catalog/parser/limits revision in
submitted input, not only in the separate configuration digest. Apply this
comparison in ThreadManager before its cached-handle return, in the supervisor's
in-memory comparison, and in persisted request-digest recovery. Same request and
same ordered selections return the original Run without rereading files; changed
selection order/content under the same request ID is a conflict. A retry after a
failed admitted Run requires a new request ID and explicit selection. A recovered
Run is observed, never silently executed again.
Resolve selected content under the same Run cancellation/resource tracking,
then save and synchronize the snapshot before the first model call. A read,
validation or required-recording failure stops preparation; it never runs with
silently omitted selections. Loading is configuration-data reading explicitly
authorized by the selected catalog; it does not execute an instruction.
Use asynchronous bounded I/O, track open/read/close and transcript synchronization
in the owning Run, and check cancellation before and after awaits. A deadline may
finish the caller while I/O is still pending; retain ownership/quarantine until it
settles and close every descriptor, including late opens. A byte limit does not
make synchronous filesystem work cancellable. Read-only catalog queries use their
own request cancellation/cleanup scope and never acquire a writable Session lease.

Build a per-Run user-level instruction prefix after standing workspace/system
instructions and before the selected conversation. Label each block with its
source, base directory and one-Run scope. Escape structured labels separately
from body text. Do not mutate Agent's standing `messages` array or permanently
append the body as a user conversation message. Include the full active body
and wrapper in the accepted frozen-request budget. Protect them for every model
ordinary answering/tool iteration of this Run; refuse if the protected input cannot
fit. With budgeting disabled, inject the same prefix but promise no token-fit
check or automatic compaction. Keep the existing no-policy compatibility mode.
The separate summarization call receives only its dedicated summary instruction
and eligible historical conversation, without tools or the active Skill prefix.
It still consumes the owning Run's model-call allowance. Preserve the frozen
active prefix outside the summary and reattach it to the prepared answering
request after compaction. This clarifies "every iteration"; it does not change the
accepted tool-free summarization contract or send Skill instructions to the
summarizer.

At the next Run, active selections are empty unless explicitly supplied again.
Resuming a Session does not re-read or automatically reactivate an old body.
Past model answers can still contain influenced text; no semantic forgetting
guarantee is made. Skills do not override trusted workspace instructions,
change model/profile, expand allowed roots or skip execution confirmation.
Relative resource references use the recorded Skill directory, but actual
reads/commands still require ordinary registered tools and permission. No
automatic include expansion, dependency installation or script execution.

### Historical snapshot and compatibility

Add a versioned `skill_context` record to transcript v2, keyed by Session ID and
Run/turn ID, with an ordered array of selected ID, name, source, base directory,
content digest, exact UTF-8 source snapshot (including frontmatter), derived
body and parser/projection revision. Validate the digest against that complete
source snapshot, not against the body alone. Record once
per admitted Run before model use; validate duplicates, identity, digest and
ordering against the associated turn. Recompute the derived body and metadata from
the exact stored source under its recorded parser/projection revision; reject an
inconsistent body even if the source digest is valid. Reject unsupported revisions
rather than reinterpret history with a newer parser. Bound snapshot count and
bytes on both append and decode; JSON escaping and stored derived bodies can
exceed the source-byte total. Use a fixed 4 MiB UTF-8 encoded skill_context
line ceiling for record revision 1, checked before JSON parsing and before append.
This is an unmeasured format bound, not a whole-Session memory guarantee. Readers
validate historical records under their recorded format revision, not a newly
lowered listing/selection product profile. Future format-ceiling changes require
explicit reader compatibility; they do not silently invalidate old snapshots.

After admission, append turn context, started event and input messages as today;
resolve all selections, append one complete skill_context, synchronize the
transcript, then acknowledge readiness in the journal before any model call
(including a compaction summary). Extend existing run-admitted data with requested
IDs/digests and run-ready data with the resolved snapshot reference and ordered
IDs/digests, preserving the existing tool catalog and journal kind semantics.
A failed resolution records no partial selection set and never becomes active.
Journal readiness failure after transcript sync leaves inspectable resolved bytes
but no permission to call the model. These two stores are not an atomic transaction.
Recovery checks the evidence and does not infer activation from snapshot presence.

Require matching Session/turn identity, an earlier unique turn context and started
event, and a snapshot before any assistant/tool message or terminal event of that
turn. The first user input may precede it. A missing terminal event after a crash
is incomplete execution evidence, not invalid snapshot content. Invalid complete
records refuse reopen without rewriting them; only a malformed final JSON line
without its newline uses existing torn-tail recovery. No recovered snapshot is
resumed as active input. Empty selections need no record. A
snapshot describes the resolved instruction bytes, not successful execution
or proof that the model followed them. Required journal records refer to IDs
and digests; optional diagnostics omit bodies by default.

Readers must not project historical records as current instructions. Keep them
inspectable in raw Session history and preserve them across compaction. The
accepted compaction digest remains the digest of canonical original message
representations; a Skill snapshot is separately validated, not assigned a
fabricated source Message ID. The active Run's selected prefix remains intact
while older conversation is summarized. If summarizing historical selection
context is later needed, that extension needs evidence; initial compaction does
not turn expired bodies into newly active instructions.

Persistent Skill selection requires transcript v2. Reuse the accepted exclusive
v1 migration; do not silently upgrade. Older v2 readers reject the new record
type, rather than silently discard a field and rewrite incomplete evidence.
Deploy compatible readers/writers together and stop older binaries and their
restart sources before enabling selections. A complete unknown skill_context record is rejected by the current v2 decoder;
a malformed final line can still be removed by its existing torn-tail recovery.
That limitation is why coordinated deployment remains mandatory; refusal is not
a universal version-negotiation or downgrade barrier. Files without selections
remain readable under their previous contract. Existing Session deletion removes the
snapshot with its transcript and retains the minimal deletion record. The
separate outstanding `.v1-backup` deletion policy is not resolved by this ADR.

### CLI, Ink, GUI and library

Expose a read-only `skills` list with JSON output and source diagnostics.
`exec --skill ID@DIGEST` (repeatable) passes explicit selections; plain mentions
of a Skill name in text do not activate it. Ink offers a catalog list and a
pending next-Run selection/clear operation. Consume the pending selection on
successful managed admission, not merely creation of a ThreadRunHandle; retain it
when admission is rejected. Local slash commands do not consume a pending
selection. If loading fails after admission, show the failed Run and require an
explicit retry; do not silently carry selections into the next prompt. Show loading
or resolution failure distinctly from active use.

GUI lists server-configured candidates with source and digest, submits only
IDs/digests, and displays pending/current/finished selections. Keep the existing
loopback capability/origin controls; clients cannot provide arbitrary file
paths or new roots. Transport reconnection reads the Run snapshot and must not
re-submit a selection as another Run. Library callers can use the same catalog
and structured Run options without a terminal. Historical inspection shows what
was selected and the Run outcome separately. Keep ordinary Run snapshots and
reconnect events metadata-only (requested/resolved state, IDs and digests).
Provide exact source only through an explicit Session-history detail request under
the existing access controls; do not stream every full body in every GUI event.

## Consequences

- Positive: the coding application has one selection, budget and recording contract across all surfaces.
- Positive: same-name and changed-content cases are explicit; prior instructions do not silently become standing rules.
- Negative: bounded discovery still reads full files and activation reads selected files again.
- Negative: a YAML dependency and strict catalog subset add maintenance and migration work.
- Negative: exact snapshots retain potentially sensitive instructions, and older v2 readers reject the new record type.
- Neutral: automatic model selection, persistence across Runs, marketplace/package installation and agent rosters remain outside this decision.

## Context and Problem Statement

At `37c976daa5ea139ce48c2872ef9269f16312946c`, source search finds Skill only in
its class and exports. The existing parser takes the last repeated field and
does not decode a block scalar. The existing 24 Skill/context/workspace tests
pass; they verify no catalog or selected-content execution.

Input budgeting is now implemented under the separately accepted
[compaction ADR](2026-09-08-budgeted-session-compaction.md). A catalog can reuse
that mechanism instead of independently deleting history. Existing
`turn_context` decoding constructs only known fields; merely adding unknown
metadata there would not preserve snapshots through older recovery rewrites.
See the [research](../research/2026-09-09-explicit-skill-selection.md) for the
source baseline, reproduction and alternatives.

## Decision Drivers

- The book's coding agent needs discoverable investigation/test-review procedures.
- The user must know which source and version was selected.
- Active instruction lifetime must agree with budgeting, Run ownership and Session reopen.
- Instruction selection cannot confer tool authority.
- Cross-surface behavior and durable evidence should not be reimplemented by each application.

## External Implementation Research

Codex `5adb68a49933ae446bf11935662c83dba55a0804`: inspected
`codex-rs/skills/src/model.rs`, `codex-rs/ext/skills/src/render.rs` and
`codex-rs/core/src/skills.rs`. Metadata, source scope and invocation evidence
are separate. The rendering budget can shorten or omit catalog entries.
Adopt separation and explicit evidence; do not require its implicit invocation
or model-visible catalog in Orbit's human-selected first scope.

Pi `b79e4cc834970cca69daebffab7df1da7d1e52c4`: inspected
`packages/coding-agent/src/core/skills.ts`. Discovery and prompt metadata are
separate from model use, but discovery reads whole files. Adopt that honest I/O
boundary; initially reject invalid entries and avoid recursive symlink search.
Neither system was run and neither establishes the proposed Orbit replay rules.
Primary source links and limits are in the research note.

## Considered Options

| Option                                                    | Assessment                                                                                                |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Application-only string injection                         | Smaller core scope, but duplicates expiry/recording and cannot meet shared behavior.                      |
| Automatic model selection with a permanent catalog prompt | Broader capability, deferred because the current example needs explicit user selection.                   |
| Source-identified catalog and one-Run snapshot            | Recommended cohesive initial scope.                                                                       |
| ID-only history                                           | Fewer retained bytes, but loses the exact selected content after file changes.                            |
| Ordinary user message or unknown turn-context fields      | Reuses schema superficially but risks stale activation or dropped evidence.                               |
| Distinct v2 record with older-reader refusal              | Recommended explicit compatibility cost; a new v3 header is an alternative with a wider migration burden. |
| Strict line-only metadata without a dependency            | Less dependency work, but cannot interpret common block scalars without a growing custom parser.          |

## Implementation and Confirmation

The following confirmation matrix was defined before implementation. Its
requirements remain in force; current evidence and deferred conditions follow
the table. Baseline tests alone are not substitutes.

| Area             | Required confirmation                                                                                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalog          | Empty/missing/read-denied roots, alias conflicts, same-name candidates, ordering, byte/count limits and partial-list diagnostics; no recursive escape or symlink/hardlink acceptance.                      |
| Parser           | Quotes, block scalars, CRLF/BOM, duplicate keys, aliases/tags, invalid UTF-8, invalid names, missing descriptions/bodies and unsupported fields; legacy Skill tests unchanged.                             |
| Selection        | One of two skills is selected; ID/digest mismatch, deletion, rename, changed content/identity and duplicate selection refuse before model use. Refresh requires new user selection.                        |
| Execution        | All active bodies appear once in every iteration's frozen request; request identity includes selections; no automatic activation from model/tool text; managed permission still rejects forbidden actions. |
| Budget           | Active-body overflow stops without trimming; summary keeps active prefix; expired bodies are not automatically included on the next Run or after reopen.                                                   |
| Recording        | Snapshot synced before model use; append/sync interruption, invalid complete record, torn tail, bad digest, duplicate Run record and old-v2-reader refusal; no dropped optional-field workaround.          |
| Surfaces         | CLI/Ink/GUI/library selection and clear, failed admission versus failed loading, reconnect without duplicate Run, read-only listing and sanitized diagnostics.                                             |
| Unix and example | Headers/build/full tests on macOS/Linux; isolated investigation/test-review Skill example. Exact process/fault evidence, not timeout-only success.                                                         |
| Quality          | Actual coding behavior, semantic preservation and tuned limits remain separate from deterministic mechanics and follow the author's deferred-trial conditions.                                             |

Keep the five older execution/storage ADRs and the compaction ADR at their
recorded implementation status until their own open conditions are resolved.
Record implementation commit hashes and evidence in a later documentation
commit, never pre-fill them in this proposal.

### Implementation evidence — 2026-09-12

Implementation commits: `a77919e501a118418b31be445983d47f34b2d568`
and `09b93b01152c5635beb58cb05552effe7561f617`.
This evidence is recorded in a subsequent documentation commit. The acceptance
baseline was `dee5e7aee3bca09ced563c54bca374c41d901010`; it contained no later
source changes before this implementation. Public main remained
`7b4903fb88db5ed53cac7ef5986c75e22a626897` when checked. No new architectural
decision was needed. The six previous accepted / partial ADRs and the legacy
`Skill` source and seven tests are unchanged from the acceptance baseline.

| Confirmation area          | Implemented behavior and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalog and parser         | `src/core/skills/catalog.ts` and `parser.ts` implement explicit roots, source IDs, bounded asynchronous reading, private identity observations and strict YAML AST validation. `yaml` is pinned to 2.9.1 through npm and the lockfile. `test/core/skill-selection.test.ts` covers aliases, same-name sources, root rebinding/replacement, invalid metadata/UTF-8, BOM/CRLF, denied reads and product boundaries. Failed reads remain charged against the listing byte allowance because their actual completed bytes are uncertain. Missing roots make the listing incomplete, and file-versus-listing byte diagnostics identify the stopping limit. |
| Selection and ownership    | Agent, ThreadManager, RunSupervisor and ApplicationService compare ordered selections and catalog configuration before returning prior handles. The core/execution Skill tests cover changed order, exact replay without rereading, delayed open/read/close, failed-close retry, cancellation and retained Run ownership. Cancellation racing with snapshot synchronization retains the pending synchronization and releases ownership only after late settlement; an actual persistence rejection remains a recording failure. A Run uses an independent reader copied from the catalog; an unrelated listing is not part of its cleanup.           |
| Input and budget           | Ordinary model iterations receive the frozen one-Run prefix with budgeting enabled or disabled. Protected-input overflow refuses model use. The dedicated summary receives neither active Skill instructions nor tools. Tests verify no automatic selection on a subsequent Run or reopen, and unchanged managed tool authorization.                                                                                                                                                                                                                                                                                                                 |
| Snapshot and readiness     | `skills/record.ts`, Session/codec and the journal validate exact source bytes, derived body/metadata, revision, identity and record order. Snapshot synchronization precedes journal readiness and model use. Tests inject transcript and journal failure and check the fixed four-snapshot and 4 MiB revision-1 format ceilings separately from lowered product limits.                                                                                                                                                                                                                                                                             |
| Crash and old reader       | `test/core/execution/skill-interruption.test.ts` runs `fixtures/skill-save-interruption.mjs` at discovered append/fsync boundaries, requiring exact child exit and reopened content rather than a timeout. A direct macOS run passed 27 interruption/failure cases. The preserved pre-Skill v2 decoder fixture is taken from `dee5e7aee3bca09ced563c54bca374c41d901010`, with only imports/provenance adjusted. It distinguishes complete unknown-record refusal from malformed final-line recovery.                                                                                                                                                 |
| Surfaces and compatibility | Compiled CLI tests cover JSON listing and explicit selection with a fixed model. Service/GUI tests cover pending/resolved state, admission versus loading failure, replay/reopen and authenticated, explicit full-source history. Ink tests cover selection, clear and consumption. Public API and offline reader rollout are documented in `docs/skills.md`, architecture, concepts and the maintained surface/Session documentation.                                                                                                                                                                                                               |

The first implementation commit added **41 passing Skill tests** to the previous
**474**, including the seven unchanged legacy Skill tests. Validation of that
commit succeeded in each environment below. The Linux runs used isolated source
archives and fresh dependency installation, with native esbuild rebuilt inside
each container; they used no personal configuration or Session data.

| Environment               | Commands                                             | Result                                   |
| ------------------------- | ---------------------------------------------------- | ---------------------------------------- |
| macOS arm64, Node 26.5.0  | `npm run headers:check`, `npm run build`, `npm test` | All commands exited 0; 515 tests passed. |
| Linux arm64, Node 20.19.0 | `npm run headers:check`, `npm run build`, `npm test` | All commands exited 0; 515 tests passed. |
| Linux arm64, Node 22.23.2 | `npm run headers:check`, `npm run build`, `npm test` | All commands exited 0; 515 tests passed. |

Lint reported 0 errors and 29 warnings (the acceptance baseline had 19 warnings).
`npm run prepack` and the explicit interactive documentation generation succeeded;
`git diff --check` passed. These results establish deterministic behavior and
regression coverage, not quality with a real model.

The follow-up implementation commit
`09b93b01152c5635beb58cb05552effe7561f617` closed four conformance gaps found
during post-commit review: a missing-only root now makes discovery incomplete,
byte-limit diagnostics identify the stopped ceiling, revision 1 enforces its
own four-snapshot bound independently of a lowered product selection limit, and
cancellation racing with transcript synchronization keeps that I/O owned until
late settlement. On macOS arm64 with Node 26.5.0, the focused six-test regression
selection and the final `npm run headers:check`, `npm run build`, `npm test` set
all exited 0; the full result was **517 passing tests** (**43 Skill tests** plus
the unchanged 474-test baseline). Lint reported 0 errors and 30 warnings. This
follow-up was not rerun in the deferred environments, so the Linux rows above
remain evidence for the first implementation commit only.

Additional macOS live-surface checks used disposable roots and fixed models:

- Whole Ink application: list and select a Skill, submit two Runs, then exit.
  Observed selected flags `[true, false]` and exactly one saved snapshot; exit 0.
  The probe exposed a misleading no-selection notice, corrected locally and
  covered by the final rebuilt code and selection-state tests.
- Actual GUI browser: select and run, clear selection and run again, explicitly
  inspect the full saved source, reload and reopen. The two model responses
  showed selected=true then false; reload did not submit another Run.
- `test/apps/gui/fixtures/transport-faults.mjs --skills`: approve one isolated
  write while injecting SSE disconnect, delayed stale HTTP, HTTP 503 and
  duplicate/reordered events. The GUI reached completed/acknowledged. The fixture
  exited 0 with `calls: 2`, `selectedCalls: [true, true]`, all three fault flags
  true, and the single intended file content `once despite transport faults`.

Initial 128-candidate, 64 KiB-file and four-selection boundaries, overflow and
failed-read accounting were tested. This measures enforcement, not optimal sizing,
latency under production load or model adherence. No manuscript, figure or completed
coding application was produced. No backup was deleted.

## Follow-up Work

Implementation remains **partial**, with no completion date. Windows and other
non-tested environments remain author-deferred: resume with an isolated supported
runner and filesystem, then validate path identity, I/O ownership and storage
behavior. Representative model/application trials require a defined coding task,
isolated project, model/MCP configuration and evaluation criteria. Operational and
physical-storage-fault trials require the target deployment, restart controls,
filesystem and SLI/SLO. Preserve these as unconfirmed rather than failed or passed.
These deferrals do not block the author's next Unix-based writing phase.

Retain the separate `.v1-backup` deletion authorization question. Continue to stop
old readers/writers and their automatic restart sources for coordinated migration;
the new record does not make an online downgrade safe. Existing bounded managed
Everything verification remains evidence for its tested tools only. The older
ADRs' acceptance reasons, partial statuses and open conditions are unchanged.

### Pre-acceptance decision checklist (historical)

Author decision is needed on the recommended cohesive scope, especially:
(1) explicit roots and source IDs without silent precedence, (2) bounded full
reads and a strict parser/dependency alongside the legacy API, (3) one-Run
application with exact stored bodies, and (4) rejection by older v2 readers
once the new record is present. Numerical limits are initial testable bounds.
Review these together before acceptance. No Skill implementation or chapter-11
working example is claimed here.

### Review findings and author decision — 2026-09-12

Reviewed local/public main `7b4903fb88db5ed53cac7ef5986c75e22a626897`;
`git diff` from the proposal shows no source/test changes. The research baseline
`37c976daa5ea139ce48c2872ef9269f16312946c` has the same source/test content.
The recommendation remains proposed / not-started. No adopted decision is replaced.

The review found underspecified integration points, corrected above:

- `thread.ts:startRun` currently compares only text before returning a prior
  handle; `execution/run.ts:RunSupervisor.startRun/admit` compares submitted
  input, not configuration. Adding a selection field only at Agent is insufficient.
- `context-policy.ts:prepareSessionContext` deliberately excludes ordinary
  prefixes from its summary request. Keep that separation and cover both
  budgeted and disabled input paths in `agent.ts`.
- `codec.ts:parseEntry/parseTurnContextEntry` rejects a complete unknown record
  but drops unknown context fields; malformed terminal JSON remains recoverable.
  Preserve that distinction rather than claim universal old-reader refusal.
- Exact-source hashing must preserve BOM/CRLF. A correct source digest alone
  cannot validate an independently modified stored body; deterministic derivation
  and known parser/projection revisions are also required.
- Admission, transcript synchronization and journal readiness are separate steps.
  Pending UI state, interrupted preparation and unacknowledged I/O must agree
  with the already accepted ownership and cleanup rules.

Author adoption must explicitly include the original four choices plus these
clarifications: stable root/path identity with relisting after detected replacement,
ordered request replay identity across all entry points, summary-prefix exclusion,
and strict snapshot validation/partial-write recovery with coordinated reader
rollout. Alternatives remain body-as-message (rejected recommendation because of
re-injection), ID-only evidence (loses original instructions), and transcript v3
(stronger early format refusal but a broader migration). This review selects no
new outcome on the author's behalf. The YAML package/version and API spelling
remain implementation choices to verify after adoption, not a claimed dependency
or a reason to reopen the accepted storage/run architecture.

Add the following to the post-adoption confirmation matrix:

- Same text/request ID with different selections or reversed order conflicts in
  Agent, ThreadManager, Service and GUI; an exact replay never reopens Skill files.
- A root ID rebound to another directory with byte-identical Skill content cannot
  silently reuse an old candidate ID; partial enumeration does not claim stable
  subset membership; listing and loading enforce the same file identity rules.
- BOM/CRLF byte round-trip, valid digest with altered derived body, unknown parser
  revision, invalid event order and selected-set overflow refuse append/reopen.
- Cancellation before/after open/read/close, late descriptor resolution and
  transcript/journal sync failure preserve ownership until cleanup is confirmed.
- Active prefix in every ordinary iteration with either budget mode; zero Skill
  bodies/tools in the dedicated summary; no activation after reopen or clear.
- Complete unknown record refusal and malformed-tail recovery are tested with the
  actual old decoder; coordinated migration is not replaced by a timeout assertion.

Review verification on macOS arm64 Node 26.5.0: targeted 76 tests, headers:check,
build and the full 474-test suite passed; lint reports 0 errors and 19 existing
warnings. A memory-only probe confirms the six baseline codec/parser/BOM cases
recorded in the research addendum. No source/test/dependency files changed.
Linux and live UI/model trials were not rerun. Proposed Skill behavior is untested.

Existing six accepted / partial ADRs, `.v1-backup` deletion approval pending,
Windows and deferred application/operational/physical-fault trials are unchanged.
The bounded managed MCP follow-up is already verified; broad Everything support
is not implied or reopened.

## References

- [Source investigation and comparison](../research/2026-09-09-explicit-skill-selection.md).
- [Budgeted Session Compaction](2026-09-08-budgeted-session-compaction.md).
- [Managed Run Lifecycle](2026-09-07-managed-run-lifecycle.md).
- [Prepared Operation Authorization](2026-09-07-prepared-operation-authorization.md).
- [Required Execution Journal](2026-09-07-required-execution-journal.md).
- [Session Writer Recovery Guard](2026-09-08-session-writer-recovery-guard.md).
- [Session Storage Registration Guard](2026-09-08-session-storage-registration-guard.md).
