// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

// Provider wire fixtures use the API field names; rejection probes run sequentially.
/* eslint-disable camelcase, no-await-in-loop */
import {expect} from 'chai'

import type {ModelGatewayOptions, WorkspaceSettings} from '../../src/core/index.js'

import {ModelGateway} from '../../src/core/index.js'
const configured: WorkspaceSettings = {providers: {openai: {apiKey: 'fake-test-openai'}}}
const both: WorkspaceSettings = {
  providers: {anthropic: {apiKey: 'fake-test-claude'}, openai: {apiKey: 'fake-test-openai'}},
}
describe('Provider transport', () => {
  describe('ModelGateway', () => {
    it('routes only to the admitted OpenAI adapter endpoint, clamps output and hides credentials', async () => {
      let request: Record<string, unknown> = {}
      const options: ModelGatewayOptions = {
        openai: {
          chat: {
            completions: {
              async create(body: unknown) {
                request = body as Record<string, unknown>
                return {id: 'response'}
              },
            },
          },
        } as unknown as ModelGatewayOptions['openai'],
      }
      const gateway = new ModelGateway(configured, {model: 'gpt-4o', provider: 'openai'}, options)
      await gateway.request(
        'openai-chat',
        {apiKey: 'untrusted', max_completion_tokens: 999_999, messages: [], model: 'gpt-4o'},
        new AbortController().signal,
      )
      expect(request).include({max_completion_tokens: 1024, model: 'gpt-4o', stream: false})
      expect(JSON.stringify(request)).not.contain('fake-test').and.not.contain('untrusted')
      for (const [route, body] of [
        ['chat', {}],
        ['openai-chat', {model: 'another-model'}],
      ] as const) {
        let rejected = false
        try {
          await gateway.request(route, body, new AbortController().signal)
        } catch {
          rejected = true
        }

        expect(rejected).equal(true)
      }
    })

    it('uses Claude Messages and metadata routes, and sanitizes provider failures', async () => {
      let called = ''
      const options: ModelGatewayOptions = {
        anthropic: {
          messages: {
            async create() {
              called = 'messages'
              throw new Error('Authorization: fake-test-claude SECRET')
            },
          },
          models: {
            async retrieve() {
              called = 'metadata'
              return {max_input_tokens: 100_000, max_tokens: 4096}
            },
          },
        } as unknown as ModelGatewayOptions['anthropic'],
      }
      const gateway = new ModelGateway(both, {model: 'claude-listed', provider: 'anthropic'}, options)
      await gateway.request('anthropic-model', {}, new AbortController().signal)
      expect(called).equal('metadata')
      let error = ''
      try {
        await gateway.request(
          'anthropic-messages',
          {messages: [], model: 'claude-listed'},
          new AbortController().signal,
        )
      } catch (error_) {
        error = String(error_)
      }

      expect(called).equal('messages')
      expect(error).contain('Model request failed').and.not.contain('SECRET').and.not.contain('fake-test')
    })
  })

  // No SDK inference is performed: each adapter's injected client rejects locally.
  describe('Provider authentication redaction', () => {
    it('keeps key fragments out of native adapter exceptions and diagnostics', async () => {
      const {OpenAIAgent} = await import('../../src/core/models/adapters/openai.js')
      const {AnthropicAgent} = await import('../../src/core/models/adapters/anthropic.js')
      const {DiagnosticEventBus, Message, MessageType} = await import('../../src/core/index.js')
      const failure = Object.assign(new Error('Incorrect API key: PRIVATE-KEY-FRAGMENT'), {status: 401})
      const openai = {
        chat: {
          completions: {
            async create() {
              throw failure
            },
          },
        },
      } as unknown as ModelGatewayOptions['openai']
      const anthropic = {
        messages: {
          async create() {
            throw failure
          },
        },
      } as unknown as ModelGatewayOptions['anthropic']
      for (const adapter of [
        new OpenAIAgent(
          'gpt-4o',
          {getAPIKey:()=>'fake-unused-key', getHost:()=>'https://provider.invalid', getName: () => 'openai'},
          {client: openai},
        ),
        new AnthropicAgent(
          'claude-fixture',
          {getAPIKey:()=>'fake-unused-key', getHost:()=>'https://provider.invalid', getName: () => 'anthropic'},
          {client: anthropic},
        ),
      ]) {
        const diagnostics = new DiagnosticEventBus()
        let message = ''
        try {
          await adapter.invoke([new Message(MessageType.User, {content: 'mock'})], {diagnostics})
        } catch (error) {
          message = String(error)
        }

        expect(message).contain('authentication was rejected').and.not.contain('PRIVATE-KEY')
        expect(JSON.stringify(diagnostics.list())).not.contain('PRIVATE-KEY')
      }
    })
  })
})
