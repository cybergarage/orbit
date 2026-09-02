---
name: orbit-research
description: Investigate publications and external implementations for Orbit and write dated, evidence-backed notes under docs/research with pinned sources, verified evaluation results, limitations, contrary evidence, and non-binding implications. Use for reusable technical investigations; do not use to make an architecture decision, approve implementation, or write routine progress notes.
---

# Orbit Research

Create research notes that preserve enough primary evidence for a later concept
document or ADR without turning the investigation itself into a decision.

## Start with the repository contract

Read `../../../docs/research/README.md` completely before changing research
material. Also read the root `AGENTS.md`, inspect the research index and related
notes, and check the working tree. Those files define the current metadata,
filename, evidence, supersession, and cross-linking rules; do not duplicate or
weaken them here.

If the requested topic is narrow evidence for one ADR and has no likely reuse,
keep it in that ADR. Use `docs/research/` when the investigation compares
systems, establishes a point-in-time baseline, or can support more than one
decision.

## Bound the investigation

State the research questions and the Orbit commit before gathering evidence.
Distinguish among:

- current Orbit behavior verified in source and tests;
- claims and results reported by a publication;
- external behavior verified at a pinned source revision;
- the investigator's inference; and
- a non-binding implication or proposal for Orbit.

Do not infer authorization to implement a proposal, accept an ADR, publish a
branch, create a tag, or push a commit.

## Gather reproducible primary evidence

Prefer official proceedings, author-hosted or institutional paper records,
official specifications, and implementation source. Pin every external
implementation to a release, tag, or full commit and record inspected files. A
moving default branch is discovery material, not point-in-time evidence.

For publication-focused work, read
[references/publication-analysis.md](references/publication-analysis.md) before
extracting results. It defines the evidence ledger, evaluation checks, and
cross-paper comparison needed to avoid overstating benchmark claims.

For agent runtime, model, tool, session, context, CLI or GUI workflow,
persistence, and observability research, inspect Codex and Pi Coding Agent at
pinned revisions by default. If either is not relevant, record why rather than
omitting it silently.

Use short quotations only when the exact wording matters. Summarize the rest.
Record neutral and contrary evidence, missing experimental details, regressions,
and unsuccessful comparisons alongside positive results.

## Write the note

Write in English under `docs/research/YYYY-MM-DD-<topic>.md`. Follow the current
front matter and recommended structure in `docs/research/README.md`. Put the
result and comparison before long per-source details.

Preserve these boundaries:

- A research note has no `Decision` section and does not approve architecture.
- Maintained concepts may synthesize research but must label directional
  behavior and link the evidence.
- A later material evidence change creates a new dated note and updates
  `superseded-by`; it does not rewrite history.
- Current implementation claims cite the inspected implementation, not a paper,
  README, or directional concept.
- Publication claims say what the authors report and preserve the evaluation
  boundary. Do not generalize benchmark gains into production reliability,
  safety, or unrestricted self-improvement.

Update the research index. Link the new note from directly related research,
concepts, or ADRs only when the link improves retrieval and does not duplicate
the note's evidence.

## Verify before handoff

Check front matter, full commit hashes, investigation dates, local links, source
URLs, tables, and terminology. Format the touched Markdown with the repository's
formatter and run `git diff --check`. Run validation proportional to the files
changed and inspect the final diff for unrelated edits.

If the user requests a commit, use the repository's commit workflow and stage
only the assigned research files. Leave unrelated tracked and untracked files
untouched.
