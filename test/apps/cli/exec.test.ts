// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import type {AgentOptions, Model} from '../../../src/core/models/index.js'

import {runExecCommand} from '../../../src/apps/cli/exec.js'
import {resolveAgentOptions} from '../../../src/core/chat.js'
import {Agent, Message, MessageType, OperatorType, Role} from '../../../src/core/models/index.js'

describe('runExecCommand', () => {
  it('builds a system and user message and passes them to model.invoke', async () => {
    const calls: {messages: Message[]; options?: AgentOptions}[] = []

    class TestAgent extends Agent {
      constructor(options: AgentOptions = {}) {
        super({
          ...options,
          deps: {
            createModel: (): Model => ({
              getModel() {
                return options.model?.name ?? ''
              },
              getName() {
                return OperatorType.Model
              },
              getProvider() {
                return options.model?.provider ?? 'ollama'
              },
              async invoke(messages) {
                calls.push({messages, options})
                return new Message(MessageType.Assistant, {content: 'mocked response'})
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
        contextLoader: async () => [
          {content: 'Workspace instructions', source: {kind: 'none'} as const},
          {content: 'Project instructions', source: {kind: 'none'} as const},
        ],
      },
    )

    expect(response).to.equal('mocked response')
    expect(
      calls.map((call) => ({
        messages: call.messages.map((message) => ({content: message.content, role: message.role})),
        options: {
          ...call.options,
          messages: call.options?.messages?.map((message) => ({content: message.content, role: message.role})),
        },
      })),
    ).to.deep.equal([
      {
        messages: [
          {
            content: 'Workspace instructions',
            role: Role.System,
          },
          {
            content: 'Project instructions',
            role: Role.System,
          },
          {content: 'hello', role: Role.User},
        ],
        options: {
          messages: [
            {
              content: 'Workspace instructions',
              role: Role.System,
            },
            {
              content: 'Project instructions',
              role: Role.System,
            },
          ],
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
              getName() {
                return OperatorType.Model
              },
              getProvider() {
                return options.model?.provider ?? 'ollama'
              },
              async invoke() {
                calls.push({options})
                return new Message(MessageType.Assistant, {content: 'ok'})
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
        contextLoader: async () => [{content: '', source: {kind: 'none'} as const}],
        settingsLoader: async () => ({model: 'claude-sonnet', provider: 'anthropic'}),
      },
    )

    expect(calls).to.deep.equal([
      {
        options: {
          messages: [],
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
