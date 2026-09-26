---
status: accepted
proposed-date: 2026-09-25
decision-date: 2026-09-25
implementation-status: completed
implementation-completed-date: 2026-09-25
implementation-commits:
  - b738be87592422aac2899f33a529c2a2fb63d50a
  - 24c3abc14b2f3ba2f2a2af6067d970e46bd861c8
  - 301a0aefe4035f2346bab47e5ef07d477e13aec3
  - f47fe3a910bbdf92a81af3015764a3acd74c68fb
superseded-by: []
---

# Long-Turn Context Recovery

## Purpose

Prevent truncated generations from masquerading as completed tasks and allow
long coding turns to continue after safe, measured context reduction. The author
requests four sequential, tested implementation commits: termination checks,
within-turn compaction, capacity-backed regeneration, and truthful test failures.

## Decision

Reject incomplete model responses before appending assistant messages or
executing any returned tool call. Preserve provider diagnostics and a typed
failure; absent stop metadata remains compatible with custom Models. Length,
max_tokens and context-window stops are recoverable only through the bounded
context recovery described below. Refusal/filter/pause stops are not completion.

Allow budgeted preparation to summarize completed tool rounds inside the current
turn. Keep original user instructions verbatim, trusted prefixes, the newest
complete tool group and unresolved work. Never split a call/result group. Keep
canonical history intact. Introduce checkpoint projection version 3 with explicit
retained user references, validate its exact boundaries and source digests on
save/reopen, and reject unsupported checkpoints in older readers. Existing
projection versions remain readable; transcript versions remain unchanged.
Verified interruption retains its v3 transcript/provenance requirements. Graph
turn user inputs remain protected across stages.

Provide capacity-derived profiles rather than hard-coded model windows. The
book E2E harness enables this budgeted policy. Disabled budgeting and explicit
storage migration requirements remain unchanged for existing applications.

A generation that fails with a classified context/truncation error may regenerate
once after forced compaction has produced a strictly smaller prepared request.
No fallback to the old input is allowed for recovery. Capacity failures, invalid
summaries, pending operations, cancellation or recording failures stop recovery.
No repair or execution of partial tool JSON occurs. Tool operation failures never
enter model regeneration. Provider-specific error classification belongs to the
adapter and must exclude authentication, rate limits and generic server errors.

Run Bash with pipefail so a failing check piped through a log filter remains an
error. Provide accurate command status to the model and preserve failure evidence
in summaries. Do not infer test success from arbitrary text or treat a model's
completion as independent verification. Explicit shell error suppression remains
possible and must be documented rather than guessed away.

Accepted on 2026-09-25 under the author's explicit implementation and staged
commit request. Review confirms bounded recovery, preservation of tool groups
and original instructions, and explicit old-reader incompatibility. This narrows
the earlier compaction decision's whole-current-turn protection to verbatim user
inputs and complete recent tool groups; its recording and migration rules remain.

### Shell failure propagation refinement (2026-09-25)

Accepted during the requested staged implementation: pipefail alone does not
preserve failure in `npm test | tail; echo done`. Start Bash with both errexit
and pipefail, so ordinary unhandled failures stop the command list. Explicit
conditional handling (`if`, `||`) and shell option overrides remain possible.
This extends the original pipeline decision to the observed trailing-command
case; it does not infer a test verdict from output text. Book summaries label the
combined independent checks as checks, not as a browser-only verdict.

### Bounded summary batching refinement (2026-09-26)

Accepted under the author's request to repair the full-context book failures.
When the entire eligible summary source exceeds the summary input budget, split
it at complete tool-group boundaries and summarize consecutive batches. Feed
each validated intermediate summary into the next batch; keep intermediate
summaries in memory and activate only one final checkpoint after the ordinary
request is measured to fit. Every batch uses the same model, output cap, Run
budget, cancellation and source-ID validation. A single oversized group, an
invalid intermediate summary or an unfit final projection stops safely. The
canonical transcript and checkpoint format remain unchanged.

