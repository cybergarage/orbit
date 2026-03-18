// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import type {Agent} from '../../src/core/models/index.js'

import {
  createInitialInteractiveState,
  handleModelCommand,
  submitInteractiveInput,
} from '../../src/core/interactive.js'

describe('interactive helpers', () => {
  it('starts with an empty session state', () => {
    expect(createInitialInteractiveState({model: 'llama3.1', provider: 'ollama'})).to.deep.equal({
      input: '',
      isLoading: false,
      messages: [],
      model: 'llama3.1',
      provider: 'ollama',
    })
  })

  it('appends user and assistant messages while keeping prior history', async () => {
    const agent: Agent = {
      async chat(messages) {
        return `reply:${messages.length}`
      },
    }
    const agentFactory = () => agent

    const first = await submitInteractiveInput(
      agentFactory,
      createInitialInteractiveState({model: 'llama3.1', provider: 'ollama'}),
      'hello',
    )
    const second = await submitInteractiveInput(agentFactory, first, 'again')

    expect(first.messages).to.deep.equal([
      {content: 'hello', role: 'user'},
      {content: 'reply:1', role: 'assistant'},
    ])
    expect(second.messages).to.deep.equal([
      {content: 'hello', role: 'user'},
      {content: 'reply:1', role: 'assistant'},
      {content: 'again', role: 'user'},
      {content: 'reply:3', role: 'assistant'},
    ])
  })

  it('ignores exit commands and empty input', async () => {
    const initial = createInitialInteractiveState({model: 'llama3.1', provider: 'ollama'})
    const agent: Agent = {
      async chat() {
        throw new Error('should not be called')
      },
    }
    const agentFactory = () => agent

    expect(await submitInteractiveInput(agentFactory, initial, '   ')).to.equal(initial)
    expect(await submitInteractiveInput(agentFactory, initial, '/exit')).to.equal(initial)
  })

  it('returns the current provider:model for /model', () => {
    const initial = createInitialInteractiveState({model: 'gpt-4o', provider: 'openai'})
    const result = handleModelCommand(initial, '/model')

    expect(result).to.deep.equal({
      message: 'Current model: openai:gpt-4o',
      nextState: initial,
    })
  })

  it('updates provider and model for /model provider:model', () => {
    const initial = createInitialInteractiveState({model: 'llama3.1', provider: 'ollama'})
    const result = handleModelCommand(initial, '/model anthropic:claude-opus-4-6')

    expect(result).to.deep.equal({
      message: 'Model switched to anthropic:claude-opus-4-6',
      nextState: {
        ...initial,
        model: 'claude-opus-4-6',
        provider: 'anthropic',
      },
    })
  })

  it('reports invalid /model syntax as an assistant message without calling the agent', async () => {
    let callCount = 0
    const agentFactory = (): Agent => ({
      async chat() {
        callCount++
        return 'should not run'
      },
    })

    const nextState = await submitInteractiveInput(
      agentFactory,
      createInitialInteractiveState({model: 'llama3.1', provider: 'ollama'}),
      '/model invalid',
    )

    expect(callCount).to.equal(0)
    expect(nextState.messages).to.deep.equal([
      {content: 'Invalid model command. Use /model provider:model', role: 'assistant'},
    ])
  })

  it('uses the switched provider and model for subsequent chat requests', async () => {
    const calls: {messages: string[]; model: string; provider: string}[] = []
    const agentFactory = (provider: 'anthropic' | 'ollama' | 'openai', model: string): Agent => ({
      async chat(messages) {
        calls.push({messages: messages.map((message) => message.content), model, provider})
        return `reply:${provider}:${model}`
      },
    })

    const switched = await submitInteractiveInput(
      agentFactory,
      createInitialInteractiveState({model: 'llama3.1', provider: 'ollama'}),
      '/model openai:gpt-4o',
    )
    const replied = await submitInteractiveInput(agentFactory, switched, 'hello')

    expect(calls).to.deep.equal([
      {
        messages: ['Model switched to openai:gpt-4o', 'hello'],
        model: 'gpt-4o',
        provider: 'openai',
      },
    ])
    expect(replied.messages).to.deep.equal([
      {content: 'Model switched to openai:gpt-4o', role: 'assistant'},
      {content: 'hello', role: 'user'},
      {content: 'reply:openai:gpt-4o', role: 'assistant'},
    ])
  })
})
