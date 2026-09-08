# Architecture Decision Records

Orbit stores research-backed Architecture Decision Records (ADRs) in this
directory. Each ADR captures one cohesive, architecturally significant
decision together with the repository evidence, external implementation
research, alternatives, consequences, and implementation evidence needed to
understand why Orbit has its current shape.

ADRs supplement maintained product and API documentation. Current code and
maintained documentation remain authoritative for implemented behavior.
Concept documents under `docs/concepts/` define durable vocabulary and mental
models but do not approve architecture or replace decision rationale.

## When to write an ADR

Write or update an ADR before implementing a decision that materially affects
system structure, public or provider contracts, persistent formats, security or
privacy boundaries, cross-cutting runtime behavior, major dependencies, or a
choice that would be costly to reverse. Routine fixes, local refactors, progress
reports, chat transcripts, and temporary plans do not require ADRs.

Use the repository skill at
`.agents/skills/architecture-decision-record/SKILL.md` to create, review,
migrate, finalize, or supersede an ADR.

## Requesting ADR work from coding agents

Codex can select the ADR skill automatically when a request clearly matches its
description. For an architecturally significant task, prefer explicit
invocation by starting the request with `$architecture-decision-record`. Codex
CLI and the IDE extension support `$` mentions and `/skills`, while the ChatGPT
desktop app exposes project skills in its Skills sidebar; see the [official
OpenAI skill documentation](https://learn.chatgpt.com/docs/build-skills).

Creating an ADR does not approve it and does not authorize implementation.
State the intended lifecycle boundary and whether commits are required in every
request.

### Propose an ADR without implementation

```text
$architecture-decision-record

Create an ADR for <describe the architectural decision to be made>.

Purpose:
- <describe the problem, goal, or expected outcome>

Scope and constraints:
- <identify the affected components, contracts, or workflows>
- <list important technical, compatibility, security, or delivery constraints>

Research:
- <identify the Orbit source, tests, and documentation to inspect>
- <identify relevant external implementations and pinned source revisions>
- <identify official documentation or other primary sources>

Consider:
- <list the decision drivers>
- <list known options or alternatives>
- <list trade-offs, risks, and open questions that must be evaluated>

Create and commit only the proposed ADR. Do not implement it.
```

This request leaves `status` as `proposed`, `decision-date` as `null`, and
`implementation-status` as `not-started`.

### Accept or reject an ADR

After reviewing a proposal, identify the exact record and state the decision
explicitly:

```text
$architecture-decision-record

Accept docs/adr/YYYY-MM-DD-openai-responses-api.md. Set its status and
decision-date, confirm its unresolved questions and implementation conditions,
and commit only the ADR update. Do not start implementation.
```

For a rejection, request `rejected` instead and require the rationale to remain
in the record.

### Implement an accepted ADR

```text
$architecture-decision-record

Implement the accepted decision in
docs/adr/YYYY-MM-DD-openai-responses-api.md.

Keep the change within the ADR scope, update tests and maintained
documentation, run the repository validation set, and commit the
implementation. After that commit exists, record its full hash, the completion
date, confirmation evidence, and remaining follow-up work in the ADR, then
create a separate ADR finalization commit.
```

The finalization must be a later commit because a tracked file cannot contain
the final hash of the commit that includes that file.

### Request the complete workflow

A single request may authorize the entire lifecycle. A separate acceptance or
rejection request is not required when the original request explicitly
delegates that decision, but the `proposed` to `accepted` or `rejected` state
transition is still required. Never implement an ADR while it remains
`proposed`.

The coding agent must perform the complete workflow in this order:

1. Research the repository, relevant external implementations, and primary
   sources.
2. Create and commit the ADR with `status: proposed`, `decision-date: null`, and
   `implementation-status: not-started`.
3. Review the proposal against its evidence, decision drivers, constraints,
   alternatives, risks, and unresolved questions.
4. If the proposal is supported, change it to `accepted`, set `decision-date`,
   and commit the decision before implementation. If it is not supported,
   change it to `rejected`, set `decision-date`, record the rationale, commit
   the rejection, and stop.
5. Implement only the accepted scope, including tests and maintained
   documentation, then run the repository validation set.
6. Commit the implementation without claiming that the ADR itself contains
   that commit's final hash.
7. In a later documentation commit, record the full implementation commit
   hashes, completion date, confirmation evidence, remaining follow-up work,
   and `implementation-status: completed`.

Use this request template:

```text
$architecture-decision-record

Research and deliver an ADR for <describe the architectural decision>.

I delegate the acceptance or rejection decision for this workflow. Complete
these steps in order:

1. Create and commit a proposed ADR.
2. Review the proposal against the gathered evidence.
3. If supported, accept it explicitly, set decision-date, and commit the
   decision. If unsupported, reject it with a rationale and stop.
4. Implement only the accepted scope with tests and maintained documentation.
5. Validate and commit the implementation.
6. Finalize the ADR with the implementation commit hashes in a later commit.

Do not implement while the ADR remains proposed. Stop before acceptance if a
material question remains unresolved.
```

For decisions that need human review, prefer separate proposal and
implementation requests. The shortest useful requests are:

```text
$architecture-decision-record
Create and commit an ADR for <decision>. Do not implement it.
```

```text
$architecture-decision-record
Accept and implement docs/adr/YYYY-MM-DD-<topic>.md. Commit the implementation,
then finalize the ADR in a separate commit.
```

## File names

Name decision records using the proposal date and a concise lowercase English
topic slug:

```text
docs/adr/YYYY-MM-DD-<topic>.md
```

Keep the original filename while a decision advances through its lifecycle.
When an accepted decision changes materially, create a new dated ADR and link
the old and new records through `superseded-by` rather than rewriting history.

## Metadata

Every ADR begins with YAML front matter using this schema:

```yaml
---
status: proposed
proposed-date: YYYY-MM-DD
decision-date: null
implementation-status: not-started
implementation-completed-date: null
implementation-commits: []
superseded-by: []
---
```

Allowed decision statuses are `proposed`, `accepted`, `rejected`, `deprecated`,
and `superseded`. Allowed implementation statuses are `not-started`,
`in-progress`, `partial`, `completed`, and `not-applicable`.

Use ISO 8601 dates and full 40-character commit hashes. `decision-date` records
the date of an explicit acceptance or rejection and is required when a new ADR
moves to either status. It remains `null` while the ADR is proposed. Do not set
it from `implementation-completed-date`: decision and implementation are
separate lifecycle events and share a date only when both actually occur on the
same day.

Historical ADRs migrated after implementation may retain a null
`decision-date` when no acceptance or rejection date was recorded. This is a
legacy-data exception, not the normal accepted or rejected state. Do not infer
the missing date from an implementation commit. `implementation-commits` lists
the commits that completed the decision's defined scope, not every later change
in the same area.

## Required structure

Put the decision and its effects before detailed research so both people and
agents can find the outcome quickly. New ADRs use these top-level sections,
adapting subsections to the topic:

1. `Purpose`
2. `Decision`
3. `Consequences`
4. `Context and Problem Statement`
5. `Decision Drivers`
6. `External Implementation Research`
7. `Considered Options`
8. `Implementation and Confirmation`
9. `Follow-up Work`
10. `References`

The purpose, decision, and consequences must stand on their own. Detailed
repository evidence and source research may be extensive, but each ADR should
still represent one cohesive decision. Split independent decisions into
separate records.

Records that predate this convention retain their historical detailed section
structure and links. Their migration adds the standard metadata plus explicit
purpose, decision, consequences, and implementation confirmation summaries;
future substantive revisions should converge on the complete structure above.

Clearly distinguish verified facts, inferences, proposals, and future work.
Record positive, negative, and neutral consequences rather than presenting only
benefits.

## External implementation research

For decisions about agent runtimes, models, tools, sessions, context assembly,
CLI or GUI agent workflows, persistence, or observability, research both Codex
and Pi Coding Agent by default. Record for each inspected system:

- the version, tag, or full source commit and investigation date;
- the source files or official documentation inspected;
- verified behavior relevant to the decision; and
- what Orbit should and should not adopt.

Add other implementations when they are more directly relevant. If Codex or Pi
does not apply, state the reason instead of adding a ceremonial comparison.
Never describe a moving branch as point-in-time source evidence without pinning
its revision.

Reusable or extensive point-in-time investigations may be stored separately in
`docs/research/` under the rules in
[Engineering Research](../research/README.md). An ADR may link those notes as
supporting evidence, but its purpose, decision, consequences, decision-relevant
facts, and rationale must remain understandable without opening another file.
Research notes are non-binding and never authorize implementation.

When an accepted ADR changes maintained terminology, invariants, or runtime
structure, its implementation must also update the relevant concept documents
and `docs/architecture.md`. Link those maintained documents from the ADR when
they help readers locate the resulting contract; keep the full rationale in the
ADR.

## Lifecycle

1. Create and commit a `proposed` ADR before implementation.
2. Record explicit acceptance or rejection in `status` and `decision-date`.
3. Update `implementation-status` as work proceeds.
4. After the implementation commits exist, use a separate documentation commit
   to record their full hashes, the completion date, confirmation evidence, and
   `completed` status.
5. Preserve the accepted context, decision, and original rationale. Clarify
   wording and add implementation evidence or newly observed consequences, but
   create a superseding ADR for a material decision change.

The separate finalization commit is required because a commit cannot contain
its own final hash in a tracked file.

## Decision index

| Proposed   | Status     | Implementation | Decision                                                                                |
| ---------- | ---------- | -------------- | --------------------------------------------------------------------------------------- |
| 2026-08-22 | accepted   | completed      | [GUI Application Architecture](2026-08-22-gui-application.md)                           |
| 2026-08-22 | accepted   | completed      | [Session Persistence Design](2026-08-22-session-persistence.md)                         |
| 2026-08-23 | accepted   | completed      | [Model Response and Tool Integration](2026-08-23-model-response-tool-integration.md)    |
| 2026-08-23 | accepted   | completed      | [Session History and Model Context Assembly](2026-08-23-session-context-assembly.md)    |
| 2026-08-23 | accepted   | completed      | [Session Resume Behavior and CLI Design](2026-08-23-session-resume-cli.md)              |
| 2026-08-23 | superseded | completed      | [Vibe Coding Tool Architecture](2026-08-23-vibe-coding-tools.md)                        |
| 2026-08-25 | accepted   | completed      | [Session-scoped Logging Architecture](2026-08-25-session-scoped-logging.md)             |
| 2026-08-25 | accepted   | completed      | [Session Records versus Runtime Logs](2026-08-25-session-versus-runtime-log-content.md) |
| 2026-08-25 | accepted   | completed      | [User-Accessible Session Information](2026-08-25-session-information-access.md)         |
| 2026-09-07 | accepted   | partial        | [Managed Run Lifecycle](2026-09-07-managed-run-lifecycle.md)                            |
| 2026-09-07 | accepted   | partial        | [Prepared Operation Authorization](2026-09-07-prepared-operation-authorization.md)      |
| 2026-09-07 | accepted   | partial        | [Required Execution Journal](2026-09-07-required-execution-journal.md)                  |
| 2026-09-08 | accepted   | partial        | [Session Writer Recovery Guard](2026-09-08-session-writer-recovery-guard.md)            |
| 2026-09-08 | proposed   | not-started    | [Session Storage Registration Guard](2026-09-08-session-storage-registration-guard.md)  |

The Vibe Coding Tool Architecture supersession is partial: the 2026-09-07
authorization decision replaces permission-free defaults and managed admission/
validation/adapter conditions, while retaining its registry and tool/provider
primitives. The three 2026-09-07 decisions remain accepted / partial. Common execution is
implemented. Follow-up verification originally found a two-writer stale recovery
race. [Session Writer Recovery Guard](2026-09-08-session-writer-recovery-guard.md)
was accepted on 2026-09-08 and now has a partial implementation: the updated
race probe and 390 tests passed on macOS and Linux, including the corrected
legacy log cursor fixture. Additional local cases pass in the macOS 396-test
suite and Linux 24-case recovery suite. Its evidence record retains the prior failures and
lists remaining platform, fault-matrix, deployment and product checks. The
three parent decisions remain accepted / partial, with their reasons and history
retained. No parent ADR is superseded by this recovery refinement.

The [resumed confirmation](2026-09-08-session-writer-recovery-guard.md#resumed-platform-and-ui-confirmation--2026-09-08)
adds actual-filesystem case tests, macOS 397 tests, a clean native Linux build
with 396 tests, the later Linux 25-case recovery suite, and updated real Ink/browser
fault verification. Required platform, deployment and representative product checks
still prevent completion; no accepted decision or product limit changed.

The [additional verification](2026-09-08-session-writer-recovery-guard.md#additional-node-matrix-and-registration-interruption-finding--2026-09-08)
adds Linux Node 20.19.0 / 22.23.2 but also identifies a separate registration
interruption defect that still admits writes. A new protocol decision is pending;
the four ADRs remain partial. The same record separates the official Everything
server's managed schema refusal from a successful direct-client control.

The [registration proposal](2026-09-08-session-storage-registration-guard.md) compares
persistent guards with a committed manifest and specifies v2 migration, existing-file
resync and uncertain completion acknowledgement. It is proposed / not-started;
no acceptance, implementation or supersession of the four partial records is implied.

## Background

This convention adapts Michael Nygard's lightweight status, context, decision,
and consequences format with MADR's decision drivers, considered options, and
confirmation. Repository-local records also give coding agents durable,
versioned context that is unavailable when decisions remain only in chats or in
people's memory.

- [Documenting Architecture Decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
- [Markdown Architectural Decision Records](https://adr.github.io/madr/)
- [OpenAI: Harness engineering in an agent-first world](https://openai.com/index/harness-engineering/)
