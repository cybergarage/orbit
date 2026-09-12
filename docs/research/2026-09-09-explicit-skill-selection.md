---
status: current
investigation-date: 2026-09-09
orbit-commit: 37c976daa5ea139ce48c2872ef9269f16312946c
related-adrs:
  - docs/adr/2026-09-09-run-scoped-skill-selection.md
superseded-by: []
---

# Explicit Skill Selection and Run-scoped Instructions

## Purpose

Investigate how a coding application can list reusable instructions, let a user
select them, and explain exactly which content was used by one managed Run.
The new input-budget implementation changes the integration baseline: selected
instructions must be counted, protected during that Run and distinguished from
historical instructions after restart. This is non-binding research, not an
acceptance or implementation record.

## Findings

Orbit still has only an eager single-file `Skill` value object. Its limited
frontmatter parser is unsuitable as a strict catalog validator. A bounded
catalog and exact user selection are a smaller useful step than automatic
model selection, installation or a shared agent roster. Persisted selection
needs an explicit expiry rule; putting every selected body into the standing
system prompt would silently retain it across subsequent work.

Recommend a source-identified catalog, selection checked against a content
digest, and a per-Run snapshot stored separately from ordinary conversation.
Persist the full source text with frontmatter so its digest remains verifiable;
the active body is derived from that snapshot.
The application chooses roots and selections; core owns bounded reading,
validation, input assembly, recording and expiry. Tool permission remains the
existing execution policy. The choices below are proposals.

## Research Questions

- What does the current Skill parser actually accept, and what remains absent?
- How can same-name files remain distinguishable without silent precedence?
- How can listing avoid putting all instruction bodies into model input?
- What should survive Session reopen, and what must not become active again?
- Can selected bodies use the accepted budget, writer and journal contracts?

## Orbit Baseline and Reproduction

Inspected `37c976daa5ea139ce48c2872ef9269f16312946c` (clean working tree before
this note). `src/core/skills/skill.ts` and `test/core/skills.test.ts` have no
changes since the book analysis baseline
`8ee97144c20b006225db52efc482004200527e4c`.

| Source inspected                                                | Verified current behavior                                                                                                                                                                                                    |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/skills/skill.ts`                                      | Reads the entire file synchronously. Retains source text, parsed instructions and name/description. Repeated fields overwrite earlier fields; YAML block scalars are not decoded.                                            |
| `src/core/skills/index.ts`, core/model exports                  | Public value object exists. Source search finds no runtime consumer outside its definition and exports. No discovery/selection API is present.                                                                               |
| `src/core/context.ts`, `workspace.ts`                           | Workspace instruction discovery is separate from skills; it does not construct a Skill catalog.                                                                                                                              |
| `src/core/agent.ts`, `application.ts`, `thread.ts`              | Managed Runs, shared Service entry points and explicit per-Run configuration exist. No selected-Skill input or UI workflow exists.                                                                                           |
| `src/core/session/context-policy.ts`, `context-builder.ts`      | Budgeted preparation counts a frozen provider request and protects its prefix/latest turn. Builder selects saved checkpoints without model calls.                                                                            |
| `src/core/session/entries.ts`, `codec.ts`                       | `turn_context` has a fixed decoded shape and discards unknown fields. Unknown record types reject parsing. An optional unknown field is therefore not reliable durable Skill evidence under older readers/recovery rewrites. |
| `src/core/session/session.ts`, `recorder.ts`, execution journal | Existing ownership, required synchronization and quarantine must also govern a future selection snapshot.                                                                                                                    |

Executed on macOS arm64 Node 26.5.0:

```sh
TS_NODE_PROJECT=tsconfig.test.json npx mocha --forbid-only --reporter dot \
  test/core/skills.test.ts test/core/context.test.ts test/core/workspace.test.ts
