# Provider and model catalog

`ModelRegistry` lists registered factories; it does not establish credential,
service, account or tool capability availability. `ModelCatalog.list(settings)`
returns a credential-aware grouped snapshot for Ollama, Claude (Anthropic), and
OpenAI. `OrbitApplicationService.getModelCatalog(threadId?, refresh?)` and
`GET /api/model-catalog` expose this safe snapshot to GUI hosts. The product GUI
sets `enforceCatalog: true` to revalidate stale selections before sending. Reusable
application hosts can opt in while retaining their own custom-provider policies.

Only `available` providers with eligible models are selectable. Other states are
`unconfigured`, `authentication-rejected`, `unavailable`, `unsupported`, and
`listing-failed`. Renderer data contains labels, IDs, status and sanitized messages,
never keys, credential environment-variable names or provider exception bodies.

Credential resolution matches the adapters: explicit Core provider settings or
`apiKeyEnv` selection first, then the SDK's standard environment key when no
explicit selection exists. A configured but missing `apiKeyEnv` does not fall
back to another key. Discovery never edits credentials or persistent permissions.

Ollama uses read-only tags/show requests and requires an installed model reporting
`tools`. Discovery never pulls or loads a model. Remote discovery uses the official
[OpenAI Models API](https://developers.openai.com/api/reference/resources/models/methods/list)
and [Claude Models API](https://platform.claude.com/docs/en/api/models/list),
without generating tokens. `list-verified` means the read-only Models API accepted
this credential. It does **not** establish inference permission, billing readiness,
quota, or success of a future generation request.

OpenAI listing has no tool-capability fields. Its returned IDs are intersected with
`openai-capabilities.ts`, a conservative exact-ID Chat Completions/function-calling
compatibility table, independent of context-capacity accounting. Unknown models,
embedding/audio models, fine-tunes and Responses-only models are excluded until
compatibility is documented. This table never manufactures availability.
See official [GPT-4.1](https://developers.openai.com/api/docs/models/gpt-4.1)
and [GPT-5.4](https://developers.openai.com/api/docs/models/gpt-5.4) endpoint/feature
specifications and the existing model-capacity guide for maintained model sources.
Claude discovery requests the documented 2026-10-21 model metadata and requires an
active model record. The [Claude model contract](https://platform.claude.com/docs/en/models/overview)
states current models support text output and tool use. Retired, deprecated and
unknown legacy records are excluded. Apple is text-only and not a coding choice.

Requests share a bounded provider deadline (default five seconds). Local metadata
uses batches of four, up to 128 installed names; remote pagination is bounded to
1,000 records. Private snapshots cache for at most 60 seconds (default 30), keyed
by a one-way digest that changes with credential/connection settings. Explicit
refresh and selection validation recheck availability; a failed refresh never
returns old models as currently available.

Pickers display one list of combined provider / model pairs;
Escape and outside clicks dismiss without saving. Saving always validates and persists the complete pair.
Conversation selection applies to the next turn, while an admitted run retains its
provider/model. Defaults affect new chats and preserve explicit project settings.

`ModelGateway` is a host-only transport bound to one admitted pair. It accepts only
that provider's adapter routes and fixed model, caps request/output resources, and
sanitizes authentication failures. App workers use real Core adapters with injected
RPC clients; keys stay in host memory and are absent from worker configuration,
container arguments and renderer snapshots. Legacy App sessions without a provider
retain Ollama semantics. Remote title generation is not automatically enabled.
