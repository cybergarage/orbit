# Architecture Decision Records

Orbit stores research-backed Architecture Decision Records (ADRs) in this
directory. Each ADR captures one cohesive, architecturally significant
decision together with the repository evidence, external implementation
research, alternatives, consequences, and implementation evidence needed to
understand why Orbit has its current shape.

ADRs supplement maintained product and API documentation. Current code and
maintained documentation remain authoritative for implemented behavior.

## When to write an ADR

Write or update an ADR before implementing a decision that materially affects
system structure, public or provider contracts, persistent formats, security or
privacy boundaries, cross-cutting runtime behavior, major dependencies, or a
choice that would be costly to reverse. Routine fixes, local refactors, progress
reports, chat transcripts, and temporary plans do not require ADRs.

Use the repository skill at
`.agents/skills/architecture-decision-record/SKILL.md` to create, review,
migrate, finalize, or supersede an ADR.

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

| Proposed | Status | Implementation | Decision |
| --- | --- | --- | --- |
| 2026-08-22 | accepted | completed | [GUI Application Architecture](2026-08-22-gui-application.md) |
| 2026-08-22 | accepted | completed | [Session Persistence Design](2026-08-22-session-persistence.md) |
| 2026-08-23 | accepted | completed | [Model Response and Tool Integration](2026-08-23-model-response-tool-integration.md) |
| 2026-08-23 | accepted | completed | [Session History and Model Context Assembly](2026-08-23-session-context-assembly.md) |
| 2026-08-23 | accepted | completed | [Session Resume Behavior and CLI Design](2026-08-23-session-resume-cli.md) |
| 2026-08-23 | accepted | completed | [Vibe Coding Tool Architecture](2026-08-23-vibe-coding-tools.md) |
| 2026-08-25 | accepted | completed | [Session-scoped Logging Architecture](2026-08-25-session-scoped-logging.md) |
| 2026-08-25 | accepted | completed | [Session Records versus Runtime Logs](2026-08-25-session-versus-runtime-log-content.md) |

## Background

This convention adapts Michael Nygard's lightweight status, context, decision,
and consequences format with MADR's decision drivers, considered options, and
confirmation. Repository-local records also give coding agents durable,
versioned context that is unavailable when decisions remain only in chats or in
people's memory.

- [Documenting Architecture Decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
- [Markdown Architectural Decision Records](https://adr.github.io/madr/)
- [OpenAI: Harness engineering in an agent-first world](https://openai.com/index/harness-engineering/)
