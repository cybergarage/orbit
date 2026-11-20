---
status: accepted
proposed-date: 2026-11-20
decision-date: 2026-11-20
implementation-status: not-started
implementation-completed-date: null
implementation-commits: []
superseded-by: []
---

# Registered storage pairs for live Project memory search

## Purpose

A logical Project may contain Sessions whose transcripts remain at different
original registered storage pairs. A trusted same-process host can supply that
registry to Core without giving a model or an isolated worker access to paths.

## Decision

Add an opt-in repository resolver to the live run-local search path in
[Host-Permitted Session Memory Search](2026-11-20-session-memory-search.md).
Core derives the current Session's Project and revision from the catalog entry
for the Session's verified original recorder/registration pair. It uses that
existing managed lease, never opens another writer for it, and requires host
permission through the existing run-local attachment. The resolver supplies
only Core SessionRepository objects, keyed by Session identity. Unknown and
changed mappings never fall back to another pair.

Source reads use the actual pair recorded in canonical provenance, current
same-Project membership, and exact registered message identity/digest. Capture
the source membership revision for the read and recheck it while the original
source claim is still held. Refuse to displace a source writer. Recheck the
requesting binding and catalog generation before returning. Keep all existing
read/output limits and provider capability rules. This changes neither the
serialized tool schema nor the storage formats.

## Consequences

No default Core application, CLI, GUI, Nest, or explicit-tool behavior changes.
An opted-in host that cannot produce current registered repository mappings or
prove live ownership may get fewer results or a refusal. This is not a remote
resolver, does not bring a catalog or other roots into a worker, and does not
implement App integration, migration, extraction or physical data movement.

## Context and alternatives

At base commit 97eaa64cb4061aaeb9a9b53b6e4f31e3f2fc6f4f, Core's default
ProjectService scopes the requesting Session to its one repository. The legacy
source callback can fall back to that repository and is resolved separately from
its claims. Keep that behavior for existing consumers rather than changing its
meaning or applying strict search to legacy preparation/extraction. Reject
model-provided scope, a frozen snapshot as live authority, resolving to an
unregistered pair, and closing host source writers to make search succeed.

The preceding session-memory ADR pins Codex
fdd89e78ac33f02e65dabe60567cdfeba2e954d4
(`codex-rs/memories/write/src/phase1.rs`) and Pi
95fbc04997eaee961eb673fa7923e9220609ebd5
(`packages/coding-agent/src/core/session-manager.ts`). The applicable existing
lesson is to keep persisted knowledge and the actual Session source distinct.
Neither comparison supplies Orbit's specific registered-pair/current-catalog
ownership protocol; this decision extends that existing Orbit protocol only.

## Not implemented: post-move extraction

Moving a Session retires existing entries linked to that source in the former
Project; live search does not transfer or re-enable them. Treat backfilling
eligible historical turns as a separate proposal. A future implementation
would need a trusted, idempotent transition receipt keyed by the original pair,
Session, run and exact admitted Project/revision/digest plus the destination
Project/revision. Verify the recorded completed run and exact original source
messages; never rewrite historical admission. Revalidate the destination and
retire/revoke on a further move or deletion. Preserve tombstones, budgets and
opt-outs. Use only explicitly eligible messages authored by the user in the
moved Session, not former-Project peer messages, recalled Project knowledge,
tool outputs, summaries or uncertified assistant context. This restriction is
a candidate conservative starting point, not a new extraction policy.

The future test should move one Session between two registered pairs with
different synthetic former-Project peer facts, then verify only its certified
user evidence is eligible for backfill. Cover repeat, restart, concurrent move,
move-back, opt-out, archive/delete, correction and tombstone behavior, including
a run that had loaded former-Project memory. No extraction is authorized by
this read-only search surface.