The 2026-09-25 book retest at model context 262,144 reached
`compaction-input-exceeds-budget` in SDD after 293 model calls. The earlier
pinned Codex and Pi comparisons support bounded compaction and single recovery
after an actual reduction; neither provides a reason to split a tool call from
its results or to persist unverified intermediate summaries. This refinement
extends the previously recorded follow-up without changing those boundaries.

## Consequences

Long turns can release context without losing original user instructions or
splitting tool evidence. Summary generation costs extra calls and remains lossy;
canonical evidence stays available. A giant single tool result, protected user
input or summary source can still exceed capacity and stops safely. New version-3
checkpoints are forward-incompatible with older readers. Pipefail changes shell
pipeline status, including legitimate SIGPIPE cases; callers can handle expected
nonzero status explicitly. No unlimited retry loop is introduced.

## Context and Problem Statement

Orbit at eb9f313 has provider capacity discovery but still completes tool-free
length responses and protects entire active turns. Book trials at 32K filled the
window; two surfaced incomplete Ollama tool-argument JSON and one completed with
a length stop. Bash pipelines masked failing tests. See the linked investigation
for controlled replay evidence and its limitations.

## Decision Drivers

- Preserve truthful completion and operation evidence.
- Continue long tasks only after actual capacity recovery.
- Retain original user constraints and durable replay validation.
- Keep retries finite even with unlimited aggregate Run budgets.

## External Implementation Research

Re-inspected on 2026-09-25 at pinned revisions. Codex
`aa380897f67b91e1a47d530d7286d497b6726d3f`,
`codex-rs/core/src/session/turn.rs`, checks context thresholds after sampling and
finished tools and can compact before continuing. Adopt the completed-round
boundary, not its persistence system. Pi
`5fd446ca1843682e8da3fec4ceb71c42f56fbace`,
`packages/coding-agent/src/core/agent-session.ts`, classifies context overflow
and recoverable length stops and limits overflow recovery to one compact/retry.
Adopt bounded regeneration after reduction, not transcript mutation or zero as a
usable capacity. Ollama `6383a0fa9cbf97494b847226e189f6e36b401a08`,
`llm/llama_server.go`, can report incomplete tool JSON before final usage metadata.
This permits classifying only its specific incomplete-arguments error, not every
HTTP 500. The previous capacity and failure investigations contain the pinned
source links and observed evidence; none demonstrates full book-task success.

## Considered Options

1. Increase all context windows to the model maximum: ignores RAM/runtime limits.
2. Drop oldest messages or split tool groups: loses constraints and operation evidence.
3. Retry unchanged input or repair partial JSON: repeats exhaustion or invents actions.
4. Validated checkpoints, retained instructions and one reduced-input retry: selected.

## Implementation and Confirmation

Completed in the four implementation commits above, in the requested order.
Termination tests cover truncated responses before history append or tool
execution. Long-turn tests cover repeated compaction, exact user preservation,
complete tool groups, persisted reopen and tamper rejection. Regeneration tests
cover strict request reduction, one retry, exhausted budgets, cancellation,
summary failures and unrelated provider errors. Shell tests cover failing
pipelines, trailing commands and explicit conditional error handling.

At the final implementation revision, `npm run headers:check`, `npm run build`
and `npm test` passed (1,010 tests), followed sequentially by the E2E host tests
(16) and book fixture tests (7). During stage three, one existing recovery
process-death test timed out while 1,003 tests passed; its full isolated suite
then passed (25 tests). The final full suite also passed that case. No live model
book matrix or browser grader control run was performed for this implementation;
these deterministic results do not establish book-task success or summary fidelity.

Maintained behavior is documented in the compaction, tools, architecture and E2E
guides. The earlier whole-active-turn boundary is superseded only as described
above; canonical history, verified interruption and migration requirements remain.

## Follow-up Work

Representative live book trials and summary-quality assessment remain distinct
from deterministic runtime validation. Chunked summarization of a single
oversized source is not included. Automatic activation for existing stored
sessions would require a separate migration/adoption decision.

## References

- [Book failure investigation](../research/2026-09-25-book-workflow-context-exhaustion.md)
- [Model capacity decision](2026-09-25-model-context-capacity.md)
- [Budgeted compaction](2026-09-08-budgeted-session-compaction.md)
- [Input budgets](../context-compaction.md)
