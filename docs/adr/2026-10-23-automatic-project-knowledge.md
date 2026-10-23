---
status: accepted
proposed-date: 2026-10-23
decision-date: 2026-10-23
implementation-status: completed
implementation-completed-date: 2026-10-23
implementation-commits: []
superseded-by: []
---

# Automatic Project Knowledge

## Purpose

Carry durable decisions, constraints, explicit corrections and verified facts
between conversations in the same logical Project without requiring manual
registration, selection or confirmation.

## Decision

Use typed extraction jobs and cumulative token reservations in the existing
Project catalog. Reconcile acknowledged completed, quiescent execution journals
at startup and periodically. A run-completed observer is only a wake-up hint.
Only runs with an admitted Project snapshot and matching membership revision
are eligible; do not backfill historical transcripts with unknown membership.

Capture bounded source messages under session ownership, release ownership
before model inference, and revalidate source digests and membership before
applying one atomic catalog mutation. Use stable IDs for jobs and candidates.
Reserve a maximum input/output allowance before every attempt, including retries;
crashes retain reservations. Bound attempts, input, output, time and cumulative
Project usage. Extractors receive no tools. Suppress apparent credentials before
inference and persistence. Output is evidence-bound data, never authority.

Use deterministic request relevance (including Japanese bigrams), validity,
importance and whole-entry token budgets in the existing snapshot path.
Persist the exact snapshot before effects and retain it during recovery.
Retirement is a tombstone. Manual edits and disabled Projects take precedence.
Weak contradictions remain pending rather than silently replacing facts.

The desktop host owns durable processing. Disposable workers receive frozen
snapshots and return source/run evidence; storageProjectId never defines memory
scope. A local unpublished package must be explicitly pinned for integration
validation; no public publication is authorized.

## Consequences

Normal answers do not wait for extraction. New conversations may legitimately
precede a pending extraction and retain their original snapshot. Token limits
are conservative reservations, not a monetary guarantee. Lexical retrieval has
limited semantic recall. Model evidence validation reduces fabrication but does
not establish factual truth. Secret detection is intentionally conservative and
cannot guarantee detection of every secret.

## Context and Problem Statement

Baseline: Orbit `9298ca54b6929a6aa84ad8aa103a7f79ed1d541f` and orbit-app
`6ce3c7aae72faaa7e99776eb6b1e34db7a0553b8`. The core has curated snapshots,
source digests, transactional operation replay and a WAL/FULL SQLite catalog.
The app uses disposable workers and logical Projects distinct from storage
locations. DurableWorkStore is not a second knowledge database.

## Decision Drivers

Preserve data, isolation, source traceability, immutable execution evidence,
manual control, bounded inference and crash-safe replay. Keep all migrations
additive and transactional, with no backup or relocation copies.

## External Implementation Research

Inspected on 2026-10-23, supplementing the pinned
[retrieval investigation](../research/2026-09-24-memory-retrieval-and-consolidation.md):

- Codex `fdd89e78ac33f02e65dabe60567cdfeba2e954d4`,
  `codex-rs/memories/write/src/phase1.rs`: claims eligible jobs, uses bounded
  startup selection, records token usage and sanitizes source. Adopt persisted
  job accounting; do not copy global consolidation into Project scopes.
- Pi `95fbc04997eaee961eb673fa7923e9220609ebd5`,
  `packages/coding-agent/src/core/session-manager.ts`: keeps versioned session
  entries and distinguishes extension state from context-bearing messages.
  Adopt explicit provenance and context boundaries. That inspected file is not
  evidence of an automatic cross-session extraction pipeline.

These are source inspections, not comparative quality evaluations.

## Considered Options

Reject fire-and-forget worker inference because workers terminate. Reject
observer-only enqueue because callback failure/crash can lose work. Reject a
second ad hoc memory store because it splits transaction authority. Reject
unbounded model consolidation and unconditional conflict replacement.

## Implementation and Confirmation

User delegated design acceptance and implementation on 2026-10-23. Reviewed
against the requirements above and accepted. Implementation was initially kept
uncommitted because commits and public operations were prohibited. The later
explicit request to create Core and app pull requests authorizes feature-branch
commits and pushes. No merge, release or deployment is authorized. The separate
implementation-evidence commit records the implementation hash after it exists.

## Implementation Confirmation

Core and desktop integration use the catalog and existing journal input path.
The desktop coordinator leases canonical original storage pairs. A source-only
PID namespace gives helpers observable distinct PIDs for normal dead-writer
recovery; it never shares host or execution-worker namespaces or removes unknown
writer evidence. Enqueue atomically caps retryable unfinished jobs at 32. Final
apply rechecks the completed journal, exact admission digest, source and current
membership; rejection persists discarded state and reported usage. A stopped Project can
settle already-reserved failed/discarded usage, but cannot enqueue, start or apply
knowledge. Oversized input is discarded before reserving a call.

Deterministic tests cover A-to-B reuse, cross-storage logical moves, restart,
actual helper death/reacquire, window closure, archive/restore, tombstones,
correction, simultaneous enqueue, four process-death boundaries, transaction
rollback, schema migration/interruption, initialization modes, invalid output,
usage discrepancies and budgets. The application feature guide maps scenarios
to their tests. Full-suite logs and artifact hash accompany the review result;
they are not substituted with prior baseline passes.

A separate local `gemma4:12b` synthetic trial passed through actual Supervisor,
disposable Agent A, completed journal, host tool-free extractor, catalog,
frozen snapshot and disposable Agent B. Two ordinary calls plus one extraction
learned a decision and constraint, excluded a tentative Redis idea, and reused
both revision-1 entries in B. Reported extraction usage was 427 input / 166 output
versus a retained reservation of 4096 / 1024. Earlier two exploratory calls were
separate from this actual-path trial. This single synthetic case does not establish
broad factual, correction or multilingual model quality.

## Follow-up Work

No deployment, public package release or user-data migration was performed.
Operators must review unknown ownership after catastrophic source-namespace loss;
normal helper death is covered by canonical recovery. Semantic retrieval,
comprehensive secret detection and broad extraction-quality evaluation are beyond
this lexical/evidence-bound implementation. Provider prices remain unknown;
reservations and call limits are not monetary billing guarantees.

## References

- [Project memory decision](2026-09-22-project-memory-context.md)
- [Codex source](https://github.com/openai/codex/blob/fdd89e78ac33f02e65dabe60567cdfeba2e954d4/codex-rs/memories/write/src/phase1.rs)
- [Pi source](https://github.com/badlogic/pi-mono/blob/95fbc04997eaee961eb673fa7923e9220609ebd5/packages/coding-agent/src/core/session-manager.ts)

## Independent Review Corrections

The first review found stranded desktop backlog after a bounded batch, missing
wakeups on resume/budget edits, title-only conflict holding, catalog-prefix
comparison truncation and default limit values overwriting saved Project limits.
These were correctness gaps despite the earlier successful tests. The host now
continues bounded batches and retry backoff through its owned wakeup and idle
lifecycle. Related comparison targets are ranked across all active entries and
packed within the existing input cap. Untargeted corrections are pending, and
lexical evidence of competing knowledge can hold differing titles. The form
restores saved values on each Project's first load and preserves drafts on refresh.

Dedicated regressions cover six pre-existing pending jobs without manual kicks,
transient failure, resume/limit wakeups, natural correction messages without IDs,
related targets beyond item sixteen, and UI restart/switch/one-limit edits.
Lexical conflict screening remains conservative and incomplete: shared generic
terms can hold compatible knowledge and paraphrases with no shared vocabulary
can escape detection. This is not a claim of complete semantic consistency.
