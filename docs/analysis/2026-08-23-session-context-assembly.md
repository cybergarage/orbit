# Session History and Model Context Assembly

Date: 2026-08-23

## Purpose

This document investigates how Pi Coding Agent and Codex combine an existing
session transcript with a newly submitted prompt before requesting an LLM. It
then compares those implementations with Orbit and recommends an Orbit design.

This is a point-in-time engineering investigation. Statements under the Pi,
Codex, and Orbit findings describe verified source behavior. The Orbit design
section is a proposal and has not been implemented unless stated otherwise.

## Executive summary

Pi and Codex both manage model-visible conversation state in the client. On a
new user prompt, each system first adds the prompt to its in-memory history,
then derives the complete model context from that history. Their persistent log
is not concatenated as raw text, and the entire durable log is not necessarily
sent. A projection step selects the active branch, applies compaction, filters
or converts non-model messages, and preserves tool-call relationships.

Pi makes the relationship especially explicit:

1. `SessionManager.buildSessionContext()` reconstructs the active leaf-to-root
   path and applies the latest compaction.
2. That result initializes `agent.state.messages` when a session is resumed.
3. A new prompt contains only the newly submitted user and extension messages.
4. `runAgentLoop()` appends those messages to a snapshot of the existing agent
   state.
5. Immediately before inference, `convertToLlm()` projects the resulting
   `AgentMessage[]` into provider-compatible `Message[]`.

Codex uses the same broad pattern with different types:

1. A resumed rollout is replayed into an in-memory `ContextManager`.
2. The new `UserInput` is recorded into that manager before sampling.
3. `clone_history().for_prompt(...)` normalizes the full model-visible
   `Vec<ResponseItem>`.
4. The vector becomes `Prompt.input` and then the Responses API `input`.
5. Completed assistant items and tool outputs are appended to the same context
   before a follow-up sampling request.

Codex can use `previous_response_id` over a reused, turn-scoped WebSocket when
the new request is a strict extension of the preceding request. This is a
transport optimization, not the authoritative representation of thread
history. The HTTP path sends the complete client-built input, and a new Codex
user turn gets a fresh `ModelClientSession`.

Orbit already sends prior conversation messages plus the new user message from
interactive mode and `ThreadManager`. It also restores those messages from
JSONL on resume. The central defect is responsibility: callers must construct
the complete request, while `Agent` simultaneously owns a `Session` but does
not use that session to obtain prior context. This permits a direct caller to
record history without sending it, makes duplicate avoidance depend on message
IDs, and causes `ThreadManager` to record the new user message before the
agent's turn-start records.

Orbit should make `Session` the sole conversation authority and introduce a
pure context projection boundary. `Agent` should accept only messages newly
submitted for the turn, append them once, and rebuild model input from the
session before every model iteration. Complete-context invocation, if still
needed, should be a separate explicitly stateless API.

## Investigation scope and source versions

The findings use these snapshots:

| System          | Snapshot                                                                                                    | Primary files                                                                                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pi Coding Agent | `@earendil-works/pi-coding-agent` 0.84.2, commit `a1f955e9f47fd3379b44f4aace65ab916c80519a` from 2026-08-22 | `packages/coding-agent/src/core/session-manager.ts`, `sdk.ts`, `agent-session.ts`, `messages.ts`; `packages/agent/src/agent.ts`, `agent-loop.ts`                 |
| Codex           | Rust workspace 0.144.4                                                                                      | `core/src/session/turn.rs`, `core/src/session/mod.rs`, `core/src/context_manager/history.rs`, `core/src/client.rs`, `core/src/session/rollout_reconstruction.rs` |
| Orbit           | repository state at commit `e02c7b2d2fc2facd4467cddc2a12c9aa4b6193f7`                                       | `src/core/agent.ts`, `thread.ts`, `interactive.tsx`, `session/session.ts`, `session/repository.ts`, and model adapters                                           |

Pi's repository was formerly published as `badlogic/pi-mono`; the inspected
GitHub endpoint redirects to `earendil-works/pi`. The commit hash above fixes
the source identity independently of that rename.

