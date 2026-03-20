// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import type {Agent, Prompt} from '../../../src/core/models/index.js'

import {runExecCommand} from '../../../src/apps/cli/exec.js'
import {resolveAgentOptions} from '../../../src/core/chat.js'

describe('runExecCommand', () => {
  it('builds a system and user message and passes them to model.prompt', async () => {
    const calls: {messages: Prompt[]; model: string | undefined; provider: string | undefined}[] = []

    const response = await runExecCommand(
      {lang: 'ja', model: 'test-model', prompt: 'hello', provider: 'ollama'},
      undefined,
      '/tmp/workspace',
      {
        agentFactory: (provider, model): Agent => ({
          getModel() {
            return model ?? ''
          },
          getProvider() {
            return provider ?? 'ollama'
          },
          async prompt(messages) {
            calls.push({messages, model, provider})
            return 'mocked response'
          },
        }),
        contextLoader: async () => ({source: {kind: 'none'} as const, text: 'Workspace instructions'}),
      },
    )

    expect(response).to.equal('mocked response')
    expect(calls).to.deep.equal([
      {
        messages: [
          {
            content:
              'IMPORTANT: You MUST respond in Japanese only. Do not use any other language, regardless of the language used in the rest of this prompt or in the user message.\n\nWorkspace instructions',
            role: 'system',
          },
          {content: 'hello', role: 'user'},
        ],
        model: 'test-model',
        provider: 'ollama',
      },
    ])
  })

  it('uses workspace provider and model when CLI values are omitted', async () => {
    const calls: {model: string | undefined; provider: string | undefined}[] = []

    await runExecCommand(
      {prompt: 'hello'},
      undefined,
      '/tmp/workspace',
      {
        agentFactory: (provider, model): Agent => ({
          getModel() {
            return model ?? ''
          },
          getProvider() {
            return provider ?? 'ollama'
          },
          async prompt() {
            calls.push({model, provider})
            return 'ok'
          },
        }),
        contextLoader: async () => ({source: {kind: 'none'} as const, text: ''}),
        settingsLoader: async () => ({model: 'claude-sonnet', provider: 'anthropic'}),
      },
    )

    expect(calls).to.deep.equal([{model: 'claude-sonnet', provider: 'anthropic'}])
  })

  it('keeps CLI provider and model ahead of workspace settings', () => {
    expect(
      resolveAgentOptions(
        {model: 'cli-model', provider: 'openai'},
        {model: 'workspace-model', provider: 'ollama'},
      ),
    ).to.deep.equal({
      lang: undefined,
      model: 'cli-model',
      provider: 'openai',
    })
  })
})
