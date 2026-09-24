// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import type {AgentOptions, Model} from '../../../src/core/models/index.js'

import {runInteractiveCommand} from '../../../src/apps/cli/_interactive.js'
import {createInitialInteractiveState, handleModelCommand} from '../../../src/core/interactive.js'
import {Agent, Message, MessageType, OperatorType} from '../../../src/core/models/index.js'

describe('runInteractiveCommand', () => {
  it('reports the discovered Ollama model through /model', async () => {
    const calls: {options?: AgentOptions}[] = []
    const sessionCalls: Array<Record<string, unknown>> = []

    class TestAgent extends Agent {
      constructor(options: AgentOptions = {}) {
        calls.push({options})
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
                return new Message(MessageType.Assistant, {content: 'ok'})
              },
            }),
          },
        })
      }
    }

    const previousStdin = process.stdin.isTTY
    const previousStdout = process.stdout.isTTY
    Object.defineProperty(process.stdin, 'isTTY', {configurable: true, value: true})
    Object.defineProperty(process.stdout, 'isTTY', {configurable: true, value: true})

    try {
      await runInteractiveCommand(
        {debug: true, lang: 'ja'},
        async (options) => {
          sessionCalls.push({
            debugEnabled: options.debug ?? false,
            initialModel: options.initialModel,
            initialProvider: options.initialProvider,
            modelMessage: handleModelCommand(
              createInitialInteractiveState({model: options.initialModel, provider: options.initialProvider}),
              '/model',
            )?.message,
            systemPrompt: options.systemPrompt,
          })
          const SessionAgent = options.agentClass
          const agent = new SessionAgent({
            model: {
              name: options.initialModel,
              provider: options.initialProvider,
            },
          })
          expect(agent).to.be.instanceOf(Agent)
        },
        {
          agentClass: TestAgent,
          contextLoader: async () => [{content: 'Workspace context', source: {kind: 'none'} as const}],
          ollamaModelSelector: async () => 'qwen3:latest',
          settingsLoader: async () => ({provider: 'ollama'}),
          async storagePreflight() {},
        },
      )
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', {configurable: true, value: previousStdin})
      Object.defineProperty(process.stdout, 'isTTY', {configurable: true, value: previousStdout})
    }

    expect(sessionCalls).to.deep.equal([
      {
        debugEnabled: true,
        initialModel: 'qwen3:latest',
        initialProvider: 'ollama',
        modelMessage: 'Current model: ollama:qwen3:latest',
        systemPrompt: 'Workspace context',
      },
    ])
    expect(calls).to.deep.equal([
      {
        options: {
          model: {
            name: 'qwen3:latest',
            provider: 'ollama',
          },
        },
      },
    ])
  })
})
