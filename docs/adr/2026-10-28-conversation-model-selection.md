---
status: accepted
proposed-date: 2026-10-28
decision-date: 2026-10-28
implementation-status: partial
implementation-completed-date: null
implementation-commits: []
superseded-by: []
---

# Conversation model selection

## Purpose

Implement the author's requested conversation provider/model update API, shared by
GUI integrations, with persistence and application from the next turn. A separate
GUI default applies to new conversations, preserving existing choices and explicit
project settings. The implementation request supplies authorization for this scope.

## Decision

Store the current selection in a versioned, bounded `.coordination/<id>.model.json`
sidecar under the registered session writer claim. Keep the transcript header and
historical turn contexts immutable. Read missing metadata as the original header
selection, and reject corrupt metadata. Delete this sidecar with the conversation.

Prepare the adapter and, when budgeting is enabled, its context profile before
saving. Only commit the queued adapter after persistence succeeds. Thread admission
activates the queued model before the next turn; the current turn keeps its adapter.
Rapid selections use a generation guard so late preparation cannot overwrite a newer
request. Closing or quarantined threads reject mutation.

Keep GUI defaults separate from session selections. Save an explicit provider/model
pair under the profile's coordination directory; load it at service construction.
Existing conversations retain their selected metadata. Explicit project model/provider
settings precede the GUI fallback. Never download models or fabricate catalog entries.
The desktop worker uses the selected real Ollama/OpenAI/Anthropic adapter with a
host-only credential gateway. Coding choices require supported tool capability. Apple remains
text-only and is excluded from coding selectors.

## Consequences

This avoids a transcript migration and history rewrite. Sidecar metadata is current
selection state, while turn contexts remain evidence of the adapter actually used.
A profile must retain its coordination directory. Unknown capacity prevents a budgeted
model switch instead of reusing the old model's context limit. Discovery can fail;
the current saved choice remains intact and the UI offers a visible retry by reopening.
Core owns bounded, cached credential-aware remote/local discovery as specified in
[Model catalog](../model-catalog.md). Read-only listing verification is distinct from
inference entitlement. Apple tool calling remains outside this implementation.

## Alternatives

Rewriting session headers risks historical evidence and active readers. Recreating the
entire Agent risks tools, journals and run lookup state. Automatically overwriting all
sessions when defaults change violates the requested conversation isolation.

## Evidence and external comparison

Inspected Orbit base `50d4a8d4175f3ece67e77127b58eaa5dcec64c3e`: `src/core/thread.ts`,
`src/core/application.ts`, `src/core/session/{repository,session,title}.ts`, and
`src/core/session/context-policy.ts`. The existing title metadata establishes the
bounded durable sidecar and registered writer ownership pattern.

Inspected pinned [Codex turn source](https://github.com/openai/codex/blob/aa380897f67b91e1a47d530d7286d497b6726d3f/codex-rs/core/src/session/turn.rs):
previous-model compaction compares old and new windows before sampling. Adopt
capacity-aware turn boundaries; do not import its previous-model compaction system.
Inspected pinned [Pi AgentSession source](https://github.com/badlogic/pi-mono/blob/5fd446ca1843682e8da3fec4ceb71c42f56fbace/packages/coding-agent/src/core/agent-session.ts):
`setModel` validates auth, records session model change, and changes global defaults
only on explicit persistence. Adopt independent conversation/default selection;
retain Orbit's established metadata and registered-writer format.

## Confirmation

Validation is recorded in the task outcome. Implementation completion and source
commit pins remain unset until repository checks and consumer artifact integration
are complete. No release, merge or publication is authorized by this record.
