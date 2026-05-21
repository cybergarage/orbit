// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {Config, Message as OllamaMessage, Tool as OllamaTool, ToolCall as OllamaToolCall} from 'ollama'

import {Ollama} from 'ollama'

import type {Message} from '../../message/index.js'
import type {WorkspaceSettings} from '../../settings.js'
import type {Model, ModelInvokeOptions, ModelToolCall} from '../model.js'
import type {Provider} from '../provider.js'

import {Message as CoreMessage, MessageType} from '../../message/index.js'
import {formatOperatorName, OperatorType} from '../../processor/index.js'
import {getToolCalls, getToolResult, stringifyToolOutput, toolInputSchema} from './tools.js'

export class OllamaAgent implements Model {
  private readonly client: Ollama

  constructor(
    private readonly model: string,
    settings?: WorkspaceSettings,
  ) {
    this.client = new Ollama(createOllamaOptions(settings))
  }

  getModel(): string {
    return this.model
  }

  getName(suffix?: string): string {
    return formatOperatorName(OperatorType.Model, suffix)
  }

  getProvider(): Provider {
    return 'ollama'
  }

  async invoke(messages: Message[], options?: Partial<ModelInvokeOptions>): Promise<Message> {
    const response = await this.client.chat({
      messages: messages.map((message) => toOllamaMessage(message)),
      model: this.model,
      ...(options?.tools && options.tools.length > 0 ? {tools: options.tools.map((tool) => toOllamaTool(tool))} : {}),
    })
    const toolCalls = response.message.tool_calls?.map(toOllamaModelToolCall) ?? []
    return new CoreMessage(MessageType.Assistant, {
      content: response.message.content,
      ...(toolCalls.length > 0 ? {payload: {toolCalls}} : {}),
    })
  }
}

export function createOllamaOptions(settings?: WorkspaceSettings): Partial<Config> {
  const host = settings?.providers?.ollama?.host
  return host === undefined ? {} : {host}
}

export function toOllamaMessage(message: Message): OllamaMessage {
  const toolResult = getToolResult(message)
  if (message.type === MessageType.Tool && toolResult !== undefined) {
    return {
      content: stringifyToolOutput(toolResult.output),
      role: 'tool',
      // Ollama's SDK expects snake_case for this field.
      // eslint-disable-next-line camelcase
      tool_name: toolResult.name,
    }
  }

  const toolCalls = getToolCalls(message)
  if (toolCalls.length > 0) {
    return {
      content: message.content,
      role: 'assistant',
      // Ollama's SDK expects snake_case for this field.
      // eslint-disable-next-line camelcase
      tool_calls: toolCalls.map((toolCall) => toOllamaToolCall(toolCall)),
    }
  }

  return {
    content: message.content,
    role: message.role,
  }
}

export function toOllamaTool(tool: NonNullable<ModelInvokeOptions['tools']>[number]): OllamaTool {
  return {
    function: {
      description: tool.description,
      name: tool.name,
      parameters: toolInputSchema(tool) as OllamaTool['function']['parameters'],
      type: 'object',
    },
    type: 'function',
  }
}

function toOllamaToolCall(toolCall: ModelToolCall): OllamaToolCall {
  return {
    function: {
      arguments: toolCall.input as OllamaToolCall['function']['arguments'],
      name: toolCall.name,
    },
  }
}

export function toOllamaModelToolCall(toolCall: OllamaToolCall, index: number): ModelToolCall {
  return {
    id: `ollama:${index}:${toolCall.function.name}`,
    input: toolCall.function.arguments,
    name: toolCall.function.name,
  }
}
