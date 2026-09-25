# Model context capacity

`resolveModelContextCapacity(model, options)` reads provider metadata and
reconciles it with runtime settings. It does not generate text or load an Ollama
model. Use it with a Model or `agent.getModel()`:

```ts
import {getModel, resolveModelContextCapacity} from '@cybergarage/orbit'

const model = getModel('ollama', 'example-model', {
  providers: {ollama: {contextWindow: 32768}},
})
const capacity = await resolveModelContextCapacity(model, {
  outputReserve: 4096,
  safetyMargin: 256,
})
console.log(capacity.effectiveContextWindow, capacity.inputBudget)
```

The result contains model/provider identity, metadata source (`api`, `catalog`,
or `unknown`), the model's shared `contextWindow`, independent `maxInputTokens`
and `maxOutputTokens`, `runtimeContextWindow`, `effectiveContextWindow`, and
`inputBudget`. The runtime field reports the adapter observation/configuration;
an explicit resolver override is reflected in the effective window. Missing limits are null, never zero or unlimited. A configured
fallback is an operator assertion even when metadata source is `unknown`.

## Resolution

`providers.<provider>.contextWindow` is an optional positive safe integer.
For Ollama it sets `options.num_ctx` on every request. For cloud providers it is
an application accounting ceiling. Direct Model callers can override the runtime
setting with `ModelInvokeOptions.contextWindow`; pass that same value to capacity
resolution. Merely calling the resolver does not change subsequent invocations.
A caller-selected `windowLimit` is an additional accounting ceiling. It never
increases a known runtime window, but supplies a manual fallback when runtime
information is unavailable.

The effective shared window is the smallest known model maximum, selected runtime
window and accounting ceiling. For shared windows, the input budget subtracts
`outputReserve`. An independent input limit constrains input separately; it is
not mistaken for a shared input-plus-output limit. The smaller applicable input
limit then subtracts `safetyMargin`, with a floor of zero. Reserves default to
zero for inspection; supply the intended output allowance for admission. An
output reserve beyond a known output maximum is rejected.

Ollama uses `POST /api/show` and `GET /api/ps`. The architecture-specific
`model_info[architecture + '.context_length']` declares model capacity. Runtime
selection prefers explicit configuration, then a matching loaded model's
`context_length`, then a Modelfile `num_ctx`. An unloaded model with no runtime
setting has unknown effective capacity even when its model maximum is known.
Discovery does not allocate the model's maximum context or estimate available RAM.
Loaded context is a point-in-time observation; budgeted dispatch pins its resolved
window in `num_ctx` to avoid relying on a later default or another client's load.

Anthropic uses `GET /v1/models/{id}`. Its nullable `max_input_tokens` and
`max_tokens` become independent input/output limits. Older responses without
these fields remain unknown. The installed SDK need not declare these extension
fields: Orbit validates the returned JSON numbers. No model-name heuristic fills
missing Anthropic fields.

Built-in discovery waits at most five seconds per endpoint and honors caller
cancellation. Transport errors, unsupported discovery clients and invalid/missing
metadata fall back to explicit settings where available. Cancellation propagates
instead of becoming fallback. No process-wide metadata cache is used. Custom
Models may implement the optional `getContextInfo({signal})` contract; they own
cancellation and bounded discovery. Injected Ollama clients should expose `show`
and `ps` and honor their own transport deadlines.

## Budgeted requests

Existing [budgeted preparation](context-compaction.md) calls the resolver before
each preparation. The profile window remains an explicit ceiling/fallback;
provider discovery can reduce it. Ordinary and summary output caps must fit the
provider output limit. Independent input limits constrain both requests. Trigger
and target are lowered when the effective window shrinks, and the resulting
profile is validated before dispatch. The caller's original profile is unchanged.
Ollama receives the resolved window and the prepared output cap on the wire.

Disabled budgeting remains disabled and ordinary unbudgeted invocations do not
perform metadata discovery. Discovery does not change transcript formats, enable
budgeting, or repair truncated output. Budgeted preparation supports within-turn
compaction as described in the [input budget guide](context-compaction.md). Transport wrappers must not
overwrite prepared `num_ctx` or `num_predict` after accounting; the E2E wrapper
now exposes its configured context and lets prepared values take precedence.

## OpenAI catalog

The Models API does not expose context/output capacity. Orbit includes an exact-ID
catalog, verified against official specifications on 2026-09-25:

| Model IDs                                          | Shared window | Maximum output | Official specification                                                   |
| -------------------------------------------------- | ------------: | -------------: | ------------------------------------------------------------------------ |
| `gpt-4o`, `gpt-4o-2024-08-06`, `gpt-4o-2024-11-20` |       128,000 |         16,384 | [GPT-4o](https://developers.openai.com/api/docs/models/gpt-4o)           |
| `gpt-4o-mini`, `gpt-4o-mini-2024-07-18`            |       128,000 |         16,384 | [GPT-4o mini](https://developers.openai.com/api/docs/models/gpt-4o-mini) |
| `gpt-4.1`, `gpt-4.1-2025-04-14`                    |     1,047,576 |         32,768 | [GPT-4.1](https://developers.openai.com/api/docs/models/gpt-4.1)         |
| `gpt-5-mini`                                       |       400,000 |        128,000 | [GPT-5 mini](https://developers.openai.com/api/docs/models/gpt-5-mini)   |
| `gpt-5.2`                                          |       400,000 |        128,000 | [GPT-5.2](https://developers.openai.com/api/docs/models/gpt-5.2)         |
| `gpt-5.4`                                          |     1,050,000 |        128,000 | [GPT-5.4](https://developers.openai.com/api/docs/models/gpt-5.4)         |

Other IDs, including unlisted snapshots, fine-tunes, and similarly named models,
remain unknown and require explicit configuration. The catalog describes
capacity, not endpoint/tool compatibility or availability. Add entries only after
checking the exact official model specification and updating this table and tests.

See also [OpenAI Models API](https://developers.openai.com/api/reference/typescript/resources/models/methods/retrieve),
[Anthropic Models API](https://platform.claude.com/docs/en/api/typescript/models),
[Ollama model information](https://github.com/ollama/ollama/blob/6383a0fa9cbf97494b847226e189f6e36b401a08/docs/api.md#show-model-information),
and [Ollama running models](https://docs.ollama.com/api/ps).
