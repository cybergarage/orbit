---
name: architecture-decision-record
description: Create, review, migrate, finalize, or supersede Orbit Architecture Decision Records in docs/adr for architecturally significant changes. Use for durable decisions about architecture, public contracts, persistence, agent runtime behavior, security boundaries, or costly-to-reverse choices; do not use for routine progress notes or local implementation details.
---

# Architecture Decision Records

Create evidence-backed Orbit ADRs whose current decision, consequences, and
implementation state are easy for people and coding agents to retrieve.

## Start with the repository convention

Read `../../../docs/adr/README.md` completely before changing an ADR. Also
inspect the Architecture decision records section of
`../../../docs/development.md`. Those files define the authoritative metadata,
format, lifecycle, and external-research requirements; do not duplicate or
silently weaken them here.

## Determine the operation

- For a new decision, search `docs/adr/` for an existing record covering
  the same decision. Create a dated ADR only when the decision is distinct.
- For a review or migration, preserve historical evidence and links. Do not
  invent acceptance dates, source revisions, or implementation evidence.
- For implementation finalization, inspect the actual diff, tests,
  documentation, and Git history before marking the scope completed.
- For a material reversal or replacement, create a new ADR and link it from the
  old record with `superseded-by`.

Do not implement a proposed decision unless the user also requests
implementation. Do not treat drafting an ADR as approval of the decision.

## Gather evidence

Inspect current Orbit behavior and cite the relevant source, tests, settings,
and maintained documentation. Separate verified current behavior from the
proposal.

For agent runtime, model, tool, session, context, CLI or GUI agent workflow,
persistence, and observability decisions, investigate Codex and Pi Coding Agent
by default. Pin source evidence to an exact version, tag, or full commit, record
the files inspected, and explain both adopted and rejected lessons. When either
system is not relevant, record why. Prefer primary source and official
documentation over summaries.

## Write the decision

Keep one cohesive decision per ADR. State the outcome in active, unambiguous
English, list meaningful alternatives and decision drivers, and record
positive, negative, and neutral consequences. Keep detailed research after the
purpose, decision, and consequences so the outcome remains quickly legible.

Use `proposed` with a null `decision-date` until an explicit decision is
recorded. Set `decision-date` when changing a new ADR to `accepted` or
`rejected`; do not copy the implementation completion date automatically. Keep
decision status separate from implementation status. Use ISO dates and full
40-character commit hashes. Leave unknown metadata in migrated historical ADRs
as `null`; never infer it merely to complete the template.

## Finalize implementation

Mark implementation `completed` only when the ADR's defined scope is delivered,
maintained documentation is updated, and proportionate validation passes.
Record the completion date, full implementation commit hashes, confirmation
evidence, and remaining follow-up work in a documentation commit made after the
implementation commits. Do not include unrelated later commits.

Before finishing, check metadata consistency, local links, source revisions,
the decision index, and the final diff.