```

All 24 existing tests pass. A memory-only parser reproduction with repeated
`name` fields and `description: |` returns the second name and the literal pipe.
The baseline's previous 474-test Unix suites remain implementation evidence
for budgeting, not evidence that Skill selection works. No proposed catalog,
new parser or selection flow was executed.

## External Systems Investigated

These exact revisions are comparison snapshots reused from prior research;
the following source files were inspected anew. Neither external application
was run. They are not asserted to be the newest release.

### Codex

Revision `5adb68a49933ae446bf11935662c83dba55a0804` (`rust-v0.152.1`):

- [`skills/src/model.rs`](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/skills/src/model.rs) separates host metadata, paths, scopes and implicit-invocation policy. A comment explicitly leaves product gating enforcement as future work; parsed policy is not proof of enforcement.
- [`ext/skills/src/render.rs`](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/ext/skills/src/render.rs), `skill_metadata_budget` and `allocate_skill_lines`, budget the model-visible catalog and shorten descriptions or omit entries when needed.
- [`core/src/skills.rs`](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/core/src/skills.rs) records explicit and implicit invocation separately and connects invocation to turn-scoped extension/telemetry data.

**Inference:** separate catalog identity, active content and invocation evidence.
Orbit's initial human-only selector need not render the entire catalog to the
model or copy automatic invocation. Metadata truncation is consequently not a
required feature of the first Orbit proposal. These files do not establish all
Codex filesystem race or restart guarantees.

### Pi Coding Agent

Revision `b79e4cc834970cca69daebffab7df1da7d1e52c4` (`v0.84.4`),
[`packages/coding-agent/src/core/skills.ts`](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/src/core/skills.ts).

`loadSkillsFromDirInternal` searches directories and can follow symlinks.
`loadSkillFromFile` reads the full file while constructing metadata; not exposing
bodies to the model is distinct from not reading bodies from disk. Invalid
names can produce warnings while missing descriptions prevent loading.
`formatSkillsForPrompt` provides catalog metadata and points model tool reads
to the skill directory; it excludes explicitly-only entries from that list.

**Inference:** preserve the distinction between list metadata and selected body,
but do not describe discovery as zero-body I/O. Orbit can reject invalid
catalog entries and avoid recursive/symlink traversal initially. Its existing
tool permissions must still apply when a selected instruction refers to a
resource outside the coding workspace. This inspection alone does not verify
Pi's complete explicit invocation or persistence path.

## Options and Non-binding Recommendation

| Choice                                                              | Advantages                                                                   | Costs or contrary evidence                                                                                                                        |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep single-file Skill and let each app glue strings into prompts   | Small core change                                                            | Duplicate selection, expiry and recording semantics across CLI/GUI/library; does not meet the book's shared behavior.                             |
| Automatically expose all metadata and let the model activate skills | Useful for broad catalogs; external systems support related workflows        | Needs model selection semantics and metadata budgeting; unnecessary for the initial explicit-user example.                                        |
| Bounded catalog plus exact per-Run user selection                   | Clear source, content and expiry; uses existing Run/budget ownership         | New public API and transcript record; copied instruction bodies remain sensitive stored data.                                                     |
| Store body as an ordinary user message                              | Reuses existing schema                                                       | Old input assembly can repeatedly reactivate expired instructions; mixes invocation evidence with ordinary conversation.                          |
| Store ID/digest only                                                | Less retained content                                                        | A changed/deleted file cannot explain the actual instructions used; digest alone is not replayable content.                                       |
| Distinct versioned `skill_context` record under transcript v2       | Separate historical snapshot from active input; old record readers reject it | Enabling the new feature requires compatible readers and stopping older writers; older v2 readers cannot open a file once it contains this entry. |

Recommend strict catalog validation backed by a maintained YAML parser while
preserving the old `new Skill(...)` compatibility API. Accept only the documented
name/description metadata subset at this stage; do not claim complete Agent
Skills format conformance. Reject duplicate keys, aliases, custom tags and
non-string fields. A dependency/version must be checked and installed only in
an authorized implementation, with deterministic parser tests.

For catalog I/O, reading each bounded file to compute a digest is an acceptable
initial cost. Retain only metadata/digest in the catalog, then re-read and
validate the selected body. This is lazy activation and limited retained body
memory, not metadata-only disk reading. Exact digest comparison rejects changes
instead of silently accepting newly edited instructions.

## Risks and Limits

A path and digest identify content, not a trusted author. A local process able
to rewrite ancestors can race path checks; regular-file identity checks and
revalidation reduce mistakes but are not an OS sandbox. File-operation limits
are not a guarantee that a failing filesystem answers before a wall-clock
limit. Application-supplied roots define authorized catalog access; auxiliary
scripts/resources are not auto-loaded or executed.

A per-Run user-level prefix expires mechanically, but a model can still infer
ideas from old answers influenced by past skills. The proposal prevents
automatic re-injection of an expired body; it cannot prove semantic forgetting.
Real-task quality and representative trials remain deferred until conditions
exist. Windows, operational restart control and physical storage failures also
remain separately deferred; they are not reasons to label proposed code done.

## Open Questions for Adoption

Confirm the cohesive scope: explicit roots, source IDs without name precedence,
bounded full-file catalog reads, strict metadata parser with a new dependency,
one-Run expiry, stored body snapshots and older-v2-reader rejection on the new
record. Numerical limits are unmeasured initial bounds, not tuned defaults.
The proposed ADR supplies a concrete order, UI contract and test matrix.

## Related Decisions and References

- [Run-scoped Skill Selection](../adr/2026-09-09-run-scoped-skill-selection.md).
- [Accepted Budgeted Session Compaction](../adr/2026-09-08-budgeted-session-compaction.md).
- [Earlier cross-product Skill ownership investigation](2026-09-03-grok-bot-architecture-and-skill-ownership.md), retained as historical evidence; this note does not adopt Grok Bot scheduling or agent rosters.

## Review clarification — 2026-09-12

This addendum preserves the 2026-09-09 investigation and its non-binding
recommendation. Local HEAD and public main are
`7b4903fb88db5ed53cac7ef5986c75e22a626897`, confirmed with `git ls-remote`.
Source/test content is unchanged from the original baseline; no new runtime
implementation is inferred from this documentation review.

Additional source inspection found the integration constraints below. They refine
the same recommendation rather than replace the external comparison findings.

| Source                                                                                          | Observation and implication for the proposal                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/core/thread.ts:startRun`                                                                   | Returns a cached handle after comparing only content. Selection comparison must happen before this short circuit.                                                                                                  |
| `src/core/execution/run.ts:startRun/admit`                                                      | Request replay compares canonical submitted input or its persisted digest; the separate configuration digest does not replace that comparison. Ordered selections and catalog revision must enter submitted input. |
| `src/core/agent.ts:startRun/invokeSessionWithTurn`                                              | Admission precedes turn context, started event and user messages. Both budgeted and disabled model paths need the same active prefix.                                                                              |
| `src/core/session/context-policy.ts:prepareSessionContext`                                      | Ordinary requests include the protected prefix; the summary request is prepared from its dedicated prompt alone. Keep Skill content outside this summary and reattach it for ordinary answering.                   |
| `src/core/session/codec.ts:parseSessionFile`                                                    | Unknown complete record types fail, while malformed non-newline final JSON is recoverable. Coordinated old-reader shutdown remains necessary.                                                                      |
| `src/core/session/session.ts:recordTurnContext/synchronize` and `src/core/execution/journal.ts` | Transcript acknowledgement and journal readiness are separate writes. A resolved snapshot alone does not prove model execution or successful Run completion.                                                       |

