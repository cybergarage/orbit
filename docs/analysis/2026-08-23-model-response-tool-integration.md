# Model Response and Tool Integration

## Purpose

This investigation records how OpenAI and Ollama represent model responses
and function-tool interactions, how Orbit currently normalizes those
protocols, and which changes are required before the model abstraction can
support richer provider behavior safely.

The investigation covers the OpenAI Chat Completions and Responses APIs and
the native Ollama chat API. It focuses on custom function tools executed by
Orbit. Provider-hosted tools, realtime audio, and embedding APIs are outside
the current implementation scope.

## Sources and versions

The repository currently installs:

- `openai` 6.29.0
- `ollama` 0.6.3

The API behavior in this document was verified against:

- [OpenAI Chat Completions API reference](https://developers.openai.com/api/reference/cli/resources/chat/subresources/completions)
- [OpenAI Responses API reference](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)
- [Ollama chat API reference](https://docs.ollama.com/api/chat)
- [Ollama tool-calling guide](https://docs.ollama.com/capabilities/tool-calling)
- [Ollama streaming guide](https://docs.ollama.com/capabilities/streaming)
- [Ollama thinking guide](https://docs.ollama.com/capabilities/thinking)

These APIs evolve independently. Provider adapters must remain responsible
for their native request and response formats instead of exposing SDK types
through Orbit's public model contract.

## Verified provider behavior

### OpenAI Chat Completions

A non-streaming chat completion contains one or more choices. An assistant
message may contain text, a refusal, audio, annotations, and function or
custom-tool calls. Function calls have provider-assigned call IDs and JSON
arguments represented as strings. Tool results are returned in a later
message with role `tool` and the matching `tool_call_id`.

Streaming returns chat-completion chunks. Text, refusal, and tool-call
arguments can arrive incrementally. The current Orbit adapter does not request
streaming.

### OpenAI Responses API

A Response contains an ordered output-item list rather than one assumed
assistant message. Output items can include messages, reasoning, function
calls, and provider-hosted tool calls. Streaming produces typed lifecycle and
delta events. Function results are input items with type
`function_call_output` and must preserve the original `call_id`.

Reasoning and tool-call items may need to be supplied again when an
application manages conversation state manually. Orbit's current text-first
`Message` projection cannot preserve that protocol completely, so switching
the existing adapter to Responses without first strengthening the normalized
response contract would lose continuation data.

### Ollama chat

A non-streaming Ollama chat response contains an assistant message with text,
optional thinking text, images, and function calls. It also returns a done
reason, token counts, generation timing, and optional log probabilities.

Ollama function arguments are objects. Tool results are later messages with
role `tool`, the called function's `tool_name`, and content. Ollama supports
multiple calls in one response. The native protocol does not require the
OpenAI-style call ID for tool-result messages, so Orbit uses a deterministic
internal ID and preserves result order.

For thinking-capable models, Ollama documents that accumulated thinking,
assistant content, tool calls, and tool results should be preserved in the
next request. The current Orbit adapter drops thinking text.

## Verified Orbit behavior before this change

Orbit's `Model` interface returns a single `Message`. Provider adapters store
response metadata and normalized `ModelToolCall` values in the message
payload. `Agent` registers tool specifications, invokes the model, validates
and executes returned calls, appends normalized `ToolResult` messages, and
invokes the model again.

The following paths are connected and covered by deterministic unit tests:

1. Convert `ModelToolSpec` to OpenAI or Ollama function definitions.
2. Convert provider function calls to `ModelToolCall`.
3. Validate and execute calls through `ToolRuntime`.
4. Store normalized text or image `ToolResult` values.
5. Convert tool-result messages back to provider-native chat messages.
6. Continue until the model returns no more tool calls or reaches the loop
   limit.

The coding profile's final results are text-first, so `bash`, `read`, `grep`,
`glob`, `list`, `edit`, and `write` can participate in this loop. Tests before
this change verified the mapping helpers and an Agent with a stub model, but
did not run the Agent loop through either real adapter, even with a fake SDK
transport.

## Gaps and risks

### Response information is discarded

- OpenAI refusal text can become an empty successful Orbit response.
- OpenAI annotations, audio, custom-tool calls, and additional choices are not
  represented.
- Ollama thinking and response images are discarded and cannot be replayed.
- Ollama timing and log-probability metadata are discarded.
- Neither adapter exposes normalized output parts for clients that need more
  than the first text string.

### Tool-result projection is lossy

`ToolResult` includes model-visible content, optional runtime details, and an
error marker. OpenAI and Ollama currently receive only flattened content.
They do not receive an explicit textual error marker. Image content becomes a
placeholder in both adapters.

Most details are intentionally diagnostic rather than model-visible, but
information that changes the model's next decision must also be present in
content. In particular, `bash` stores the exit code in details. When a failed
command produces output, the model can receive that output without learning
that the process failed.

### Updates are disconnected

Tools can call `ToolExecutionContext.emitUpdate`, and Bash emits output
updates. `Agent` currently supplies an empty callback, so those updates never
reach Agent or thread clients.

### The abstraction has no streaming result contract

`Model.invoke` returns one completed `Message`. This cannot represent OpenAI
or Ollama deltas, partial tool arguments, provider lifecycle events, or
cancellation after a partially emitted response.

## Implementation direction

### Current milestone

This change should complete the following compatible improvements:

1. Add provider-neutral output parts for text, refusal, reasoning, images,
   citations, audio, and tool calls while keeping `Message.content` and the
   existing tool-call payload compatible.
2. Preserve OpenAI refusal information and reject malformed responses with no
   choices.
3. Preserve Ollama thinking and images in assistant history and retain useful
   native response metadata.
4. Project tool failures explicitly for providers that lack a native error
   field.
5. Make non-zero Bash exit status model-visible and classify it as a tool
   error.
6. Forward tool updates through Agent and thread events.
7. Add full Agent-loop tests that use OpenAI and Ollama adapters with fake SDK
   clients and real Orbit built-in tools.

### Follow-up milestone: OpenAI Responses

Add a separate Responses adapter behind explicit provider configuration. It
must preserve ordered output items, response status, reasoning continuation,
function `call_id` values, and provider-hosted tool items. Chat Completions
should remain available until the Responses adapter reaches tool and session
resume parity.

### Follow-up milestone: model streaming

Introduce an asynchronous model event contract with text, reasoning, tool-call
argument, completion, and failure events. Both providers should accumulate a
canonical completed response for session history while forwarding deltas to
interactive and GUI clients.

### Follow-up milestone: rich tool results

Define adapter capability declarations for accepted tool-result content. Map
images natively where a provider protocol supports them and fail explicitly
or provide a documented fallback where it does not. Keep diagnostic details
separate from model-visible content unless those details affect the next
model decision.

## Acceptance criteria for the current milestone

- Existing public `Model.invoke` and `Message.content` behavior remains
  compatible for ordinary text responses.
- OpenAI and Ollama function definitions, calls, and results retain their
  provider-required identifiers.
- OpenAI refusal text is visible and typed.
- Ollama thinking is present in the next request after a tool call.
- Non-zero Bash exits are visible errors to the next model invocation.
- Tool updates are observable through Agent and thread event APIs.
- Fake-client integration tests prove a model call, real built-in tool
  execution, provider-native tool-result request, and final response for both
  providers.
- Header, build, formatting, lint, and complete test validation pass.

## Implementation status

The current milestone was implemented on 2026-08-23:

- `ModelOutputPart` now represents text, refusal, reasoning, images, audio,
  citations, and tool calls without changing ordinary `Message.content`
  behavior.
- OpenAI Chat Completions preserves refusal, audio, citation, and function-call
  parts and rejects responses without choices.
- Ollama preserves thinking and images in assistant history, replays them after
  tool calls, maps image tool results to `images`, and retains native timing
  and log-probability metadata.
- OpenAI and Ollama receive an explicit textual marker for failed tool results.
- Bash exposes non-zero exit status in content and classifies non-zero exits as
  errors.
- Agent and thread APIs forward partial tool updates with the `tool-updated`
  event.
- Fake OpenAI and Ollama clients exercise the complete Agent, built-in `read`,
  tool-result, and final-response loop without network access.
- CLI and GUI startup discover installed Ollama models. Selection preserves an
  explicit installed model, prefers the installed default, and otherwise uses
  the first installed model whose metadata reports tool support.

OpenAI Responses API support, normalized model streaming, and general rich
tool-result capability negotiation remain follow-up milestones. They were not
included in this change because they require new continuation and event
contracts rather than safe extensions to the completed-message contract.
