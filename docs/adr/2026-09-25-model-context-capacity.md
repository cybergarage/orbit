---
status: accepted
proposed-date: 2026-09-25
decision-date: 2026-09-25
implementation-status: completed
implementation-completed-date: 2026-09-25
implementation-commits:
  - 99a0b57517032458b0bef5916081f64072d64c9e
superseded-by: []
---

# Model Context Capacity Discovery

## Purpose

Determine usable model capacity from provider metadata and actual runtime
configuration rather than assuming the declared model maximum is active.

## Decision

Add an optional provider-neutral model information method and a public capacity
resolver. Keep shared context, independent input/output limits, and runtime
context separate. Unknown limits remain null. Explicit runtime configuration
can override a server default, but cannot widen a known model maximum. A budget
profile is an additional ceiling, never permission to enlarge a known runtime.

Ollama reads show metadata and running-model context. Explicit context settings
are serialized as num_ctx; budgeted requests pin the resolved window so accounting
and invocation agree. Anthropic reads Models API token limits. OpenAI uses an
exact-ID catalog of official specifications with dated provenance; unknown IDs
have no guessed family fallback. Provider failures fall back only to explicit
configuration, and discovery has bounded waits and cancellation. No global cache
is introduced: loaded contexts and aliases can change.

Budgeted preparation reconciles its profile with discovered limits, lowering
thresholds when necessary. Disabled budgeting stays disabled. This change does
not implement within-turn compaction or repair truncated tool arguments.

The author explicitly requested metadata/configuration reconciliation and an
officially sourced OpenAI catalog on 2026-09-25. Review confirms that the
provider boundaries, unknown fallback and opt-in budgeting preserve the existing
contracts. The decision is accepted before implementation; no commit is created
because this request does not authorize commits.

## Consequences

The framework can distinguish a model maximum from an active smaller window.
Metadata introduces read-only requests during budgeted preparation. Missing API
fields, unloaded Ollama models, and custom transports can leave capacity unknown.
Explicit configuration remains an operator assertion, not a token-count oracle.
Catalog entries require maintenance; all-model name heuristics are avoided.

## Context and Problem Statement

At Orbit 03753d8c9e26b0c3632bda3fe9659eef8288f6c4, ContextProfile.window is
entirely manual. Ollama request options in the E2E transport are invisible to
core accounting. The book trial used num_ctx=32768 while show metadata declared 262144. The installed Anthropic SDK retains response JSON but its ModelInfo
TypeScript interface does not yet declare the current optional token fields.
Read and validate those fields without updating unrelated dependencies.

## Decision Drivers

- Respect the author's requested metadata-first capacity resolution.
- Preserve explicit smaller runtime settings and unknown values.
- Keep provider serialization at the adapter boundary and tests offline.
- Preserve opt-in compaction and existing transcript compatibility.

## External Implementation Research

Inspected on 2026-09-25. Codex revision
`aa380897f67b91e1a47d530d7286d497b6726d3f`,
`codex-rs/core/src/session/turn.rs`, reads old/new model context windows and
compaction limits when switching to a smaller model. Adopt model-specific
capacity checks, not its complete runtime or persistence behavior.

Pi revision `5fd446ca1843682e8da3fec4ceb71c42f56fbace`,
`packages/coding-agent/src/core/agent-session.ts`, uses model.contextWindow for
usage and compaction decisions and returns unknown usage after compaction until
new usage is available. Adopt explicit unknown accounting, not zero as a usable
capacity nor its entire compaction policy. These files do not establish a
portable discovery endpoint; provider API documentation supplies that contract.

Official Ollama show/ps documentation distinguishes model information from
loaded runtime context. Anthropic Models API exposes nullable max_input_tokens
and max_tokens. OpenAI Models API does not expose context limits; official model
pages supply the catalog values. Specifications were checked on 2026-09-25.

## Considered Options

1. Keep manual profiles only: misses discoverable runtime constraints.
2. Use the model maximum as runtime capacity: incorrect for smaller Ollama loads.
3. Infer every model family from a prefix: risks assigning limits to unrelated,
   fine-tuned, or future models.
4. Metadata plus explicit configuration and an exact OpenAI catalog: selected.

## Implementation and Confirmation

Implemented in `99a0b57517032458b0bef5916081f64072d64c9e` and validated
on 2026-09-25. The public
resolver, provider metadata methods, settings, exact OpenAI catalog, budgeted
preparation, and E2E transport precedence are covered by deterministic tests.
The author subsequently requested commits. The accepted decision and supporting
research were recorded first, followed by the implementation commit above. This
later documentation change records completion without changing the accepted
rationale or claiming the separately deferred work is complete.

Validation:

- `npm run headers:check` and `npm run build` passed.
- `npm test`: 964 passed; six GUI tests failed only on sandbox `listen EPERM`.
  Re-running those six with loopback permission passed, covering all 970 tests.
- E2E host unit tests: 16 passed; book fixture tests: seven passed.
- Read-only local Ollama verification returned model capacity 262144, configured
  runtime 32768, and input budget 28416 after output reserve 4096 and margin 256.
  No generation or full book workflow was run for this change.

Maintained contracts are in [model capacity](../model-context-capacity.md),
[input budgets](../context-compaction.md), [settings](../settings.md),
[current architecture](../architecture.md) and the [glossary](../concepts/glossary.md).

## Follow-up Work

Within-turn compaction, truncation recovery, and automatic budgeting activation
remain separate work. Capacity discovery alone does not establish book-task
success.

## References

- [Input budgets](../context-compaction.md)
- [Book failure investigation](../research/2026-09-25-book-workflow-context-exhaustion.md)
- [Ollama show](https://github.com/ollama/ollama/blob/6383a0fa9cbf97494b847226e189f6e36b401a08/docs/api.md#show-model-information)
- [Ollama loaded models](https://docs.ollama.com/api/ps)
- [Anthropic Models](https://platform.claude.com/docs/en/api/typescript/models)
- [OpenAI Models](https://developers.openai.com/api/reference/typescript/resources/models/methods/retrieve)
- [Codex turn](https://github.com/openai/codex/blob/aa380897f67b91e1a47d530d7286d497b6726d3f/codex-rs/core/src/session/turn.rs)
- [Pi session](https://github.com/earendilworks/pi-mono/blob/5fd446ca1843682e8da3fec4ceb71c42f56fbace/packages/coding-agent/src/core/agent-session.ts)
