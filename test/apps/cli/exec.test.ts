// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import type {AgentOptions, Model, Prompt} from '../../../src/core/models/index.js'

import {runExecCommand} from '../../../src/apps/cli/exec.js'
import {resolveAgentOptions} from '../../../src/core/chat.js'
import {Agent} from '../../../src/core/models/index.js'

describe('runExecCommand', () => {
  it('builds a system and user message and passes them to model.prompt', async () => {
    const calls: {messages: Prompt[]; options?: AgentOptions}[] = []

    class TestAgent extends Agent {
      constructor(options: AgentOptions = {}) {
        super({
          ...options,
          deps: {
            createModel: (): Model => ({
              getModel() {
                return options.model?.name ?? ''
              },
              getProvider() {
                return options.model?.provider ?? 'ollama'
              },
              async prompt(messages) {
                calls.push({messages, options})
                return {content: 'mocked response', role: 'assistant'}
              },
            }),
          },
        })
      }
    }

    const response = await runExecCommand(
      {lang: 'ja', model: 'test-model', prompt: 'hello', provider: 'ollama'},
      undefined,
      '/tmp/workspace',
      {
        agentClass: TestAgent,
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
        options: {
          model: {
            name: 'test-model',
            provider: 'ollama',
          },
        },
      },
    ])
  })

  it('uses workspace provider and model when CLI values are omitted', async () => {
    const calls: {options?: AgentOptions}[] = []

    class TestAgent extends Agent {
      constructor(options: AgentOptions = {}) {
        super({
          ...options,
          deps: {
            createModel: (): Model => ({
              getModel() {
                return options.model?.name ?? ''
              },
              getProvider() {
                return options.model?.provider ?? 'ollama'
              },
              async prompt() {
                calls.push({options})
                return {content: 'ok', role: 'assistant'}
              },
            }),
          },
        })
      }
    }

    await runExecCommand(
      {prompt: 'hello'},
      undefined,
      '/tmp/workspace',
      {
        agentClass: TestAgent,
        contextLoader: async () => ({source: {kind: 'none'} as const, text: ''}),
        settingsLoader: async () => ({model: 'claude-sonnet', provider: 'anthropic'}),
      },
    )

    expect(calls).to.deep.equal([
      {
        options: {
          model: {
            name: 'claude-sonnet',
            provider: 'anthropic',
          },
        },
      },
    ])
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
