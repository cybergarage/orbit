// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import type {AgentOptions, Model} from '../../../src/core/models/index.js'

import {runInteractiveCommand} from '../../../src/apps/cli/_interactive.js'
import {Agent, Message, MessageType} from '../../../src/core/models/index.js'

describe('runInteractiveCommand', () => {
  it('uses resolved workspace settings for the interactive session', async () => {
    const calls: {options?: AgentOptions}[] = []
    const sessionCalls: {initialModel: string; initialProvider: string; systemPrompt?: string}[] = []

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
              getProvider() {
                return options.model?.provider ?? 'ollama'
              },
              async prompt() {
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
        {lang: 'ja'},
        async (options) => {
          sessionCalls.push({
            initialModel: options.initialModel,
            initialProvider: options.initialProvider,
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
          contextLoader: async () => ({source: {kind: 'none'} as const, text: 'Workspace context'}),
          settingsLoader: async () => ({model: 'workspace-model', provider: 'openai'}),
        },
      )
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', {configurable: true, value: previousStdin})
      Object.defineProperty(process.stdout, 'isTTY', {configurable: true, value: previousStdout})
    }

    expect(sessionCalls).to.deep.equal([
      {
        initialModel: 'workspace-model',
        initialProvider: 'openai',
        systemPrompt:
          'IMPORTANT: You MUST respond in Japanese only. Do not use any other language, regardless of the language used in the rest of this prompt or in the user message.\n\nWorkspace context',
      },
    ])
    expect(calls).to.deep.equal([
      {
        options: {
          model: {
            name: 'workspace-model',
            provider: 'openai',
          },
        },
      },
    ])
  })
})
