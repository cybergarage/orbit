---
status: current
investigation-date: 2026-09-08
orbit-commit: 6a14c1a82fecef409492c74eddc1a2e1d1bd1660
related-adrs:
  - docs/adr/2026-09-08-budgeted-session-compaction.md
  - docs/adr/2026-08-23-session-context-assembly.md
superseded-by: []
---

# Input Budgets and Durable Session Compaction

## Question and scope

A coding agent repeatedly reads files, edits them and receives test output. How
can Orbit continue within a model's input window without losing the original
conversation, outstanding work, or the evidence needed to resume safely?

This is point-in-time research, not adoption or implementation evidence. The
linked proposal concerns one context-preparation contract. Cross-session memory,
retrieval, Skill discovery, Graph changes and evaluation infrastructure are out
of scope. Linux/macOS remain the current verification targets. Previously
recorded Windows, deployment, physical-storage-failure and representative
application trials remain deferred and unverified.

## Orbit baseline and reproduction

Inspected local HEAD: `6a14c1a82fecef409492c74eddc1a2e1d1bd1660`.
The working tree was clean before this proposal. Compared with the book's A14
baseline `8ee97144c20b006225db52efc482004200527e4c`, Agent now integrates managed
Run accounting and journal ownership; Session storage has registration, writer
coordination and deletion integration. These changes must be reused, not
replaced by a separate summarizer runtime.

