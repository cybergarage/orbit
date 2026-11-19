# Runtime model capabilities

`resolveModelCapabilities(model, {signal})` inspects the selected Model/adapter
instance without generating text. Existing custom Models need not implement the
optional `getCapabilities({signal})` method: they resolve to unknown. The result
contains the actual model/provider identity, `tools` and the observation `source`
(`adapter`, `api`, `catalog`, or `unknown`). It does not contain endpoints or raw
transport errors.

```ts
import {canIncludeModelTools, resolveModelCapabilities} from '@cybergarage/orbit'

const capability = await resolveModelCapabilities(agent.getModel(), {signal})
const toolsForRequest = canIncludeModelTools(capability) ? hostAuthorizedToolSpecs : []
// Supply toolsForRequest only through the host's existing request/authorization path.
```

| Observation   | Tool information may be included | Meaning                                                             |
| ------------- | -------------------------------- | ------------------------------------------------------------------- |
| `supported`   | Yes                              | Positive evidence for this model/adapter route                      |
| `unknown`     | Yes                              | Missing/unrecognized evidence or discovery failure; remains unknown |
| `unsupported` | No                               | Explicit negative evidence or an adapter restriction                |

`canIncludeModelTools` expresses this policy without mutating the observation or
the tool list. It is not a permission grant. The resolver does not register tools,
attach Project memory, change catalog selection, filter existing invocation
options, or alter execution authorization. Backends can still reject requests;
supported is not proof of credentials, model availability or inference entitlement.
Hosts must resolve again after selecting a different model or route.

## Built-in observations

- **Ollama:** read one `POST /api/show` for the selected exact model. An explicit
  `tools` feature is supported. An empty list or a list of recognized features
  without tools is unsupported. Missing/non-array/malformed lists and lists with
  unknown features but no explicit tools are unknown. No model-name heuristic,
  listing, load, download, generation or retry is used. Context discovery reuses
  the same metadata-client construction; tool discovery does not call `ps`.
- **OpenAI Chat Completions:** reuse the existing documented exact-ID tool list
  on the native SDK endpoint only. Unknown IDs, fine-tunes and unlisted snapshots
  remain unknown; context limits do not imply tool support. No API call or
  credentialed SDK construction is required for this catalog observation.
- **Anthropic Messages:** reuse the coding catalog's active model metadata rule
  after one native `GET /v1/models/{selected-id}`, with retries disabled and the
  same version header as the catalog. Only a matching ID with `type: model` and
  `lifecycle: active` is positive evidence. Legacy, mismatching/alias-resolved IDs,
  non-active records and errors remain unknown, not unsupported. Server-tool
  fields are not evidence of client-tool support.
- **Apple:** the current Orbit Swift/text-only adapter explicitly reports
  unsupported. This requires no helper invocation or availability probe and
  does not claim that Apple's Foundation Models SDK lacks tool support.

OpenAI/Anthropic inspect the effective SDK `baseURL`. A previously constructed
client's route takes precedence over later environment changes. A supplied
client without a declared base URL is unknown. Compatibility URLs, unexpected
paths/query strings/credentials, and conflicting custom provider host settings
also remain unknown. Existing routing behavior is unchanged: the legacy SDK
constructors do not apply provider `host` settings, so a conflicting host cannot
be used to claim native capability. Unknown is intentionally permissive for
optional tool information rather than a native-route attestation.

Shared metadata parsing keeps the catalog/selection code's positive-only
eligibility rule distinct from this runtime unknown policy. The coding catalog
still lists only verified positive candidates; this change does not add unknown
models to existing selectors.

## Bounds and cancellation

Resolver discovery has a five-second deadline even if a custom adapter ignores
its signal. It passes a dedicated signal to cooperative metadata requests and
aborts that signal on timeout or caller cancellation. A timeout/error becomes
unknown; caller cancellation propagates with its reason. The resolver makes one
attempt, has no cross-call cache, and rejects an observation if model/provider
identity changed during discovery. No shared generation client's `abort()` is
called. Injected clients/custom adapters remain responsible for stopping their
own transport work when they receive a signal.

Built-in Ollama and Anthropic metadata waits are bounded independently when
`getCapabilities()` is called directly. Native fetch/SDK metadata receives the
request signal and timeout. Native-route catalog/adapter observations honor
pre-cancellation without making a request. No inference-based probe is provided.

## Verification and maintenance

The deterministic tests cover selected model metadata, native and compatible
routes, missing/malformed/failed discovery, deadlines/cancellation, identity
changes, legacy custom adapters, permissive unknown, unchanged invocation tool
specifications and public/package declarations. They stub metadata and prohibit
generation. Existing context, catalog and selection regressions remain in scope.

The OpenAI list is maintained in `openai-capabilities.ts`; extend it only with
specific Chat Completions/function-calling evidence. Unknown Ollama features stay
unknown until their absence semantics are recognized. Anthropic's active-record
rule follows the existing catalog contract; do not replace it with a Claude name
prefix check. Native API contract changes require fixture and documentation
updates rather than inference probes.

Sources: [Ollama show](https://docs.ollama.com/api-reference/show-model-details),
[OpenAI GPT-4o specification](https://developers.openai.com/api/docs/models/gpt-4o),
[Anthropic Models API](https://platform.claude.com/docs/en/api/models/retrieve),
and the [existing model catalog](model-catalog.md).

## Named observations

`ModelCapabilities.namedTools?: readonly string[]` optionally reports specific
supported names without enabling general tools or granting execution permission.
The shared resolver returns a fresh deduplicated list only when all names match
`[A-Za-z0-9_-]{1,64}` and at most 64 names are supplied. Malformed lists are omitted;
an explicit empty list is preserved. Missing observations remain absent. Identity
changes, failed discovery and older adapters do not inherit previous names.
The general `supported`/`unknown` inclusion and `unsupported` exclusion policy is
unchanged. The explicit Apple memory route reports general `unsupported` plus
only `project_memory_search`; hosts must opt into that named route.
