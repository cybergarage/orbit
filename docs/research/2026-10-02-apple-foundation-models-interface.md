---
status: current
investigation-date: 2026-10-02
orbit-commit: 7782b6208052bd3c2f50ef48992d4ab2632b351d
related-adrs: []
superseded-by: []
---

# Apple Foundation Models Interfaces for Orbit

## Purpose and Research Questions

Investigate whether the macOS 27 `fm` command exposes a local model interface
usable by Orbit, whether the existing adapter works unchanged, and which gaps
prevent a tool-driven agent integration. This is interface research, not an
implementation approval or an agent-quality evaluation.

## Findings

**A usable interface exists, but the current Orbit OpenAI adapter does not work
unchanged with the tested `fm serve`.** The simplest transport is the built-in
Chat Completions HTTP server. A temporary client wrapper that explicitly adds
`stream: false` successfully returned text and normalized usage through Orbit's
existing adapter. JSON formatting and tool calling have additional compatibility
gaps; a complete Orbit agent tool loop was not demonstrated.

| Interface                         | Evidence                                                                                                            | Orbit implication                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `fm serve`                        | Installed Apple CLI exposes `/v1/chat/completions`, `/v1/models`, and `/health`; TCP and Unix sockets are supported | Closest match to the existing OpenAI adapter                                              |
| `fm respond`                      | Installed CLI supports instructions, schemas, streaming, and transcript loading/saving                              | A subprocess bridge could support narrow text tasks; it is not an existing Orbit provider |
| Foundation Models Swift framework | Official documentation exposes sessions, guided generation, and tools                                               | Requires a native bridge from TypeScript                                                  |
| Apple Python SDK                  | WWDC26 session 334 describes `apple_fm_sdk`, sessions, streaming, structured output, and tools                      | Requires a Python bridge; not installed or exercised in this investigation                |

Apple's framework documentation describes both on-device and server-backed
models. That does not mean every framework capability is exposed by the installed
CLI. The tested macOS release lists only the on-device model `system`, although
the WWDC26 presentation also demonstrates `pcc`. No cloud model was used.

## Orbit Baseline

Inspected at the front-matter commit:

- [`src/core/models/adapters/openai.ts`](../../src/core/models/adapters/openai.ts):
  uses `chat.completions.create()`, expects a non-streaming completion, omits
  `stream`, maps JSON mode to `response_format.type = json_object`, and forwards
  function tool specifications. `createOpenAIOptions()` passes only the API key;
  it does not consume `Provider.getHost()`.
- [`src/core/models/provider.ts`](../../src/core/models/provider.ts): exposes
  configured `host`, key, and context-window fields.
- [`src/core/models/factory.ts`](../../src/core/models/factory.ts): built-in
  providers are OpenAI, Anthropic, and Ollama. `registerModelProvider()` provides
  an application-owned extension point; registration precedes settings loading.
- [`src/core/models/adapters/openai-context.ts`](../../src/core/models/adapters/openai-context.ts):
  `system` has no catalog entry, so model capacity remains unknown unless
  configured.
- Installed OpenAI SDK **6.29.0**, `node_modules/openai/src/client.ts`: its
  constructor reads `OPENAI_BASE_URL` and `OPENAI_API_KEY`. Therefore an
  environment override reaches `fm` despite the unused Orbit `host` field.

No source implementation, settings, dependency, or public API was changed.

## Local Verification

The test host ran **macOS 27.0.1, build 26A434**, with `/usr/bin/fm`.
Inspected `fm --help`, `fm serve --help`, `fm available --help`, and the installed
Apple manual `/usr/share/man/man1/fm.1` (dated June 8, 2026). `fm available`
reported `System model available`. A temporary server ran on loopback port
21976 and was stopped after testing. The sandbox initially rejected listening
with `Operation not permitted`; the probes ran with permitted loopback access.
No license acceptance was performed and no real credentials or session history
were supplied. Only synthetic prompts and inert weather-tool schemas were used.

| Probe                                                                 | Observed result                                                                                                                                                    |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /v1/models`                                                      | HTTP 200, model ID `system`, owner `Apple`                                                                                                                         |
| Text request with omitted `stream`                                    | HTTP 200, `text/event-stream`, SSE chunks ending with `[DONE]`                                                                                                     |
| Same text request with `stream: false`                                | HTTP 200, JSON completion with text and usage                                                                                                                      |
| Current Orbit adapter, endpoint overridden through environment        | Fails while accessing `response.choices[0]`; the SDK receives SSE where Orbit expects completion JSON                                                              |
| Orbit adapter with a temporary injected client adding `stream: false` | Returns `hello`, a normalized text part, stop reason `stop`, and usage (62 input, 3 output, 65 total tokens in this one probe); `maxOutputTokens: 16` was accepted |
| Orbit JSON mode (`json_object`)                                       | HTTP 400: server requests `json_schema` instead                                                                                                                    |
| Raw request with a simple named object `json_schema`                  | HTTP 200, schema-shaped greeting JSON                                                                                                                              |
| Optional weather tool with `stream: false`                            | HTTP 200 with prose/JSON-like content; no structured `tool_calls`                                                                                                  |
| Forced weather tool, named choice and `required` choice               | HTTP 500: `An unsupported generation guide was used.`; adding `additionalProperties: false` did not resolve it                                                     |

The tool probes establish a failure for the tested schemas and choices. They do
**not** prove that every `fm serve` tool configuration fails, or that the Swift
framework lacks tool support. No tool-result continuation was tested because no
structured tool call was produced. Acceptance of an output-token parameter is
not evidence that its limit is enforced.

### Reproduction

Start the local server:

```sh
fm available --model system
fm serve --host 127.0.0.1 --port 21976
```

In another terminal, verify non-streaming completion JSON:

```sh
curl http://127.0.0.1:21976/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"system","stream":false,"messages":[{"role":"user","content":"Reply hello."}]}'
```

Removing `"stream":false` reproduces the SSE default on this release.
`OPENAI_BASE_URL=http://127.0.0.1:21976/v1` and a fake
`OPENAI_API_KEY=local-fm-placeholder` direct the SDK to this server; the fake key
satisfies SDK construction. These environment variables alone do **not** fix
the current Orbit adapter. Stop the server with Ctrl-C after testing.