| Source at the inspected Orbit commit             | Observed behavior                                                                                                                                           |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/session/context-builder.ts`            | Synchronous projection of all conversation messages; copies `contents` but shares nested `payload`. No budget, summary or tool-pair validation.             |
| `src/core/agent.ts`                              | Builds the Session context before each invocation, prepends `this.messages`, passes tool specs separately and charges `modelCalls` through the managed Run. |
| `src/core/models/model.ts`                       | Optional usage on responses; no context-window contract, complete-request estimator or portable output-token limit in `ModelInvokeOptions`.                 |
| `src/core/tokenizer/adapters/gpt-tokenizer.ts`   | String encoding/decoding, not a provider request-size guarantee.                                                                                            |
| `src/core/session/entries.ts`, `codec.ts`        | Transcript version 1 and four entry types; unsupported entry types are rejected.                                                                            |
| `src/core/session/recorder.ts`                   | Queued appends and explicit synchronization; a successful in-memory append alone is not a synchronized checkpoint.                                          |
| `src/core/session/session.ts`, `writer-lease.ts` | Canonical message IDs and verified writer ownership must survive context preparation.                                                                       |

On 2026-09-08, the existing A14 memory-only reproducer was rerun against this
HEAD's built modules on macOS/Node 26.5.0. It asserted all four gaps:

1. A 5,000-fold repeated string is returned intact.
2. An unmatched tool call is returned without rejection.
3. Mutating the projected nested tool input changes the next projection.
4. A `compaction` entry following a valid v1 header is rejected as unsupported.

All assertions passed; this confirms current limitations, not the proposal.
The reproducible script remains in the book's
`books/ai/ai-orbit/analysis/orbit-compaction.adoc`, under the current-behavior
reproduction section. It does not open persistent user storage.

The existing targeted command passed 7 tests:

```sh
TS_NODE_PROJECT=tsconfig.test.json ./node_modules/.bin/mocha --forbid-only --reporter dot test/core/tokenizer/gpt-tokenizer.test.ts test/core/session.test.ts --grep 'GptTokenizer|projects copied|records turn metadata|reopens|round-trips'
```

The earlier full macOS/Linux checks at this same implementation commit passed
441 tests per environment, headers and builds. They were not rerun for this
document-only proposal and do not test compaction. No real-model summarization
quality or provider-specific counting accuracy was measured here.

## External source comparison

The exact revisions below were reused from earlier Orbit research and their
compaction sources were fetched and inspected anew. They are comparison
snapshots, not assertions about the latest release. Source was read, not run.

### Codex

Revision `5adb68a49933ae446bf11935662c83dba55a0804` (`rust-v0.152.1`),
[`codex-rs/core/src/compact.rs`](https://github.com/openai/codex/blob/5adb68a49933ae446bf11935662c83dba55a0804/codex-rs/core/src/compact.rs),
especially `run_compact_task_inner_impl` and `build_compacted_history_with_limit`.

The local compaction path separately constructs a summary request, handles
interruption and budget errors, and replaces active history after summarizing.
Its context-overflow retry can remove the oldest item. Initial-context injection
is explicit; retained user text can be truncated to a separate budget.

**Inference for Orbit:** separate summary preparation from ordinary tool
execution and make restoration of trusted instructions explicit. Do not copy
oldest-item dropping or text truncation as Orbit's default: the book needs to
explain preserved evidence and unresolved operations. This inspection does not
establish remote-compaction durability or all Codex provider behavior.

### Pi Coding Agent

Revision `b79e4cc834970cca69daebffab7df1da7d1e52c4` (`v0.84.4`):

- [`compaction/compaction.ts`](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/src/core/compaction/compaction.ts): `estimateContextTokens`, `findCutPoint`, `generateSummaryWithUsage`, `compact`.
- [`session-manager.ts`](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/src/core/session-manager.ts): `CompactionEntry`, `buildContextEntries`.

Pi combines prior usage with estimates for subsequent messages, keeps recent
context around valid cut points, supports split-turn summaries, and constructs
active context from a summary entry and retained entry IDs. Summary calls have
an output limit and cancellation signal.

**Inference for Orbit:** retain original entries and an explicit checkpoint
boundary; distinguish measurement from estimation. Initially retain the whole
latest user turn instead of adopting split-turn summarization. Do not import
Pi's default token counts as measured Orbit values, or import its session tree
and provider registry as prerequisites.

## Options and non-binding recommendation

| Option                                                                        | Benefit                                                          | Cost or limitation                                                                                       |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Provider rejection followed by oldest-message deletion                        | Small local change                                               | Can destroy tool pairing and evidence; discovers overflow too late.                                      |
| Application-owned summary injected as an ordinary message                     | Reuses v1 messages                                               | Full-history builder still sends old content; each surface would need its own boundary and resume rules. |
| Asynchronous builder that invokes a summarizer                                | One entry point                                                  | Changes the existing synchronous public contract and mixes projection, model work and storage.           |
| Managed preparation followed by pure projection and an append-only checkpoint | Reuses canonical history and Run ownership; deterministic replay | New provider accounting contract, transcript version and explicit migration.                             |

Recommend the last option for review. Its extra contracts are needed because
budgeting only the conversation omits system instructions and tool schemas,
and an in-memory summary cannot explain behavior after process restart.

### Budget evidence and limits

A complete request includes trusted prefixes, selected conversation, tool
schemas, adapter wrappers and supported non-text parts. Response usage is a
measurement of a previous request, not proof that the next request fits. A
string tokenizer is an estimate whose model/provider coverage must be stated.
Unknown model windows or unaccounted modalities must remain unknown.

A caller-supplied model profile and adapter estimate are preferable initially
to an unverified global model registry. Enabled budgeting should fail before
sending if required information is missing. Legacy callers can explicitly
retain unbudgeted behavior during migration; the book application should enable
the profile and report its assumptions. Estimates do not guarantee provider
acceptance. Provider overflow must still stop safely.

### Protected information and limits of summaries

Retain trusted instructions outside the summary, the latest user turn intact,
and complete tool-call/result groups. Reject malformed or unresolved groups
before a model request rather than manufacturing a result. Execution journal
state remains authoritative for approval, side effects and unknown outcomes.

A structured summary can carry goals, changed paths, test evidence and unfinished
work with source message IDs. Schema validation proves shape and provenance
references; it cannot prove semantic completeness. Tests with a deterministic
summarizer prove mechanics only. Real-model preservation and cost evaluation
remain separate, deferred application trials.

### Durable activation and interruption

Keep the transcript as canonical history. A checkpoint references the exact
source prefix, previous checkpoint and retained suffix. Validation and required
synchronization precede activation in the running process. Recovery validates
and re-synchronizes a surviving complete checkpoint before use; it does not
infer that its creator received a success response. A surviving checkpoint
never authorizes an external operation.

Migration must stop old readers/writers and automatic restart sources. The
existing stable Session scope must cover validation, replacement and restart;
renaming the transcript cannot redefine the exclusion scope. Retained guards
and uncertain synchronization still require exclusive maintenance. These
conditions cannot be bypassed to make the new feature easier to demonstrate.

## Open decisions and confirmation needs

The accompanying proposed ADR makes the contract reviewable, including explicit
opt-in profiles, protected whole turns, tool-free summary calls, transcript v2,
exclusive migration and failure behavior. Author adoption is still required.

Implementation must verify provider projection/counting alignment, output-cap
mapping, immutable payloads, repeated checkpoints, cancellation and storage
failure. Inject faults before and after append, sync and migration rename; test
reopen and refusal, not just process timeout. Confirm macOS and Linux behavior.
No existing accepted/partial ADR becomes completed through this research.

## References

- [Proposed budgeted Session compaction](../adr/2026-09-08-budgeted-session-compaction.md).
- [Accepted linear context assembly](../adr/2026-08-23-session-context-assembly.md).
- [Managed Run lifecycle](../adr/2026-09-07-managed-run-lifecycle.md).
- [Prepared operation authorization](../adr/2026-09-07-prepared-operation-authorization.md).
- [Required execution journal](../adr/2026-09-07-required-execution-journal.md).
- [Stable writer recovery scope](../adr/2026-09-08-session-writer-recovery-guard.md).
- [Storage registration](../adr/2026-09-08-session-storage-registration-guard.md).
- Book evidence: `books/ai/ai-orbit/analysis/orbit-compaction.adoc` (A14), `orbit-context.adoc` (A05), `orbit-sessions.adoc` (A06).
