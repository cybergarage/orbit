---
status: accepted
proposed-date: 2026-11-14
decision-date: 2026-11-14
implementation-status: in-progress
implementation-completed-date: null
implementation-commits: []
superseded-by: []
---

# Structural log reading

## Purpose

Preserve existing log partitions while replacing numbered reader dispatch with a
shared structural reader. The author requested backward-compatible alternatives
following the merged additive sidecar work. This scope does not migrate user data.

## Decision

Validate shared log identity, timestamp, level, message and fields once. Recognize
current records by the presence of current structural fields: category, correlation
or eventType. Require all three to be valid; do not downgrade partial current records
into historical records. Historical records instead project their flat correlation
and event type into the current shape in memory. Missing outcome stays missing.
Retain unknown fields and nested JSON without interpreting them as authority.

Keep current writes and normalized public records at the existing fixed `version: 2`.
Tagged historical records retain their established `1` identifier. Tags are optional
on read. Explicit unknown tags reject; a `2` tag cannot use historical fallback.
A historical `1` tag is retained to disambiguate legacy extensions named category,
correlation or eventType. Those names cannot distinguish damaged current data from
historical extensions by structure alone. Preserve such original records under
`fields.historicalRecord` while projecting canonical fields. This narrow ambiguity
rule is necessary for backward compatibility; do not claim all tag checks removed.
Do not rewrite, reset, back up or automatically migrate files.

## Consequences

Mixed existing partitions and opaque cursor positions remain usable. Tagless
additive records become readable. Malformed current records remain errors rather
than acquiring fabricated correlation or event types through a historical fallback.
Noncolliding unknown fields survive normalization; historical collisions are retained
in the original-record extension instead of being discarded. Flat historical correlation remains supported as a small compatibility
projection, not as a second independently validated numbered schema.

## Context and Problem Statement

Inspected Orbit `f71ca604cac978be0c575c0be6a96c86a207a1b3`,
`src/core/logs/{records,file-store,session-logger}.ts` and `test/core/logs.test.ts`.
`readPartition` fails the entire query on one unsupported record, so deleting its
historical normalizer would make mixed partitions unreadable. Current writes emit
version 2. Transcript v1 remains the default; journal versions encode differing
execution evidence; SQLite catalog v1 lacks automation/extraction tables. Those
stores cannot adopt this descriptive-log projection without a separate design.

## Decision Drivers

Retain historical access, avoid silent corruption recovery, preserve extensions,
keep stable writes and cursor offsets, and avoid modifying real data.

## External Implementation Research

The 2026-11-14 pinned source investigation in
[Additive session metadata](2026-11-14-additive-session-metadata.md#external-implementation-research)
inspected Codex `aa380897f67b91e1a47d530d7286d497b6726d3f`,
`codex-rs/protocol/src/protocol.rs`, and Pi
`5fd446ca1843682e8da3fec4ceb71c42f56fbace`,
`packages/coding-agent/src/core/session-manager.ts`.
Codex's defaulted optional trace fields support additive structure; adopt explicit
optional fields without treating absent evidence as success. Pi's tree/role
migrations show that historical structures can have semantic differences; retain
Orbit's small descriptive projection but do not copy mutating transcript migrations
or malformed-line skipping. Neither comparison proves an execution-evidence
migration safe, so this decision remains limited to operational logs.

## Considered Options

Deleting historical support breaks mixed partitions. Automatic migration creates
new write/ownership and failure boundaries without a read requirement. Continuing
number-dispatched duplicate validators perpetuates the original problem. A common
validated reader with a structural projection preserves both data and fixed writes.

## Implementation and Confirmation

Accepted on 2026-11-14 after reviewing mixed-partition failure and unchanged
write semantics. The first independent review found that stricter optional usage validation rejected
values emitted by the unchanged writer, and structural name collisions rejected
previously readable tagged historical records. Preserve the existing optional-field
acceptance contract, add a real writer-to-file-to-reader regression and retain the
historical tag for that ambiguity. Current required-field validation remains intact.
Pending implementation validation. The author's explicit request authorizes implementation of this bounded
backward-compatible alternative.

## Follow-up Work

Transcript, checkpoint and journal readers still need evidence-aware compatibility.
An automatic SQLite migration already preserves old catalog data; removing it is
not a substitute for additive evolution. Storage binding authority must remain intact.

## References

- [Internal formats](../internal-formats.md)
- [Session logging](../logging.md)
