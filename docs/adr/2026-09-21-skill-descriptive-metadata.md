---
status: accepted
proposed-date: 2026-09-21
decision-date: 2026-09-21
implementation-status: not-started
implementation-completed-date: null
implementation-commits: []
superseded-by: []
---

# Descriptive Skill Metadata

## Purpose

Accept standard Skills containing license and environment descriptions without
requiring users to remove those descriptions from a distribution.

## Decision

Accepted on 2026-09-21 under the author's explicit request to implement the
previously explained accept, validate, retain and display policy in Orbit and
the book. Review confirms no permission expansion and preserves legacy records.

Extend the strict catalog with optional string `license` and `compatibility`.
Preserve their exact scalar values in listings and snapshots and show them in
CLI, Ink and GUI listings. Require nonblank values; compatibility permits
1–500 Unicode code points. License has no additional field length ceiling in
the standard; existing source and record byte bounds still apply. Unknown
keys, including `allowed-tools`, remain rejected. These fields convey information;
they do not install dependencies, assert license approval or grant permissions.

Use projection revision `yaml-2.9.1-body-v2` for sources with either new field.
Keep revision v1 for sources without either field. Readers validate both
revisions, require v1 to omit the new metadata, and compare every derived value
against the exact source. This retains old records and lets older readers
continue reading unchanged Skills, while rejecting new metadata snapshots.
The record envelope and transcript versions do not change.

This narrowly replaces the two-field restriction in the 2026-09-09 Skill ADR;
its selection, execution, storage and deferred verification decisions remain.

## Consequences

External Skills using these two standard fields become usable without edits.
The optional fields are inspectable and tampering is detected on reopening.
Older readers cannot open records containing the v2 projection. Deploy compatible
readers before using these Skills; no downgrade conversion is supplied.
Other optional standard fields remain unsupported, and resources are not bundled
into snapshots. The legacy Skill constructor is unchanged.

## Context and Problem Statement

At Orbit 78f24b39884915a10cc03019031eda73dad6a141, `parseSkillSource` rejects
anything other than name and description. `catalog.ts` and `record.ts` retain
and validate their projection. CLI/Ink and GUI render only existing metadata.
The source digest already covers all source bytes, so the selection identity
and permission model need no expansion.

## Decision Drivers

Interoperability, visible environment requirements, exact snapshot validation,
backward readability and no authority changes.

## External Implementation Research

Inspected on 2026-09-21: [Agent Skills specification](https://agentskills.io/specification)
defines optional license and compatibility; the latter is limited to 500 characters.
The license field has no stated length maximum.
Pi at 781152fc24841dc54b22284514604048ebe5e2c9,
`packages/coding-agent/src/core/skills.ts`, accepts open frontmatter keys and
projects name/description/path into its catalog. Adopt tolerance for these
standard descriptive fields, but retain Orbit's explicit allowlist and snapshots.
The local source copy was read; no Pi runtime test was performed.
Codex at 8c68d4c87dc54d38861f5114e920c3de2efa5876 is the book's comparison
baseline. Fetching `codex-rs/core-skills/src/loader.rs` failed (DNS/cache miss),
so no claim is made about its optional-field validation. Codex behavior is not
a prerequisite for this standard-defined change; this comparison remains limited.

## Considered Options

- Retain rejection: prevents reuse of otherwise useful distributions.
- Silently discard fields: loses information users need before selection.
- Accept arbitrary metadata: broadens the contract beyond the requested fields.
- Accept and preserve only the two descriptive fields: selected scope.

## Implementation and Confirmation

Before implementation, record the author's acceptance of the previously explained
policy. Verify parser boundaries and invalid YAML, catalog/selection, metadata
changes, persisted projection tampering, legacy records, and CLI/Ink/GUI output.
Run headers:check, build, and the complete test suite sequentially.

## Follow-up Work

Full Agent Skills conformance, other fields, automatic environment checks and
resource packaging are outside scope. Preserve existing deferred real-model,
Windows and physical-storage trials in the parent ADR.

## References

- [Existing Skill decision](2026-09-09-run-scoped-skill-selection.md)
- [Skill guide](../skills.md)
- [Agent Skills specification](https://agentskills.io/specification)