## The three histories that must remain distinct

The implementations are easier to compare after separating three concepts.

- **Durable history** is the JSONL session or rollout. It includes information
  needed for replay, UI, diagnostics, migration, branching, and compaction.
- **Runtime history** is the in-memory conversation state used during a live
  session. It is hydrated from durable history on resume and incrementally
  updated during execution.
- **Model context** is the provider request derived from runtime history. It may
  omit UI-only entries, replace old turns with a compaction summary, truncate
  tool output, remove unsupported images, or serialize roles differently.

The durable history is therefore an event source, not a string prefix to paste
in front of the new prompt.

## Pi Coding Agent findings

### Resume reconstructs an active history path

Pi's session file is append-only and can represent a tree. Each entry has an
ID and parent ID, while `SessionManager` maintains the current leaf.
`buildSessionPath()` walks from that leaf to the root and reverses the result so
the messages are ordered oldest to newest.

`buildContextEntries()` then applies compaction. If the active path contains a
compaction entry, the result begins with the latest compaction summary, retains
the entries beginning at `firstKeptEntryId`, and appends entries newer than the
compaction. Older summarized entries are excluded from model context without
being deleted from the durable file.

Finally, `buildSessionContext()` maps the selected entries through
`sessionEntryToContextMessages()` and returns messages together with the model
and thinking level recovered from the same path.

When `createAgentSession()` opens an existing session, it executes:

```ts
const existingSession = sessionManager.buildSessionContext()

if (hasExistingSession) {
  agent.state.messages = existingSession.messages
}
```

The runtime transcript is consequently rebuilt once when the session starts,
not re-read from JSONL for every prompt. Session replacement, branching, and
compaction explicitly rebuild `agent.state.messages` from
`buildSessionContext()` again because those operations change the active path.

### A new prompt is appended to the runtime snapshot

`AgentSession.prompt()` expands skills and prompt templates, processes input
extensions, optionally compacts the preceding history, and creates an array
containing the new user message plus any turn-scoped extension messages. It
does not prepend old conversation messages at this layer. It calls
`this.agent.prompt(messages)` with only the new messages.

The lower-level `Agent` creates a snapshot containing the current system
prompt, `state.messages`, and tools. `runAgentLoop()` combines the two arrays:

```ts
const currentContext: AgentContext = {
  ...context,
  messages: [...context.messages, ...prompts],
}
```

This is Pi's actual history concatenation point. Existing runtime history is
the stable prefix and newly submitted prompt messages are the suffix.

On each `message_end` event, the lower-level agent pushes the finalized message
into `state.messages`. `AgentSession` observes the same event and appends user,
assistant, and tool-result messages to `SessionManager`. Runtime state and the
durable log therefore advance from the same completed event stream.

### Model projection occurs immediately before inference

`streamAssistantResponse()` optionally applies an extension-provided context
transform and then invokes `convertToLlm(messages)`. It constructs the provider
neutral request as:

```ts
const llmContext: Context = {
  systemPrompt: context.systemPrompt,
  messages: llmMessages,
  tools: context.tools,
}
```

The low-level `Agent` default converter retains only `user`, `assistant`, and
`toolResult`. Pi Coding Agent overrides that default with its richer converter:

- `user`, `assistant`, and `toolResult` pass through;
- included shell-execution records become user text;
- custom extension messages become user messages;
- branch summaries and compaction summaries become delimited user messages;
- shell records marked `excludeFromContext` are omitted;
- images can be replaced when the active settings block image input.

This distinction matters: a custom message in the durable session is not sent
as an unknown role. It is converted at the model boundary.

### Tool iterations reuse the updated in-memory context

When the assistant requests tools, the assistant message and resulting
`toolResult` messages are appended to `currentContext.messages`. The next call
to `streamAssistantResponse()` converts the entire updated context again. The
sequence seen by the model is therefore:

```text
prior active session context
+ new user and extension messages
+ assistant tool-call message
+ tool-result messages
-> next model request
```

The same principle applies to steering and follow-up queues: accepted messages
are inserted into the current context before the next assistant response.

