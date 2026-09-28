---
status: accepted
proposed-date: 2026-09-29
decision-date: 2026-09-29
implementation-status: in-progress
implementation-completed-date: null
implementation-commits: []
superseded-by: []
---

# Source-derived Tool Observations in Budgeted Context

## Purpose

Preserve acknowledged edit and command facts when a model-written checkpoint
omits or contradicts them. Keep those observations independently inspectable,
without turning a successful process into proof of correct behavior or relying
on the model to maintain a second copy of operation history.

## Decision

**Accepted by the author on 2026-09-29.** Derive a deterministic observation
view from canonical completed tool results and runtime-owned provenance, then
include that view separately from prose when budgeted context uses a checkpoint.
The source transcript remains authoritative; do not persist a duplicate ledger
or ask the summary model to rewrite the records.

### Observation scope and meaning

Initially recognize the built-in edit/write adapters and generic built-in Bash
process results. A recognized save records path, returned bytes, success/error,
ordering, source request/result IDs and a canonical result digest. Success means
acknowledged save at that operation, not current contents. Preserve the latest
successful save and any later failed save for each represented path.

Commands preserve argv or exact command text as available, exit status, timeout,
output truncation and bounded returned output. Their behavioral coverage and
workspace revision remain unknown. Do not infer edits or test verdicts from
arbitrary command text/stdout. Framework-specific counts remain owned by the
application's dedicated adapter; the evaluation-only pytest/JUnit adapter is not
a new generic core test-verification service.

A request without a completed result is not an acknowledged operation. It also
is not proof that no physical effect happened. Such absence must never authorize
automatic replay. Results from unresolved, duplicate or ambiguous call groups
must not be promoted to acknowledged observations.

### Provenance and persistence

Add optional, versioned runtime provenance alongside the tool-result envelope,
separate from handler-controlled `output.content` and `output.details`. Capture
it from the actual frozen dispatched definition and execution binding, not from
the model's requested name or input. Record adapter revision, source identity,
Run/operation binding and call-group identity sufficient to match the canonical
request and result. A renamed/custom/MCP tool must not gain built-in semantics
by using the name `edit`, `write` or `bash`.

Validate the provenance against the runtime execution record before treating it
as recognized origin. Live memory Sessions can use their runtime-held binding;
persistent/reopened Sessions must use the existing matching journal evidence.
If that evidence is unavailable or inconsistent, retain the original result as
untrusted reported data with unknown origin, not a recognized save. Metadata
alone is not cryptographic authentication and creates no new authorization.
Host-controlled imports and logs remain untrusted model input.

Old messages without this binding remain readable and unchanged. Do not
retroactively infer adapter provenance from names or today's registry. Prefer
additive envelope metadata while keeping existing transcript/checkpoint versions
and canonical bytes intact. Compatibility with old readers/writers, recording,
reopen and source digests is an implementation prerequisite, not an established
fact. If safe additive compatibility cannot be demonstrated, revise this ADR
with an explicit version/migration decision before changing persistent formats.
No silent format upgrade is authorized by this proposal.

### Context and budget behavior

Build the view for the canonical prefix represented by the active checkpoint;
recent complete raw tool groups remain protected under the existing policy.
Correlate chained results through their call group, using request identity plus
call ID; reused call IDs across groups are not a unique key. Keep records in
source order and regenerate the same view after reopen or later compaction.

Include the view as a distinct user-role untrusted-data fragment beside the
checkpoint, before protected recent context. Its wrapper states scope, source
digest, omissions and unknown coverage. It cannot modify instructions,
permissions, tool availability or completion status. Core diagnostics must
expose the deterministic view/omission measurements so evaluations can inspect
facts without asking a model to restate them. Do not add a public observation
query API in this initial scope.

Account for the actual projected view in ordinary request measurements and
summary/recovery feasibility checks using existing capacity profiles. The
summary model may describe source history but never becomes the producer of
canonical observations. Measure the minimum required latest-save records,
protected inputs and output reserve before allocating remaining summary space.
Only then include at most the three latest prefix command records that fit,
with deterministic oldest-first omission and explicit omitted counts. Bound
command output independently and disclose truncation. If mandatory latest-save
records plus protected inputs cannot fit, refuse preparation with a capacity
diagnostic; do not silently drop saves or enlarge the model window. The
prototype's 16,000-byte ceiling is not the production token budget. Existing
cancellation, managed-operation and recording guarantees continue to apply.

This extends the accepted compaction/recovery decisions without replacing their
canonical-history, source validation, protected input or interruption contracts.
It does not add execution/iteration limits or change disabled-budget behavior.

## Consequences

- Positive: acknowledged operations survive faulty prose; deterministic
  consumers can inspect source-backed facts directly, and legacy ambiguity
  remains explicit.
- Negative: provenance capture and validation cross execution, transcript and
  context assembly. Additional input costs tokens; many changed paths can make
  preparation refuse. Imported/legacy records may have less recognized detail.
- Neutral: accurate records do not guarantee correct model interpretation or
  successful code changes. Current workspace contents, test coverage and
  correctness require separate inspection and independent grading.

## Context and Problem Statement

At inspected core baseline `1be53b4effb0f4b1c10849660f1d6c40f9340e97`,
`createToolResultMessage` stores request/result data but no dedicated runtime
origin binding. `ToolRegistry` snapshots and prepared operations know source
identity. Built-in edit/write return details after atomic writes; Bash reports
process status rather than test semantics. Session append creates a parent chain
through successive results; a result's immediate parent need not be the call
message. `checkpointPrefix` projects untrusted summary prose and protected user
references while leaving canonical history intact.

