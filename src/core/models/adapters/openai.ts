// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
} from 'openai/resources/chat/completions'

import {OpenAI} from 'openai'

import type {Message} from '../../message/index.js'
import type {Model, ModelInvokeOptions, ModelToolCall} from '../model.js'
import type {Provider, ProviderName} from '../provider.js'

import {Message as CoreMessage, MessageType} from '../../message/index.js'
import {formatOperatorName, OperatorType} from '../../processor/index.js'
import {getToolCalls, getToolResult, stringifyToolOutput, toolInputSchema} from './tools.js'

export class OpenAIAgent implements Model {
  private readonly client: OpenAI

  constructor(
    private readonly model: string,
    private readonly provider: Provider,
  ) {
    this.client = new OpenAI(createOpenAIOptions(provider))
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
    const response = await this.client.chat.completions.create(
      {
        messages: messages.map((message) => toOpenAIMessage(message)),
        model: this.model,
        ...(options?.tools && options.tools.length > 0 ? {tools: options.tools.map((tool) => toOpenAITool(tool))} : {}),
      },
      {signal: options?.signal},
    )

    const message = response.choices[0]?.message
    const toolCalls =
      message?.tool_calls
        ?.filter((toolCall) => isOpenAIFunctionToolCall(toolCall))
        .map((toolCall) => toOpenAIModelToolCall(toolCall)) ?? []

    return new CoreMessage(MessageType.Assistant, {
      content: message?.content ?? '',
      ...(toolCalls.length > 0 ? {payload: {toolCalls}} : {}),
    })
  }
}

export function createOpenAIOptions(provider: Provider): ConstructorParameters<typeof OpenAI>[0] {
  const apiKey = provider.getAPIKey()
  return apiKey === undefined ? {} : {apiKey}
}

export function toOpenAIMessage(message: Message): ChatCompletionMessageParam {
  const toolResult = getToolResult(message)
  if (message.type === MessageType.Tool && toolResult !== undefined) {
    return {
      content: stringifyToolOutput(toolResult.output),
      role: 'tool',
      // OpenAI's SDK expects snake_case for this field.
      // eslint-disable-next-line camelcase
      tool_call_id: toolResult.toolCallId,
    }
  }

  const toolCalls = getToolCalls(message)
  if (toolCalls.length > 0) {
    return {
      content: message.content || null,
      role: 'assistant',
      // OpenAI's SDK expects snake_case for this field.
      // eslint-disable-next-line camelcase
      tool_calls: toolCalls.map((toolCall) => toOpenAIToolCall(toolCall)),
    }
  }

  return {
    content: message.content,
    role: message.role,
  } as ChatCompletionMessageParam
}

export function toOpenAITool(tool: NonNullable<ModelInvokeOptions['tools']>[number]): ChatCompletionTool {
  return {
    function: {
      description: tool.description,
      name: tool.name,
      parameters: toolInputSchema(tool),
    },
    type: 'function',
  }
}

function toOpenAIToolCall(toolCall: ModelToolCall): ChatCompletionMessageToolCall {
  return {
    function: {
      arguments: JSON.stringify(toolCall.input),
      name: toolCall.name,
    },
    id: toolCall.id,
    type: 'function',
  }
}

export function toOpenAIModelToolCall(toolCall: ChatCompletionMessageFunctionToolCall): ModelToolCall {
  return {
    id: toolCall.id,
    input: parseToolArguments(toolCall.function.arguments),
    name: toolCall.function.name,
  }
}

function isOpenAIFunctionToolCall(
  toolCall: ChatCompletionMessageToolCall,
): toolCall is ChatCompletionMessageFunctionToolCall {
  return toolCall.type === 'function'
}

function parseToolArguments(argumentsText: string): unknown {
  try {
    return JSON.parse(argumentsText)
  } catch {
    return argumentsText
  }
}