## External Implementation Comparison

Both comparisons were inspected on 2026-10-02 at full source revisions. Neither
application was run against `fm`; these are source-level transport comparisons.

| System and pinned revision                                            | Inspected source                                                                                                                                                           | Relevant behavior and limits                                                                                                                                                                                 |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Codex `c39bfa4c8ff9a57c46a9d3766676d6435e262691`                      | [`codex-rs/model-provider-info/src/lib.rs`](https://github.com/openai/codex/blob/c39bfa4c8ff9a57c46a9d3766676d6435e262691/codex-rs/model-provider-info/src/lib.rs)         | Supports custom `base_url`, but its wire API accepts Responses and explicitly rejects `chat`; the tested `fm` exposes Chat Completions, so an endpoint override alone is insufficient                        |
| Pi Coding Agent repository `7fbbd5f4a1d982bb02d63472dde0774fa639f99b` | [`packages/ai/src/api/openai-completions.ts`](https://github.com/badlogic/pi-mono/blob/7fbbd5f4a1d982bb02d63472dde0774fa639f99b/packages/ai/src/api/openai-completions.ts) | Passes `model.baseUrl` to the SDK and explicitly sends `stream: true`; it avoids Orbit's implicit streaming mismatch in principle, but tool/schema compatibility and actual `fm` operation remain unverified |

## Implications for Orbit (Non-binding)

1. A focused HTTP compatibility adapter or client wrapper is the shortest path
   to text-generation evaluation: explicitly choose streaming behavior, configure
   the endpoint, and handle model availability. A dedicated external provider
   can use the existing registration mechanism. This investigation does not
   choose between that approach and changing the built-in adapter.
2. Structured output needs an explicit schema path rather than blindly reusing
   `json_object`. Orbit's current JSON option does not carry a schema.
3. Verify structured tool calls, results, continuation, cancellation, and error
   mapping before claiming compatibility with Orbit's coding-agent loop.
4. A Swift/Python bridge is an alternative if HTTP tool compatibility remains
   insufficient. Apple's tool API executes application callbacks; a bridge must
   preserve Orbit's ownership of tool validation, scheduling, and effects instead
   of silently executing tools inside a model adapter.

## Risks, Limitations, and Open Questions

Apple's [context-window guide](https://developer.apple.com/documentation/foundationmodels/managing-the-context-window)
documents 4096 tokens per on-device session, including instructions, prompts,
outputs, and tool information. This limit was not measured on the installed
model. Long Orbit conversations and tool descriptions therefore need a measured
budget rather than assumptions based on OpenAI model limits. Apple token counting
and Orbit's existing accounting should be compared before relying on compaction.

The [framework overview](https://developer.apple.com/documentation/foundationmodels)
requires an Apple Intelligence-capable device; local availability must still be
checked. Behavior is pinned to this OS build and can change with system/model
updates. Guardrails, languages, throughput, coding quality, multi-turn history,
context-overflow errors, and Unix-socket transport were not evaluated.

Open questions are whether another supported tool schema avoids the observed
generation-guide error, how `fm` maps tool results and context overflow, and
whether a maintained bridge can preserve Orbit's runtime contract with acceptable
latency. No ADR was created or accepted by this research.

## References

- [Apple Foundation Models](https://developer.apple.com/documentation/foundationmodels),
  including its official Markdown representation; retrieved 2026-10-02.
- [Apple: Expanding generation with tool calling](https://developer.apple.com/documentation/foundationmodels/expanding-generation-with-tool-calling),
  retrieved 2026-10-02; framework callbacks and tool modes, not proof of HTTP parity.
- [Apple: Managing the context window](https://developer.apple.com/documentation/foundationmodels/managing-the-context-window),
  retrieved 2026-10-02.
- [WWDC26 session 334: Build AI-powered scripts with the fm CLI and Python SDK](https://developer.apple.com/videos/play/wwdc2026/334/),
  inspected transcript and code examples; presentation behavior can differ from
  the installed release.
- Installed Apple `fm` help/manual and the local API probes described above are
  the authoritative evidence for the tested CLI build; its implementation source
  was not available for inspection.
