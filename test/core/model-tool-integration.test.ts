// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable camelcase -- Provider protocol fixtures use wire-format field names. */

import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {Agent, createProvider, Message, MessageType, ToolProfile} from '../../src/core/index.js'
import {OllamaAgent} from '../../src/core/models/adapters/ollama.js'
import {OpenAIAgent} from '../../src/core/models/adapters/openai.js'

describe('model tool integration', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-model-tools-'))
    await fs.writeFile(path.join(root, 'sample.txt'), 'hello')
  })

  afterEach(async () => {
    await fs.rm(root, {force: true, recursive: true})
  })

  it('runs an OpenAI function call through a built-in tool and returns its result', async () => {
    const requests: Array<{messages: Array<Record<string, unknown>>}> = []
    const responses = [
      {
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              content: null,
              refusal: null,
              role: 'assistant',
              tool_calls: [
                {
                  function: {arguments: JSON.stringify({path: 'sample.txt'}), name: 'read'},
                  id: 'call-read',
                  type: 'function',
                },
              ],
            },
          },
        ],
        id: 'chatcmpl-tool',
        model: 'gpt-test',
      },
      {
        choices: [
          {
            finish_reason: 'stop',
            message: {content: 'done', refusal: null, role: 'assistant'},
          },
        ],
        id: 'chatcmpl-final',
        model: 'gpt-test',
      },
    ]
    const client = {
      chat: {
        completions: {
          async create(request: unknown) {
            requests.push(request as {messages: Array<Record<string, unknown>>})
            return responses.shift()
          },
        },
      },
    }
    const model = new OpenAIAgent('gpt-test', createProvider('openai'), {client: client as never})
    const agent = new Agent({
      cwd: root,
      deps: {createModel: () => model},
      settings: {tools: {include: ['read'], profile: ToolProfile.None}},
    })

    try {
      const response = await agent.invoke([new Message(MessageType.User, {content: 'Read sample.txt'})])

      expect(response.content).to.equal('done')
      expect(requests).to.have.length(2)
      const assistantMessage = requests[1].messages.find((message) => Array.isArray(message.tool_calls))
      const toolMessage = requests[1].messages.find((message) => message.role === 'tool')
      expect(assistantMessage?.tool_calls).to.deep.equal([
        {
          function: {arguments: JSON.stringify({path: 'sample.txt'}), name: 'read'},
          id: 'call-read',
          type: 'function',
        },
      ])
      expect(toolMessage).to.include({content: 'hello', role: 'tool', tool_call_id: 'call-read'})
    } finally {
      await agent.close()
    }
  })

  it('preserves OpenAI refusal output instead of returning an empty response', async () => {
    const client = {
      chat: {
        completions: {
          async create() {
            return {
              choices: [
                {
                  finish_reason: 'content_filter',
                  message: {content: null, refusal: 'Request refused.', role: 'assistant'},
                },
              ],
              id: 'chatcmpl-refusal',
              model: 'gpt-test',
            }
          },
        },
      },
    }
    const model = new OpenAIAgent('gpt-test', createProvider('openai'), {client: client as never})

    const response = await model.invoke([new Message(MessageType.User, {content: 'Hello'})])

    expect(response.content).to.equal('Request refused.')
    expect(response.payload).to.deep.include({
      parts: [{text: 'Request refused.', type: 'refusal'}],
    })
  })

  it('rejects malformed OpenAI responses without choices', async () => {
    const client = {
      chat: {
        completions: {
          async create() {
            return {choices: [], id: 'chatcmpl-empty', model: 'gpt-test'}
          },
        },
      },
    }
    const model = new OpenAIAgent('gpt-test', createProvider('openai'), {client: client as never})

    try {
      await model.invoke([new Message(MessageType.User, {content: 'Hello'})])
      expect.fail('Expected an empty completion to fail.')
    } catch (error) {
      expect(error).to.be.instanceOf(Error)
      expect((error as Error).message).to.equal('OpenAI returned a chat completion without choices.')
    }
  })

  it('runs an Ollama function call and replays thinking and images with the tool result', async () => {
    const requests: Array<{messages: Array<Record<string, unknown>>}> = []
    const responses = [
      ollamaResponse({
        content: '',
        images: ['aW1hZ2U='],
        thinking: 'I should read the file.',
        tool_calls: [{function: {arguments: {path: 'sample.txt'}, name: 'read'}}],
      }),
      ollamaResponse({content: 'done', thinking: 'I found the answer.'}),
    ]
    const client = {
      abort() {},
      async chat(request: unknown) {
        requests.push(request as {messages: Array<Record<string, unknown>>})
        return responses.shift()
      },
    }
    const model = new OllamaAgent('qwen-test', createProvider('ollama'), {client: client as never})
    const agent = new Agent({
      cwd: root,
      deps: {createModel: () => model},
      settings: {tools: {include: ['read'], profile: ToolProfile.None}},
    })

    try {
      const response = await agent.invoke([new Message(MessageType.User, {content: 'Read sample.txt'})])

      expect(response.content).to.equal('done')
      expect(response.payload).to.deep.include({
        parts: [
          {text: 'I found the answer.', type: 'reasoning'},
          {text: 'done', type: 'text'},
        ],
      })
      expect(requests).to.have.length(2)
      const assistantMessage = requests[1].messages.find((message) => Array.isArray(message.tool_calls))
      const toolMessage = requests[1].messages.find((message) => message.role === 'tool')
      expect(assistantMessage).to.deep.include({
        content: '',
        images: ['aW1hZ2U='],
        role: 'assistant',
        thinking: 'I should read the file.',
      })
      expect(toolMessage).to.include({content: 'hello', role: 'tool', tool_name: 'read'})
    } finally {
      await agent.close()
    }
  })
})

function ollamaResponse(message: Record<string, unknown>) {
  return {
    created_at: new Date('2026-08-23T00:00:00.000Z'),
    done: true,
    done_reason: 'stop',
    eval_count: 3,
    eval_duration: 4,
    load_duration: 2,
    message: {role: 'assistant', ...message},
    model: 'qwen-test',
    prompt_eval_count: 5,
    prompt_eval_duration: 3,
    total_duration: 9,
  }
}