## Codex findings

### The rollout is replayed into `ContextManager`

Codex's durable rollout contains `ResponseItem` records together with turn
metadata, world-state records, compaction checkpoints, rollback events, and UI
events. `rollout_reconstruction.rs` replays the surviving records and produces
a model history rather than treating every rollout line as model input.

The reconstruction logic accounts for:

- replacement history stored by compaction;
- turns removed by rollback;
- response items in surviving turns;
- prior model and context settings;
- world-state and context-window baselines.

The reconstructed `Vec<ResponseItem>` replaces the session state's history.
This makes resumed and live sessions converge on the same `ContextManager`
representation.

### New input is recorded before the request snapshot

At the beginning of `run_turn()`, Codex records context updates, skills,
plugins, hooks, and user input. `run_hooks_and_record_inputs()` passes accepted
`TurnInput` records to `record_pending_input()`. A user record becomes a
`ResponseItem::Message` and is appended through
`record_conversation_items()`.

That method has one durable boundary for three actions:

1. normalize and append the item to in-memory history;
2. persist the response item to the rollout;
3. notify clients observing raw response items.

Only after this recording step does `run_turn()` construct inference input:

```rust
let sampling_request_input = sess
    .clone_history()
    .await
    .for_prompt(&turn_context.model_info.input_modalities);
```

The new user message is already the newest item in the cloned history. No
separate string concatenation is required.

### `for_prompt()` is the model context boundary

`ContextManager` stores `ResponseItem` values oldest first and applies output
truncation policy when items are recorded. `for_prompt()` clones and normalizes
that processed history, drops unsuitable records, maintains call/output
invariants, and strips images when the selected model does not support image
input.

The resulting vector becomes `Prompt.input`. `build_responses_request()` then
copies it into the Responses API `input`, adds base instructions and model-
visible tool definitions, and sets model, reasoning, output, cache, and stream
parameters.

For the normal Responses API form, base instructions use the top-level
`instructions` field and tools use the top-level `tools` field. In Responses
Lite mode, Codex prepends developer `ResponseItem` values for tools and base
instructions to the input vector instead. This transport difference does not
change which component owns conversation history.

### Completed output extends the same history

As response items finish streaming, Codex records assistant messages,
reasoning items, tool calls, and tool outputs through the conversation-history
boundary. If a tool call or queued input requires another model request,
`run_sampling_request()` obtains a fresh `clone_history().for_prompt(...)`
snapshot. The next request therefore contains the preceding request context,
the completed model output, and tool results.

### `previous_response_id` is an optimization, not thread storage

`ModelClientSession` is scoped to one Codex turn and caches the last full
request and last response. For a WebSocket continuation, Codex verifies that:

- every non-input request property still matches;
- the current input starts with the prior request input plus server-returned
  output items;
- there is a non-empty response ID.

Only then does it send the remaining input suffix with
`previous_response_id`. If the comparison fails, it sends a full request. The
HTTP Responses path also sends the full request built from `Prompt.input`.

This design preserves a client-side source of truth and uses server response
state only when it is safe to reduce transfer size. It also avoids making
session resume depend on remotely retained Responses API objects.

## Current Orbit behavior

### Session hydration is correct but context ownership is incomplete

`SessionRepository.open()` parses persisted message entries and constructs a
`Session` that preserves IDs, parent links, roles, payloads, and timestamps.
`resumeThread()` places that session in `State`, restores the recorded working
directory and model settings, and restores the system prompt from session
metadata when the caller does not override it.

This provides the data required to resume a conversation. The missing step is
that `Agent` does not itself derive model context from its session.

### Interactive mode and `ThreadManager` rebuild the full request

For a new interactive prompt, `interactive.tsx` constructs:

```ts
;[...systemMessagesWhenNoSession, ...(session?.getConversationMessages() ?? conversationMessages), userMessage]
```

With a persistent session, system messages are configured on the agent and the
session conversation supplies prior user, assistant, and tool messages.

`ThreadManager.executeRun()` first appends the new user message to the session,
then obtains all conversation messages and invokes the agent:

