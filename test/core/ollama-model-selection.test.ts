// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import {selectOllamaModel} from '../../src/core/models/adapters/ollama.js'
import {createProvider} from '../../src/core/models/provider.js'

describe('Ollama model selection', () => {
  it('selects an explicitly requested installed model', async () => {
    const client = createClient([
      {model: 'llama3.1:latest', name: 'llama3.1:latest'},
      {model: 'qwen3:latest', name: 'qwen3:latest'},
    ])

    const model = await selectOllamaModel(createProvider('ollama'), {requestedModel: 'qwen3'}, client as never)

    expect(model).to.equal('qwen3:latest')
    expect(client.showCalls).to.deep.equal([])
  })

  it('rejects an explicitly requested model that is not installed', async () => {
    const client = createClient([{model: 'llama3.1:latest', name: 'llama3.1:latest'}])

    await expectRejected(
      selectOllamaModel(createProvider('ollama'), {requestedModel: 'missing-model'}, client as never),
      'Ollama model is not installed: missing-model',
    )
  })

  it('selects the first installed model that reports tool support', async () => {
    const client = createClient(
      [
        {model: 'embedding-model:latest', name: 'embedding-model:latest'},
        {model: 'qwen3:latest', name: 'qwen3:latest'},
      ],
      {
        'embedding-model:latest': ['embedding'],
        'qwen3:latest': ['completion', 'tools'],
      },
    )

    const model = await selectOllamaModel(createProvider('ollama'), {}, client as never)

    expect(model).to.equal('qwen3:latest')
    expect(client.showCalls).to.deep.equal(['embedding-model:latest', 'qwen3:latest'])
  })

  it('reports empty and tool-incompatible installations', async () => {
    await expectRejected(
      selectOllamaModel(createProvider('ollama'), {}, createClient([]) as never),
      'Ollama has no installed models',
    )

    await expectRejected(
      selectOllamaModel(
        createProvider('ollama'),
        {},
        createClient([{model: 'embed:latest', name: 'embed:latest'}], {'embed:latest': ['embedding']}) as never,
      ),
      'No installed Ollama model reports the tools capability',
    )
  })
})

function createClient(
  models: Array<{model: string; name: string}>,
  capabilities: Record<string, string[]> = {},
): {
  list(): Promise<{models: Array<{model: string; name: string}>}>
  show(request: {model: string}): Promise<{capabilities: string[]}>
  showCalls: string[]
} {
  const showCalls: string[] = []
  return {
    async list() {
      return {models}
    },
    async show({model}) {
      showCalls.push(model)
      return {capabilities: capabilities[model] ?? []}
    },
    showCalls,
  }
}

async function expectRejected(promise: Promise<unknown>, message: string): Promise<void> {
  try {
    await promise
    expect.fail('Expected model selection to reject.')
  } catch (error) {
    expect((error as Error).message).to.contain(message)
  }
}
