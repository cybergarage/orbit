// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {
  Tool as AnthropicTool,
  ContentBlock,
  MessageParam,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages/messages'

import {Anthropic} from '@anthropic-ai/sdk'

import type {Message} from '../../message/index.js'
import type {Model, ModelInvokeOptions, ModelToolCall} from '../model.js'
import type {Provider, ProviderName} from '../provider.js'

import {Message as CoreMessage, MessageType} from '../../message/index.js'
import {formatOperatorName, OperatorType} from '../../processor/index.js'
import {splitSystemPrompt} from '../prompt.js'
import {Role} from '../role.js'
import {getToolCalls, getToolResult, stringifyToolOutput, toolInputSchema} from './tools.js'

export class AnthropicAgent implements Model {
  private readonly client: Anthropic

  constructor(
    private readonly model: string,
    private readonly provider: Provider,
  ) {
    this.client = new Anthropic(createAnthropicOptions(provider))
  }

  getModel(): string {
    return this.model
  }

  getName(suffix?: string): string {
    return formatOperatorName(OperatorType.Model, suffix)
  }

  getProvider(): ProviderName {
    return this.provider.getName()
  }

  async invoke(messages: Message[], options?: Partial<ModelInvokeOptions>): Promise<Message> {
    const {messages: chatMessages, systemPrompt} = splitSystemPrompt(messages)

    const response = await this.client.messages.create({
      // Anthropic's SDK expects snake_case for this field.
      // eslint-disable-next-line camelcase
      max_tokens: 8096,
      messages: chatMessages.map((message) => toAnthropicMessage(message)),
      model: this.model,
      ...(systemPrompt ? {system: systemPrompt} : {}),
      ...(options?.tools && options.tools.length > 0
        ? {tools: options.tools.map((tool) => toAnthropicTool(tool))}
        : {}),
    })

    const toolCalls = response.content
      .filter((block) => isToolUseBlock(block))
      .map((toolCall) => toAnthropicModelToolCall(toolCall))
    return new CoreMessage(MessageType.Assistant, {
      content: response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join(''),
      ...(toolCalls.length > 0 ? {payload: {toolCalls}} : {}),
    })
  }
}

export function createAnthropicOptions(provider: Provider): ConstructorParameters<typeof Anthropic>[0] {
  const apiKey = provider.getAPIKey()
  return apiKey === undefined ? {} : {apiKey}
}

export function toAnthropicMessage(message: Message): MessageParam {
  const toolResult = getToolResult(message)
  if (message.type === MessageType.Tool && toolResult !== undefined) {
    return {
      content: [
        {
          content: stringifyToolOutput(toolResult.output),
          // Anthropic's SDK expects snake_case for this field.
          // eslint-disable-next-line camelcase
          tool_use_id: toolResult.toolCallId,
          type: 'tool_result',
          ...(toolResult.isError ? createAnthropicToolErrorFields() : {}),
        },
      ],
      role: Role.User,
    }
  }

  const toolCalls = getToolCalls(message)
  if (toolCalls.length > 0) {
    return {
      content: [
        ...(message.content ? [{text: message.content, type: 'text' as const}] : []),
        ...toolCalls.map((toolCall) => ({
          id: toolCall.id,
          input: toolCall.input,
          name: toolCall.name,
          type: 'tool_use' as const,
        })),
      ],
      role: Role.Assistant,
    }
  }

  return {
    content: message.content,
    role: message.role === Role.Assistant ? Role.Assistant : Role.User,
  }
}

function createAnthropicToolErrorFields(): Record<string, boolean> {
  const key = 'is_error'
  const fields: Record<string, boolean> = {}
  fields[key] = true
  return fields
}

export function toAnthropicTool(tool: NonNullable<ModelInvokeOptions['tools']>[number]): AnthropicTool {
  return {
    description: tool.description,
    // Anthropic's SDK expects snake_case for this field.
    // eslint-disable-next-line camelcase
    input_schema: toolInputSchema(tool) as AnthropicTool.InputSchema,
    name: tool.name,
  }
}

function isToolUseBlock(block: ContentBlock): block is ToolUseBlock {
  return block.type === 'tool_use'
}

export function toAnthropicModelToolCall(toolCall: ToolUseBlock): ModelToolCall {
  return {
    id: toolCall.id,
    input: toolCall.input,
    name: toolCall.name,
  }
}