```ts
const requestMessages = thread.session.getConversationMessages()
const response = await thread.agent.invoke(requestMessages, ...)
```

Tests verify that the second request contains the first user message, first
assistant response, and second user message, including after a persisted thread
is resumed.

### `Agent` treats its argument as complete context

Inside `Agent.invokeSession()`, Orbit currently does both of these operations:

```ts
session.appendNewMessages(messages, {turnId})
const conversation = [...messages]
```

The first operation records only IDs not already in the session. The second
operation treats every argument message as request context. Each model
iteration sends:

```ts
;[...this.messages, ...conversation]
```

`this.messages` contains static agent messages such as the system prompt.
`conversation` contains the caller-supplied complete transcript, followed by
assistant tool-call and tool-result messages created during this invocation.

This works for current first-party callers because they know to pass the whole
conversation. It has four design problems:

1. A direct caller can call `agent.invoke([newUserMessage])` repeatedly. The
   session records every turn, but prior session messages are absent from the
   second model request.
2. A caller can pass an incomplete or differently ordered transcript even
   though the agent owns a canonical session.
3. Duplicate persistence avoidance relies on stable message IDs rather than an
   API that distinguishes new input from existing context.
4. `ThreadManager` records the user message before `Agent` records turn context
   and the `started` event, so the durable event order does not reflect the
   conceptual turn lifecycle.

### Provider projection is adapter-specific

Orbit's OpenAI and Ollama adapters map the supplied message array directly to
provider messages. The Anthropic adapter first extracts every system-role
message, joins their text with blank lines, and maps the remaining messages.
All adapters serialize tool-call and tool-result payloads at the provider
boundary.

Orbit currently uses OpenAI Chat Completions, not the Responses API. It has no
`previous_response_id` or provider conversation ID behavior. Every request
contains the complete message list supplied by `Agent`.

### Context is unbounded

Orbit version 1 sessions are linear and do not have compaction entries, token-
budget selection, branch summaries, or active-leaf selection. The full
conversation grows on every turn until the provider rejects it or applies its
own undocumented truncation. This is the largest functional gap after context
ownership is fixed.

## Comparison

| Concern                          | Pi                                                  | Codex                                                 | Orbit now                                  |
| -------------------------------- | --------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------ |
| Runtime history owner            | `Agent.state.messages` hydrated by `SessionManager` | `ContextManager` in session state                     | `Session`, but callers assemble requests   |
| New prompt API                   | New messages only                                   | New `TurnInput` only                                  | Usually complete conversation              |
| Concatenation point              | `runAgentLoop`: prior snapshot plus prompts         | Record prompt, then clone history                     | First-party caller before `Agent.invoke()` |
| Model projection                 | `transformContext` and `convertToLlm`               | `ContextManager.for_prompt()`                         | Provider adapters only                     |
| Resume                           | Active tree path reconstructed                      | Rollout replay reconstructed                          | Linear messages hydrated                   |
| Compaction                       | Latest summary plus retained path                   | Replacement history/checkpoints                       | Not implemented                            |
| Tool continuation                | Append output to current context                    | Record output and clone again                         | Append to invocation-local conversation    |
| Incremental transport            | Provider dependent                                  | Eligible WebSocket suffix with `previous_response_id` | None; complete Chat Completions messages   |
| Durable/model history separation | Explicit                                            | Explicit                                              | Partial                                    |

## Proposed Orbit design

### Design decision

`Session` should own canonical runtime conversation history. `Agent` should own
turn execution. A new pure component should project a session snapshot into
model-visible messages. Entry points should submit only new turn input.

The core contract should be:

```text
new input
-> Agent records turn context and turn start
-> Session appends new input exactly once
-> ContextBuilder snapshots and projects Session history
-> Agent prepends stable agent/system context
-> Model adapter serializes provider request
-> Agent records assistant/tool output
-> ContextBuilder projects the updated Session before a tool follow-up
-> Agent records one terminal turn event and flushes
```

This follows Pi's stateful prompt API and Codex's centralized record-then-clone
boundary while remaining compatible with Orbit's provider-neutral `Message`.

