// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import type {Agent} from '../../../src/core/models/index.js'

import {runInteractiveCommand} from '../../../src/apps/cli/_interactive.js'

describe('runInteractiveCommand', () => {
  it('uses resolved workspace settings for the interactive session', async () => {
    const calls: {model: string | undefined; provider: string | undefined}[] = []
    const sessionCalls: {initialModel: string; initialProvider: string; systemPrompt?: string}[] = []

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
          options.getModel(options.initialProvider, options.initialModel)
        },
        {
          agentFactory(provider, model): Agent {
            calls.push({model, provider})
            return {
              getModel() {
                return model ?? ''
              },
              getProvider() {
                return provider ?? 'ollama'
              },
              async prompt() {
                return 'ok'
              },
            }
          },
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
        model: 'workspace-model',
        provider: 'openai',
      },
    ])
  })
})