The evaluation-only prototype at
`a86f1b60d8b095dc6c95f8bca92df543260d5b77` and
`36832127a3a957e1f39fb1ffc93d0ce378eec153` recovers edit/selection facts from a
controlled public history. With one frozen stale checkpoint, model-consumer
success changes from 0/3 to 3/3. With a second overclaiming checkpoint from the
same source, both conditions remain 0/3: zero-test selection becomes coarse
`failed`, with an additional misspelled answer key in the record condition.
All twelve answers report behavior unverified. This is not a summarizer rerun or
new SWE-bench grade; extra information and same-seed repetitions limit inference.

The latter result is why preserving records and consuming them programmatically
is part of the proposal. Another prompt-only revision would not provide that
invariant. Controlled-fixture name matching must not be copied into core.

## Decision Drivers

- Preserve observed facts independently of probabilistic prose.
- Distinguish intent, completed acknowledgement, current workspace and verified
  behavior; do not upgrade uncertainty into success.
- Bind provenance to actual execution across live, recorded and reopened context.
- Keep one canonical operation source with deterministic derivation and bounded
  model input.
- Preserve existing cancellation, authorization, migration and recording rules.
- Make missing/omitted facts and model-consumer failures independently measurable.

## External Implementation Research

Investigated on 2026-09-29 by reading pinned primary source, without executing
either external system.

**Codex**, `aa380897f67b91e1a47d530d7286d497b6726d3f`:
`codex-rs/core/src/compact.rs` builds compacted summary history and separately
reinserts initial context with world-state baseline handling.
`codex-rs/core/src/context/compaction_summary.rs` represents summary text as a
user contextual fragment. Adopt separate regeneration of canonical context;
do not infer that these files implement save acknowledgement or test verification.

**Pi Coding Agent**, `5fd446ca1843682e8da3fec4ceb71c42f56fbace`:
`packages/coding-agent/src/core/compaction/utils.ts` extracts file paths from
assistant tool-call requests; `compaction.ts` carries structured file lists and
appends them to summary text. Adopt retaining deterministic structured data;
reject treating requested write/edit paths as confirmed saves. The inspected
extractor does not check completed results for success.

The [research note](../research/2026-09-29-structured-tool-observations.md)
records precise source links, Orbit symbols, contrary evidence and limitations.
These comparisons inform design; they do not prove Orbit's safety or performance.

## Considered Options

| Option                                         | Assessment                                                                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep refining summary instructions             | Low integration cost, but prior trials failed overall and cannot guarantee preserved facts. Keep summaries for prose, not canonical observations. |
| Send all original history indefinitely         | Avoids projection loss but does not fit bounded context; the model can still misinterpret facts.                                                  |
| Persist a second observation ledger            | Simple direct lookup, but duplicates truth and introduces synchronization/recovery obligations. Not selected.                                     |
| Derive a separate view with runtime provenance | Selected proposal: retains canonical source and permits deterministic consumption; requires provenance, compatibility and budget work.            |
| Infer tests/edits from arbitrary Bash output   | Broad apparent coverage but confuses process output with trustworthy state and behavioral verification. Rejected.                                 |

## Implementation and Confirmation

Core implementation is **in progress**. The author explicitly approved this ADR
and requested implementation with staged commits on 2026-09-29.
The evaluation-only prototype and result commits are not ADR implementation
commits. Implement after acceptance in the following phases, committing each:

1. Capture and validate built-in result provenance with existing execution
   binding. Test custom/MCP names, reused IDs, chained groups, duplicates,
   cancellation after dispatch, missing acknowledgement and reopened records.
2. Derive observations and integrate the measured checkpoint view. Test reedit,
   failed later saves, stale tests, external changes remaining unknown, source
   digest/order, retained user inputs, overflow/omissions and Session isolation.
3. Update maintained architecture/concepts and E2E instructions; extend the
   diagnostic to inspect deterministic views directly, retaining separate
   model-consumer scores. Verify format compatibility before writing new metadata.
4. Repeat both frozen-checkpoint trials with the real model. Then rerun one
   ARM64-compatible official SWE-bench problem with isolated solver/grader
   environments and reference-patch grading control. Report environment errors,
   execution errors and unresolved problems separately; no gold/hidden grading
   information goes to the solver.

Pass conditions are exact preservation/provenance, bounded measured input and
safe lifecycle behavior, not necessarily model-consumer or SWE-bench success.
Run `headers:check`, `build`, `test`, affected E2E host tests and independent
observation tests. Acknowledge runtime source facts through diagnostics without
claiming that a model's answer verifies them. ADR completion needs actual core
commits, maintained documentation and these confirmation records.

## Follow-up Work

The author approved the provenance/persistence and context behavior on
2026-09-29. During implementation, resolve envelope schema details
within this scope and demonstrate old-reader/writer behavior. If that requires
an incompatible format or broader API, revise the proposal before that change.

Broader test adapters, public observation APIs, filesystem/revision attestation,
custom/MCP adapter registration, full benchmark evaluation and training are not
included. They require separate evidence and, where architectural, decisions.

## References

- [Research and primary source links](../research/2026-09-29-structured-tool-observations.md)
- [Comparison results and reproduction](../../e2e/results/2026-09-29-context-observations.md)
- [Individual records](../../e2e/results/2026-09-29-context-observations.json)
- [Budgeted Session Compaction](2026-09-08-budgeted-session-compaction.md)
- [Long-Turn Context Recovery](2026-09-25-long-turn-context-recovery.md)
- [Verified Interrupted Tool Context](2026-09-14-verified-interrupted-tool-context.md)
- [Tool registry](../../src/core/tools/registry.ts)
- [Result recording](../../src/core/agent.ts)
- [Session context policy](../../src/core/session/context-policy.ts)
- [Session checkpoint projection](../../src/core/session/compaction.ts)
- [Session codec](../../src/core/session/codec.ts)