Re-executed Skill/context/workspace plus Session, ThreadManager and compaction
suites: 76 passing on macOS arm64 Node 26.5.0. The command is the earlier Mocha
command with `test/core/session.test.ts`, `test/core/thread.test.ts` and
`test/core/execution/context-compaction.test.ts` added. These are baseline tests,
not tests of the proposed catalog.

A memory-only probe using the rebuilt current `Skill` and `parseSessionFile`
confirmed six cases: legacy repeated-name/block-scalar behavior, unknown
turn-context-field loss, complete unknown-record refusal, malformed-tail recovery,
BOM-stripping hash mismatch, and exact BOM-preserving hash equality. Reproduce the
last two with UTF-8 bytes containing an initial BOM and CRLF: default
`new TextDecoder('utf-8', {fatal: true})` removes the BOM, whereas
`{fatal: true, ignoreBOM: true}` preserves it. Hash original bytes and validate
stored UTF-8 round-trip before deriving metadata/body; do not hash only a decoded
parser view. This experiment used no user Session data.

Pi's same pinned `skills.ts` was fetched again and confirms full-file metadata
reads and metadata-only prompt rendering. The Codex pinned source fetch failed
in this review; its original inspected evidence is reused, not claimed as a new
successful retrieval. Neither external application was executed.

The ADR now specifies ordered replay identity, separate summary input, exact byte
preservation and deterministic body validation, admission/snapshot/readiness
ordering, bounded asynchronous cleanup and metadata-only reconnect notifications.
These remain proposed conditions. No YAML package was installed or strict parser
executed, and no model-quality or physical-storage guarantee follows from the
baseline checks. Author adoption and subsequent implementation tests are still
required. Existing backup-approval and author-deferred trials remain open.

The final review validation also passed headers:check, build and all 474 existing
tests on macOS arm64 Node 26.5.0, with 0 lint errors and 19 existing warnings.
No source/test/dependency changes resulted. Linux and live UI trials were not
rerun; earlier Unix results remain historical evidence. Documentation metadata,
local links and proposal status are checked separately from runtime behavior.

## Subsequent adoption — 2026-09-12

The author explicitly accepted the reviewed recommendation in the linked
[ADR acceptance record](../adr/2026-09-09-run-scoped-skill-selection.md#author-acceptance--2026-09-12).
At acceptance the ADR was accepted / not-started. This note preserves the original investigation
and review as non-binding historical evidence; it does not claim implementation
or resolve the separate backup-deletion authorization and deferred trials.


## Subsequent implementation — 2026-09-12

The [ADR implementation evidence](../adr/2026-09-09-run-scoped-skill-selection.md#implementation-evidence--2026-09-12)
records commit `a77919e501a118418b31be445983d47f34b2d568`, the current public API,
Unix and isolated UI results, and the remaining deferred trials. Its state is
accepted / partial. The earlier investigation and review remain historical;
this update does not re-accept the decision or resolve backup deletion.
