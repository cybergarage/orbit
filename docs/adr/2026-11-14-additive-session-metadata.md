---
status: accepted
proposed-date: 2026-11-14
decision-date: 2026-11-14
implementation-status: in-progress
implementation-completed-date: null
implementation-commits: []
superseded-by: []
---

# Additive session metadata

## Purpose

Apply the author's pre-1.0 additive compatibility policy without discarding
conversation history or weakening execution evidence. This decision covers archive,
model selection and title sidecars only. The broader inventory is in
[Internal formats](../internal-formats.md).

## Decision

Use the current required fields as the contract for these three sidecars. Stop
writing a numeric version. Accept the existing `version: 1` tag as an optional
fixed format identifier, never as a migration selector; reject other explicit tags.
Preserve unknown top-level fields across updates. Keep model selection input strict;
preserve additional saved selection fields without interpreting them. Keep title
revisions and operation IDs because they enforce concurrency and idempotency.

Missing sidecars retain their existing defaults. Present invalid records remain
errors. Preserve identity, file bounds, link checks, writer claims, atomic rename
and synchronization. Reject oversized updated records before replacing originals.
No user files are migrated, reset or scanned by this change.

## Consequences

Old tagged sidecars remain readable. Untagged writes may be rejected by older
Orbit code, as authorized by the author. Unknown extensions consume the existing
4 KiB budget, so an update may fail instead of silently dropping them. This does
not complete removal of transcript or journal compatibility machinery.

## Context and Problem Statement

Inspected Orbit `4a36fd5606a9d3a0a07d18a1d746d1a41ee44ed3`, especially
`src/core/session/{archive,model-selection,title,entries,codec,migration}.ts`,
`src/core/execution/{journal,graph-journal}.ts` and
`src/core/projects/sqlite-worker.ts`. The default transcript writer still emits
v1. Journal v3 adds a mandatory project-context acknowledgement before effects.
Dropping those readers is materially destructive and is deferred for author review.

## Decision Drivers

Avoid migration branches for additive metadata; reject corruption; retain unknown
extensions; keep authority and evidence separate from descriptive state.

## External Implementation Research

Inspected on 2026-11-14:

- [Codex protocol.rs](https://github.com/openai/codex/blob/aa380897f67b91e1a47d530d7286d497b6726d3f/codex-rs/protocol/src/protocol.rs),
  commit `aa380897f67b91e1a47d530d7286d497b6726d3f`: optional trace context fields
  use serde defaults. Adopt explicit optional additive fields; do not infer that
  approval or external protocol enums may be discarded.
- [Pi session-manager.ts](https://github.com/badlogic/pi-mono/blob/5fd446ca1843682e8da3fec4ceb71c42f56fbace/packages/coding-agent/src/core/session-manager.ts),
  commit `5fd446ca1843682e8da3fec4ceb71c42f56fbace`: transcript migrations add tree
  identity and rename message roles. This is contrary evidence to indiscriminate
  version removal. Do not adopt its mutating transcript migrations or malformed-line
  skipping for Orbit's evidence stores.

## Considered Options

Removing every version check would admit unknown contracts. Requiring new numbered
metadata would perpetuate unnecessary dispatch. Retaining optional fixed legacy tags
with structural validation provides compatibility without multiple implementations.

## Implementation and Confirmation

Accepted on 2026-11-14 under the author’s explicit implementation request after
reviewing the destructive boundaries above. Pending implementation and compatibility checks. The author explicitly requested
implementation; that request authorizes this bounded decision.

## Follow-up Work

Resolve the destructive compatibility boundaries in the inventory before removing
transcript, journal, storage registration, catalog or legacy log support.

## References

- [Conversation model selection](2026-10-28-conversation-model-selection.md)
- [Internal formats](../internal-formats.md)
