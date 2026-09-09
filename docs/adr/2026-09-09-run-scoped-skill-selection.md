---
status: proposed
proposed-date: 2026-09-09
decision-date: null
implementation-status: not-started
implementation-completed-date: null
implementation-commits: []
superseded-by: []
---

# Run-scoped Skill Selection

## Purpose

Let a user choose a reusable code-investigation or test-review instruction from
a visible catalog, apply exactly the selected version to one coding Run, and
inspect that choice after Session restart. Avoid silent same-name replacement,
standing prompt accumulation and treating instructional text as tool permission.

## Decision

**Proposed; not accepted or implemented.** Introduce a bounded, source-identified
Skill catalog and explicit selections on managed Agent/Service Runs. Preserve
the existing single-file Skill API. Core owns reading, validation, per-Run input
and durable snapshots; the application chooses catalog roots and the user's
selection. Names below are proposed API names, not current exports.

### Catalog, roots and identity

`SkillCatalog` accepts explicit `{id, directory}` roots and a limits profile.
Require unique root IDs, canonicalize configured roots and report aliases to
the same real root as a configuration conflict. The library searches no implicit
home, ancestor or plugin locations. CLI/GUI may default to `.orbit/skills` under
the nearest marked workspace and show that root; additional roots are explicit
configuration, not hidden priority. Absence yields an empty catalog with a
source diagnostic. No root means no active Skill feature.

Discover only immediate child directories containing `SKILL.md`. Do not recurse
arbitrarily, follow candidate-directory/file symlinks, or auto-read scripts and
linked resources. Stream enumeration with bounded entries and bytes; sort the
bounded results for reproducible display. Proposed initial ceilings are 8
roots, 4,096 inspected directory entries, 128 candidates, 64 KiB per file,
2 MiB total bytes read per listing and 4 selected skills per Run. Validate
positive finite integers and report which limit stopped listing. Return
`complete: false` with issues on incomplete discovery; exact listed IDs remain
selectable because no name resolution depends on a supposedly complete list.
These are initial product bounds to measure, not optimal settings.

Each candidate has a stable opaque ID derived from its configured root ID and
canonical relative file identity, display name, description, source/root,
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
Do not claim full Agent Skills specification compatibility or infer a tool
grant from unsupported metadata.

`new Skill({content|file})` retains its existing permissive behavior for legacy
callers; its instances are not automatically valid catalog selections. The
strict catalog parser is a separate path. The migration guide explains how to
fix duplicate keys, unsupported metadata, names and paths rather than changing
legacy parsing underneath existing applications.

### One Run of application, budget and permission

Expose selections on `Agent.startRun` and `OrbitApplicationService.startRun` as
IDs plus expected digests. Snapshot configured catalog/profile identity at
admission and include the selection fingerprint in request-ID comparison.
Resolve selected content under the same Run cancellation/resource tracking,
then save and synchronize the snapshot before the first model call. A read,
validation or required-recording failure stops preparation; it never runs with
silently omitted selections. Loading is configuration-data reading explicitly
authorized by the selected catalog; it does not execute an instruction.

Build a per-Run user-level instruction prefix after standing workspace/system
instructions and before the selected conversation. Label each block with its
source, base directory and one-Run scope. Escape structured labels separately
from body text. Do not mutate Agent's standing `messages` array or permanently
append the body as a user conversation message. Include the full active body
and wrapper in the accepted frozen-request budget. Protect them for every model
iteration of this Run; refuse if the protected input cannot fit. The
summarization call has no tools and cannot activate another Skill.

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
ordering against the associated turn. Empty selections need no record. A
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
restart sources before enabling selections. Files without selections remain
readable under their previous contract. Existing Session deletion removes the
snapshot with its transcript and retains the minimal deletion record. The
separate outstanding `.v1-backup` deletion policy is not resolved by this ADR.

### CLI, Ink, GUI and library

Expose a read-only `skills` list with JSON output and source diagnostics.
`exec --skill ID@DIGEST` (repeatable) passes explicit selections; plain mentions
of a Skill name in text do not activate it. Ink offers a catalog list and a
pending next-Run selection/clear operation. Consume the pending selection on
successful admission, retain it when admission is rejected, and show loading
or resolution failure distinctly from active use.

GUI lists server-configured candidates with source and digest, submits only
IDs/digests, and displays pending/current/finished selections. Keep the existing
loopback capability/origin controls; clients cannot provide arbitrary file
paths or new roots. Transport reconnection reads the Run snapshot and must not
re-submit a selection as another Run. Library callers can use the same catalog
and structured Run options without a terminal. Historical inspection shows what
was selected and the Run outcome separately.

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

Not started. No implementation hashes or completion date are recorded. The
following are required tests after explicit adoption; baseline tests are not
substitutes.

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

## Follow-up Work

Author decision is needed on the recommended cohesive scope, especially:
(1) explicit roots and source IDs without silent precedence, (2) bounded full
reads and a strict parser/dependency alongside the legacy API, (3) one-Run
application with exact stored bodies, and (4) rejection by older v2 readers
once the new record is present. Numerical limits are initial testable bounds.
Review these together before acceptance. No Skill implementation or chapter-11
working example is claimed here.

## References

- [Source investigation and comparison](../research/2026-09-09-explicit-skill-selection.md).
- [Budgeted Session Compaction](2026-09-08-budgeted-session-compaction.md).
- [Managed Run Lifecycle](2026-09-07-managed-run-lifecycle.md).
- [Prepared Operation Authorization](2026-09-07-prepared-operation-authorization.md).
- [Required Execution Journal](2026-09-07-required-execution-journal.md).
- [Session Writer Recovery Guard](2026-09-08-session-writer-recovery-guard.md).
- [Session Storage Registration Guard](2026-09-08-session-storage-registration-guard.md).