### Introduce a pure context projector

Add a provider-neutral interface in `src/core/session/`, for example:

```ts
export interface ModelContextOptions {
  inputModalities?: readonly ('text' | 'image')[]
  maxInputTokens?: number
}

export interface ModelContext {
  messages: Message[]
}

export interface SessionContextBuilder {
  build(session: Session, options?: ModelContextOptions): ModelContext
}
```

The exact names may change. The required properties are more important:

- it is pure and does not write session state;
- it returns copied messages in deterministic oldest-to-newest order;
- it includes only the active conversation path;
- it preserves assistant tool calls with their corresponding results;
- it excludes UI-only entries and lifecycle records;
- it applies compaction and modality rules when those features exist;
- it is independent of OpenAI, Anthropic, and Ollama serialization;
- it can be tested with an in-memory `Session`.

For Orbit's current linear version, the first implementation may return
`session.getConversationMessages()`. Introducing the boundary now prevents
branching and compaction logic from leaking into `Agent` later.

### Change `Agent` to accept new input only

The preferred stateful method is:

```ts
agent.invoke(newMessages, options)
agent.run(session, newMessages, options)
```

Their `messages` parameter should mean messages newly submitted for this turn,
not a complete transcript. `invokeSession()` should:

1. record turn context;
2. record the started event;
3. append the new messages;
4. build model context from the session;
5. invoke the model with stable agent messages followed by projected session
   messages.

Before every tool-loop model call, rebuild from the session after recording the
assistant tool-call message and tool results. This removes the invocation-local
`conversation` array as a second source of truth.

Changing the meaning of an existing public method is a breaking API change.
Two safe migration options exist:

1. Add `prompt(newMessages)` as the stateful API, deprecate the current
   `invoke(completeContext)`, and later change `invoke` in a major release.
2. Change `invoke` now while the package remains pre-1.0, document the change,
   and add a separately named `invokeContext(completeContext)` for explicit
   stateless use.

The second option is recommended because Orbit is version `0.0.0` and current
first-party call sites are few. A name such as `invokeContext` makes the unusual
complete-context contract visible.

### Simplify first-party callers

After the stateful API exists:

- `ThreadManager.executeRun()` should create the user message and pass only
  that message to `Agent`; it should not append it first.
- interactive mode should pass only the new user message and should not rebuild
  a conversation array.
- `Agent` should be the only component that records model-visible turn
  messages during execution.
- UI-only slash-command replies should remain outside the session context.

This also restores durable order to `turn_context`, `turn started`, user
message, assistant/tool records, and terminal turn event.

### Keep stable instructions separate from conversation history

`Agent.messages` currently acts as stable prefix context, mainly system
messages. Keep this distinction initially:

```text
stable agent messages
+ projected session conversation
```

On persistent sessions, the effective system prompt in session metadata must
remain authoritative on resume unless explicitly overridden. Do not also store
the same system message as an ordinary conversation message, or it may be sent
twice. A later richer design can replace `Agent.messages` with an explicit
`instructions` field.

Stable prefix ordering is useful for provider prompt caching. Avoid regenerating
identical system messages with new content or moving dynamic turn data ahead of
the stable prefix.

### Define model-visibility rules centrally

The context builder should eventually recognize these categories:

| Category                            | Model treatment                                                 |
| ----------------------------------- | --------------------------------------------------------------- |
| User message                        | Include                                                         |
| Assistant text                      | Include                                                         |
| Assistant tool calls                | Include with stable call IDs                                    |
| Tool results                        | Include only with a matching call; preserve order               |
| System/instructions                 | Supply once through the stable prefix                           |
| UI notices and slash-command output | Exclude                                                         |
| Turn context and lifecycle events   | Exclude unless rendered by an explicit bounded context fragment |
| Compaction summary                  | Include as an explicit summary item                             |
| Superseded compacted turns          | Exclude                                                         |
| Unsupported image content           | Replace or reject according to an explicit policy               |

Provider adapters should remain responsible only for role and payload
serialization. For example, Anthropic can continue moving system messages into
its top-level `system` field, while the context builder decides which logical
messages exist.

