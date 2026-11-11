// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {Ollama} from 'ollama'

import {getModel} from '../dist/core/index.js'
import {OllamaAgent, ollamaFetch} from '../dist/core/models/adapters/ollama.js'

/** Credentials remain in the process environment, never in experiment configuration. */
export function createEvaluationModel(config, env = process.env) {
  const provider = config.provider ?? 'ollama'
  if (!['anthropic', 'ollama', 'openai'].includes(provider)) throw new Error('Unsupported evaluation provider')
  if (typeof config.model !== 'string' || !config.model.trim())
    throw new Error('An explicit evaluation model is required')
  if (provider !== 'ollama') {
    const apiKeyEnv = `ORBIT_TEST_${provider.toUpperCase()}_API_KEY`
    if (!env[apiKeyEnv]?.trim()) throw new Error(`Missing evaluation credential: ${apiKeyEnv}`)
    return {
      close() {},
      model: getModel(provider, config.model, {providers: {[provider]: {apiKeyEnv}}}),
    }
  }

  const sdk = new Ollama({fetch: ollamaFetch, host: config.ollamaHost})
  return {
    close: () => sdk.abort(),
    model: new OllamaAgent(
      config.model,
      {getContextWindow: () => config.options.num_ctx, getName: () => 'ollama'},
      {
        client: {
          abort: () => sdk.abort(),
          chat: (request) =>
            sdk.chat({
              ...request,
              keep_alive: '60s',
              options: {...config.options, ...request.options},
              think: config.think,
            }),
          ps: () => sdk.ps(),
          show: (request) => sdk.show(request),
        },
      },
    ),
  }
}
