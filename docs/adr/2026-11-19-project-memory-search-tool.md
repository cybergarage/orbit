---
status: accepted
proposed-date: 2026-11-19
decision-date: 2026-11-19
implementation-status: partial
implementation-completed-date: null
implementation-commits: []
superseded-by: []
---

# Opt-in Project Memory Search

## Purpose

Validate cross-session recall in Core before Nest integration (Orbit #39).

## Decision

Expose a separately constructed read-only tool and service search method over
canonical Project memory. The host binds both Project and destination Session;
model arguments contain only a bounded query and result limit. Revalidate the
binding on every call. Reuse source validation, lexical ranking and whole-entry
budgets, suppress zero-overlap results, and return entry revisions and available
source IDs. No implicit registration, transcript ingestion, extraction activation,
MEMORY.md loading, or unrelated tools. Search does not persist a context capture.
Returned text is untrusted evidence, never instructions or authorization.

## Consequences

No storage format or default runtime behavior changes. Retrieval cannot recover
facts absent from stored entries. Lexical matching is inexpensive and explainable
but has limited semantic recall. Source validation may refuse busy sources. A
snapshot describes one generation; later calls re-read corrections and tombstones.
The host remains responsible for tool capability, total request budgets and model
selection. Apple text-only adapters remain unsupported for model tool invocation.

## Context and Problem Statement

Baseline c120f125a81a7ac5fcb1b277b5c8bbd4cdc94315 already provides source-validated
memory preparation and custom tool dispatch. A prepare snapshot is not a
model-callable search; it also fills spare capacity with unrelated notes.

## Decision Drivers

Explicit opt-in, host-owned scope, provenance, bounded output, no answer leakage,
and independent deterministic versus live-provider evidence.

## External Implementation Research

The accepted automatic-knowledge ADR and its linked retrieval study inspect
Codex fdd89e78ac33f02e65dabe60567cdfeba2e954d4
(`codex-rs/memories/write/src/phase1.rs`) and Pi
95fbc04997eaee961eb673fa7923e9220609ebd5
(`packages/coding-agent/src/core/session-manager.ts`). Reuse their recorded
lessons about bounded knowledge and separation of stored state from transmitted
context. This extension does not adopt global memory files or introduce a new
retrieval architecture; no comparative quality claim follows from those studies.

## Considered Options

Reject automatic tool registration and model-supplied Project IDs. Reject a
parallel memory store. Defer embeddings and transcript-wide search until the
canonical-memory baseline is measured. Keep pre-retrieval and tool retrieval as
separate evaluation arms with identical stored entries.

## Implementation and Confirmation

The user explicitly requested the Issue #39 contract and implementation on
2026-11-19. The bounded additive design above was reviewed against that request
and accepted before implementation. The initial work was kept uncommitted. The user subsequently authorized a
scoped commit, push and Draft PR for Issue #39. This record does not claim
qualification of production ingestion or official benchmark accuracy.

## Follow-up Work

Report pilot coverage and missing provider measurements independently. Production
ingestion, Nest wiring, automatic extraction and total prompt budgeting are out
of scope.

## References

- https://github.com/cybergarage/orbit/issues/39
- https://github.com/cybergarage/orbit-nest/issues/21
- [Automatic knowledge](2026-10-23-automatic-project-knowledge.md)
- [Retrieval investigation](../research/2026-09-24-memory-retrieval-and-consolidation.md)

## Local confirmation — 2026-11-19

The Core implementation passes 1,396 full-suite tests, including ten
search controls, and five separate evaluation integrity checks. A 30-case local
pilot completed all 90 arms; syntax-only grading retries preserve original
errors and do not change generation. See the [recorded results](../../test/evaluation/results/README.md).
The live synthetic check confirms actual dispatch and expected provenance, while
showing that final prose citations are model-dependent. This does not approve
Nest integration or establish official benchmark accuracy. Commit-linked finalization remains deferred while rubric-aligned evaluation and
retrieval audit follow-ups remain open; publishing a Draft PR does not complete
that qualification.