### Add compaction before transport optimization

Orbit should not adopt `previous_response_id` as its first solution to growing
contexts. That would couple history correctness and resume behavior to one
provider's remote retention.

Implement context budgeting in this order:

1. estimate the projected context before inference;
2. reserve output and tool-loop headroom;
3. trigger compaction before the request crosses a configured threshold;
4. persist a compaction entry containing the summary and retained boundary;
5. have the context builder return the summary plus retained recent history;
6. keep the original durable messages for inspection and future reprocessing.

After this client-side source of truth is reliable, an OpenAI Responses adapter
may optionally use `previous_response_id` or a conversation ID as a transport
optimization. It must fall back to a full client-built request and must not be
required to resume a local session.

### Snapshot and concurrency rules

The current one-active-run-per-thread rule provides a useful invariant. Keep
the following ordering:

- append new input before taking the model-context snapshot;
- append every completed assistant or tool message before the next snapshot;
- never mutate messages already included in a request;
- flush terminal state before resolving the run;
- prevent two agents from writing the same session concurrently.

If session operations become asynchronous, provide one method that appends and
returns a context snapshot atomically from the agent's perspective. Do not let
the UI and agent independently snapshot and append.

## Suggested implementation phases

### Phase 1: Centralize the current linear behavior

1. Add `SessionContextBuilder` with the current linear message projection.
2. Inject it into `Agent` for deterministic tests.
3. Make stateful invocation accept only new messages.
4. Rebuild context from `Session` on every model/tool iteration.
5. Change interactive mode and `ThreadManager` to stop passing old messages.
6. Update public documentation and exports.

This phase changes ownership without changing the provider-visible message
sequence.

### Phase 2: Make visibility and invariants explicit

1. Add typed predicates for model-visible messages.
2. Validate tool-call/result pairing before provider serialization.
3. Define modality handling and bounded tool-result truncation.
4. Add diagnostics that report projected message count and estimated tokens
   without exposing secrets in normal logs.

### Phase 3: Add compaction

1. Add a durable compaction entry and codec validation.
2. Add token-budget policy and summary generation through an injected model
   boundary.
3. Project summary plus retained recent messages.
4. Verify live and resumed sessions produce identical model context.

### Phase 4: Optional provider optimizations

1. Add an OpenAI Responses adapter if required by product direction.
2. Keep full-input construction as the fallback.
3. Reuse response IDs only when request-prefix and non-input-property checks
   prove equivalence.
4. Test transport reuse independently from context reconstruction.

## Required tests

The first implementation phase should add tests for these behaviors:

- two calls with only new user messages send the full accumulated session to
  the model on the second call;
- prior messages are neither duplicated in the session nor duplicated in the
  request;
- a resumed session sends the same logical context as the live session;
- `ThreadManager` passes only the new message to its agent boundary;
- interactive mode passes only the new message;
- turn-context and turn-start records precede the new user record;
- system instructions appear exactly once;
- an assistant tool call and its result appear in the next model request in
  order;
- UI-only slash-command output is not sent;
- failure and cancellation still record one terminal event and flush;
- the context builder returns copies and cannot mutate persisted session
  messages.

Compaction tests should additionally prove that live projection and projection
after JSONL resume are byte-for-byte equivalent at the provider-neutral message
layer.

## Recommendation

Implement Phase 1 before adding more session features. Orbit already has a
durable session aggregate and first-party callers that manually reconstruct
history, so centralization is a contained change with immediate correctness
benefits. The key API rule should be simple: entry points submit new input;
`Agent` records it; the session context builder decides what the model sees.

This reproduces the strongest common property of Pi and Codex: persistent
history, runtime history, and provider requests are connected by one explicit,
testable projection boundary rather than by caller-managed array concatenation.

## References

- [Pi source at the inspected commit](https://github.com/earendil-works/pi/tree/a1f955e9f47fd3379b44f4aace65ab916c80519a)
- [OpenAI Responses API: create a response](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)
- [Orbit session documentation](../session.md)
- [Orbit session persistence analysis](2026-08-22-session-persistence.md)
