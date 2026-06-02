// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {z} from 'zod'

import {createProvider, Message, MessageType, tool} from '../../src/core/index.js'
import {
  createAnthropicOptions,
  toAnthropicMessage,
  toAnthropicModelToolCall,
  toAnthropicTool,
} from '../../src/core/models/adapters/anthropic.js'
import {
  createOllamaOptions,
  toOllamaMessage,
  toOllamaModelToolCall,
  toOllamaTool,
} from '../../src/core/models/adapters/ollama.js'
import {
  createOpenAIOptions,
  toOpenAIMessage,
  toOpenAIModelToolCall,
  toOpenAITool,
} from '../../src/core/models/adapters/openai.js'

describe('model adapter tools', () => {
  afterEach(() => {
    delete process.env.ORBIT_TEST_ANTHROPIC_KEY
    delete process.env.ORBIT_TEST_OPENAI_KEY
  })

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

  it('uses MCP-provided JSON Schema directly when serializing tool definitions', () => {
    const inputSchema = {
      properties: {
        path: {description: 'File path.', type: 'string'},
      },
      required: ['path'],
      type: 'object',
    }
    const mcpTool = Object.assign(tool((input: unknown) => input, {
      description: 'Read a file.',
      name: 'filesystem__read_file',
      schema: z.unknown(),
    }), {inputSchema})

    const openAITool = toOpenAITool(mcpTool) as unknown as {
      function: {parameters?: Record<string, unknown>}
    }
    const anthropicTool = toAnthropicTool(mcpTool)
    const ollamaTool = toOllamaTool(mcpTool)

    expect(openAITool.function.parameters).to.equal(inputSchema)
    expect(anthropicTool.input_schema).to.equal(inputSchema)
    expect(ollamaTool.function.parameters).to.equal(inputSchema)
  })

  it('resolves OpenAI API key from configured environment variable', () => {
    process.env.ORBIT_TEST_OPENAI_KEY = 'openai-secret'

    expect(createOpenAIOptions(createProvider('openai', {providers: {openai: {apiKeyEnv: 'ORBIT_TEST_OPENAI_KEY'}}}))).to.deep.equal({
      apiKey: 'openai-secret',
    })
  })

  it('throws when configured OpenAI API key environment variable is missing', () => {
    expect(() =>
      createOpenAIOptions(createProvider('openai', {providers: {openai: {apiKeyEnv: 'ORBIT_TEST_OPENAI_KEY'}}})),
    ).to.throw('openai API key environment variable is not set: ORBIT_TEST_OPENAI_KEY')
  })

  it('resolves Anthropic API key from configured environment variable', () => {
    process.env.ORBIT_TEST_ANTHROPIC_KEY = 'anthropic-secret'

    expect(
      createAnthropicOptions(createProvider('anthropic', {providers: {anthropic: {apiKeyEnv: 'ORBIT_TEST_ANTHROPIC_KEY'}}})),
    ).to.deep.equal({
      apiKey: 'anthropic-secret',
    })
  })

  it('throws when configured Anthropic API key environment variable is missing', () => {
    expect(() =>
      createAnthropicOptions(
        createProvider('anthropic', {providers: {anthropic: {apiKeyEnv: 'ORBIT_TEST_ANTHROPIC_KEY'}}}),
      ),
    ).to.throw('anthropic API key environment variable is not set: ORBIT_TEST_ANTHROPIC_KEY')
  })

  it('uses configured Ollama host', () => {
    expect(createOllamaOptions(createProvider('ollama', {providers: {ollama: {host: 'http://localhost:11434'}}}))).to.deep.equal({
      host: 'http://localhost:11434',
    })
  })
})
