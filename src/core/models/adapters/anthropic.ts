// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {
  Tool as AnthropicTool,
  ContentBlock,
  MessageParam,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages/messages'

import {Anthropic} from '@anthropic-ai/sdk'
import {performance} from 'node:perf_hooks'

import type {Message} from '../../message/index.js'
import type {Model, ModelInvokeOptions, ModelResponseMetadata, ModelToolCall} from '../model.js'
import type {Provider, ProviderName} from '../provider.js'

import {Message as CoreMessage, MessageType} from '../../message/index.js'
import {formatOperatorName, OperatorType} from '../../processor/index.js'
import {emitModelFailure, emitModelRequest, emitModelResponse} from '../diagnostics.js'
import {splitSystemPrompt} from '../prompt.js'
import {Role} from '../role.js'
import {getToolCalls, getToolResult, isToolResultError, stringifyToolOutput} from './tools.js'

export class AnthropicAgent implements Model {
  private readonly client: Anthropic

  constructor(
    private readonly model: string,
    private readonly provider: Provider,
  ) {
    this.client = new Anthropic({...createAnthropicOptions(provider), maxRetries: 0})
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
    const request = {
      // Anthropic's SDK expects snake_case for this field.
      // eslint-disable-next-line camelcase
      max_tokens: 8096,
      messages: chatMessages.map((message) => toAnthropicMessage(message)),
      model: this.model,
      ...(systemPrompt ? {system: systemPrompt} : {}),
      ...(options?.tools && options.tools.length > 0
        ? {tools: options.tools.map((tool) => toAnthropicTool(tool))}
        : {}),
    }
    emitModelRequest(
      options,
      {
        messageCount: request.messages.length,
        model: this.model,
        provider: this.getProvider(),
        toolCount: options?.tools?.length ?? 0,
      },
      request,
    )
    const startedAt = performance.now()
    let response
    try {
      response = await this.client.messages.create(request, {signal: options?.signal})
    } catch (error) {
      emitModelFailure(
        options,
        {durationMs: performance.now() - startedAt, model: this.model, provider: this.getProvider()},
        error,
      )
      throw error
    }

    const toolCalls = response.content
      .filter((block) => isToolUseBlock(block))
      .map((toolCall) => toAnthropicModelToolCall(toolCall))
    const content = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
    const metadata: ModelResponseMetadata = {
      durationMs: performance.now() - startedAt,
      model: response.model,
      provider: this.getProvider(),
      responseId: response.id,
      ...(response.stop_reason === null ? {} : {stopReason: response.stop_reason}),
      usage: {
        ...(response.usage.cache_creation_input_tokens === null
          ? {}
          : {cacheCreationInputTokens: response.usage.cache_creation_input_tokens}),
        ...(response.usage.cache_read_input_tokens === null
          ? {}
          : {cachedInputTokens: response.usage.cache_read_input_tokens}),
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens:
          response.usage.input_tokens +
          response.usage.output_tokens +
          (response.usage.cache_creation_input_tokens ?? 0) +
          (response.usage.cache_read_input_tokens ?? 0),
      },
    }
    emitModelResponse(options, {content, metadata, response, toolCalls})
    return new CoreMessage(MessageType.Assistant, {
      content,
      payload: {
        response: metadata,
        ...(toolCalls.length > 0 ? {toolCalls} : {}),
      },
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
          ...(isToolResultError(toolResult) ? createAnthropicToolErrorFields() : {}),
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
    input_schema: tool.inputSchema as AnthropicTool.InputSchema,
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
