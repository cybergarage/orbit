// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {z} from 'zod'

import {Message, MessageType, tool} from '../../src/core/index.js'
import {
  toAnthropicMessage,
  toAnthropicModelToolCall,
  toAnthropicTool,
} from '../../src/core/models/adapters/anthropic.js'
import {
  toOllamaMessage,
  toOllamaModelToolCall,
  toOllamaTool,
} from '../../src/core/models/adapters/ollama.js'
import {
  toOpenAIMessage,
  toOpenAIModelToolCall,
  toOpenAITool,
} from '../../src/core/models/adapters/openai.js'

describe('model adapter tools', () => {
  const searchTool = tool(({query}: {query: string}) => `result:${query}`, {
    description: 'Search for a value.',
    name: 'search',
    schema: z.object({query: z.string()}),
  })
  const toolCallMessage = new Message(MessageType.Assistant, {
    content: 'checking',
    payload: {
      toolCalls: [{id: 'call-1', input: {query: 'orbit'}, name: 'search'}],
    },
  })
  const toolResultMessage = new Message(MessageType.Tool, {
    payload: {
      input: {query: 'orbit'},
      isError: false,
      name: 'search',
      output: {value: 'ok'},
      toolCallId: 'call-1',
    },
  })

  it('serializes OpenAI tool definitions and messages', () => {
    const openAITool = toOpenAITool(searchTool) as unknown as {
      function: {description?: string; name?: string; parameters?: Record<string, unknown>}
    }
    const assistantMessage = toOpenAIMessage(toolCallMessage) as unknown as Record<string, unknown>
    const toolMessage = toOpenAIMessage(toolResultMessage) as unknown as Record<string, unknown>

    expect(openAITool.function.name).to.equal('search')
    expect(openAITool.function.description).to.equal('Search for a value.')
    expect(openAITool.function.parameters).to.include({type: 'object'})
    expect(assistantMessage.role).to.equal('assistant')
    expect(assistantMessage.tool_calls).to.deep.equal([
      {
        function: {
          arguments: JSON.stringify({query: 'orbit'}),
          name: 'search',
        },
        id: 'call-1',
        type: 'function',
      },
    ])
    expect(toolMessage).to.include({
      content: JSON.stringify({value: 'ok'}),
      role: 'tool',
      'tool_call_id': 'call-1',
    })
  })

  it('parses OpenAI tool calls', () => {
    expect(toOpenAIModelToolCall({
      function: {
        arguments: JSON.stringify({query: 'orbit'}),
        name: 'search',
      },
      id: 'call-1',
      type: 'function',
    })).to.deep.equal({
      id: 'call-1',
      input: {query: 'orbit'},
      name: 'search',
    })
  })

  it('serializes Anthropic tool definitions and messages', () => {
    const anthropicTool = toAnthropicTool(searchTool)
    const assistantMessage = toAnthropicMessage(toolCallMessage)
    const toolMessage = toAnthropicMessage(toolResultMessage)

    expect(anthropicTool.name).to.equal('search')
    expect(anthropicTool.description).to.equal('Search for a value.')
    expect(anthropicTool.input_schema).to.include({type: 'object'})
    expect(assistantMessage.role).to.equal('assistant')
    expect(assistantMessage.content).to.deep.equal([
      {text: 'checking', type: 'text'},
      {id: 'call-1', input: {query: 'orbit'}, name: 'search', type: 'tool_use'},
    ])
    expect(toolMessage.role).to.equal('user')
    expect(toolMessage.content).to.deep.equal([
      {
        content: JSON.stringify({value: 'ok'}),
        'tool_use_id': 'call-1',
        type: 'tool_result',
      },
    ])
  })

  it('parses Anthropic tool calls', () => {
    expect(toAnthropicModelToolCall({
      caller: {type: 'direct'},
      id: 'call-1',
      input: {query: 'orbit'},
      name: 'search',
      type: 'tool_use',
    })).to.deep.equal({
      id: 'call-1',
      input: {query: 'orbit'},
      name: 'search',
    })
  })

  it('serializes Ollama tool definitions and messages', () => {
    const ollamaTool = toOllamaTool(searchTool)
    const assistantMessage = toOllamaMessage(toolCallMessage)
    const toolMessage = toOllamaMessage(toolResultMessage)

    expect(ollamaTool.function.name).to.equal('search')
    expect(ollamaTool.function.description).to.equal('Search for a value.')
    expect(ollamaTool.function.parameters).to.include({type: 'object'})
    expect(assistantMessage.tool_calls).to.deep.equal([
      {
        function: {
          arguments: {query: 'orbit'},
          name: 'search',
        },
      },
    ])
    expect(toolMessage).to.include({
      content: JSON.stringify({value: 'ok'}),
      role: 'tool',
      'tool_name': 'search',
    })
  })

  it('parses Ollama tool calls', () => {
    expect(toOllamaModelToolCall({
      function: {
        arguments: {query: 'orbit'},
        name: 'search',
      },
    }, 0)).to.deep.equal({
      id: 'ollama:0:search',
      input: {query: 'orbit'},
      name: 'search',
    })
  })
})
