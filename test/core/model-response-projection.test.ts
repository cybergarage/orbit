// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import {createProvider, Message, MessageType} from '../../src/core/index.js'
import {toAnthropicMessage} from '../../src/core/models/adapters/anthropic.js'
import {toOllamaMessage} from '../../src/core/models/adapters/ollama.js'
import {OpenAIAgent, toOpenAIMessage} from '../../src/core/models/adapters/openai.js'

describe('model response projection', () => {
  for (const [content, refusal, transcript, expected] of [
    [null, 'Refused.', 'Transcript.', 'Refused.'],
    ['', 'Refused.', 'Transcript.', 'Refused.'],
    ['Answer.', 'Refused.', 'Transcript.', 'Answer.'],
    ['', '', 'Transcript.', 'Transcript.'],
    [null, null, '', ''],
  ]) {
    it(`keeps display text and parts for ${JSON.stringify([content, refusal, transcript])}`, async () => {
      const client = {
        chat: {
          completions: {
            async create() {
              return {
                choices: [
                  {
                    finish_reason: 'stop',
                    message: {
                      audio: {data: 'YQ==', expires_at: 0, id: 'audio-1', transcript},
                      content,
                      refusal,
                      role: 'assistant',
                    },
                  },
                ],
                id: 'response-1',
                model: 'fixture',
              }
            },
          },
        },
      } as unknown as NonNullable<ConstructorParameters<typeof OpenAIAgent>[2]>['client']
      const response = await new OpenAIAgent('fixture', createProvider('openai'), {client}).invoke([])
      expect(response.content).to.equal(expected)
      const payload = response.payload as {parts: Array<{text?: string; type: string}>}
      if (refusal) expect(payload.parts).to.deep.include({text: refusal, type: 'refusal'})
      if (content) expect(payload.parts).to.deep.include({text: content, type: 'text'})
      expect(payload.parts.some((part) => part.type === 'audio')).to.equal(true)
    })
  }

  for (const [outer, inner] of [
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ]) {
    it(`preserves tool failure with outer=${outer} and inner=${inner}`, () => {
      const message = new Message(MessageType.Tool, {
        payload: {
          input: {},
          isError: outer,
          name: 'read',
          output: {content: [{text: 'Fixture result.', type: 'text'}], isError: inner},
          toolCallId: 'read-1',
        },
      })
      const anthropic = toAnthropicMessage(message).content
      expect(anthropic).to.deep.equal([
        {
          content: 'Fixture result.',
          tool_use_id: 'read-1',
          type: 'tool_result',
          ...(outer || inner ? {is_error: true} : {}),
        },
      ])
      const text = outer || inner ? 'Tool error: Fixture result.' : 'Fixture result.'
      expect(toOpenAIMessage(message).content).to.equal(text)
      expect(toOllamaMessage(message).content).to.equal(text)
    })
  }
})
