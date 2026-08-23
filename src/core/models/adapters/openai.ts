// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {
  ChatCompletionMessage,
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
} from 'openai/resources/chat/completions'

import {performance} from 'node:perf_hooks'
import {OpenAI} from 'openai'

import type {Message} from '../../message/index.js'
import type {Model, ModelInvokeOptions, ModelOutputPart, ModelResponseMetadata, ModelToolCall} from '../model.js'
import type {Provider, ProviderName} from '../provider.js'

import {Message as CoreMessage, MessageType} from '../../message/index.js'
import {formatOperatorName, OperatorType} from '../../processor/index.js'
import {emitModelFailure, emitModelRequest, emitModelResponse} from '../diagnostics.js'
import {getToolCalls, getToolResult, stringifyToolResult} from './tools.js'

export interface OpenAIAgentOptions {
  client?: Pick<OpenAI, 'chat'>
}

export class OpenAIAgent implements Model {
  private readonly client: Pick<OpenAI, 'chat'>

  constructor(
    private readonly model: string,
    private readonly provider: Provider,
    options: OpenAIAgentOptions = {},
  ) {
    this.client = options.client ?? new OpenAI(createOpenAIOptions(provider))
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

  // Request mapping and optional provider metadata are kept together at the adapter boundary.
  // eslint-disable-next-line complexity
  async invoke(messages: Message[], options?: Partial<ModelInvokeOptions>): Promise<Message> {
    const request = {
      messages: messages.map((message) => toOpenAIMessage(message)),
      model: this.model,
      ...(options?.tools && options.tools.length > 0 ? {tools: options.tools.map((tool) => toOpenAITool(tool))} : {}),
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
      response = await this.client.chat.completions.create(request, {signal: options?.signal})
    } catch (error) {
      emitModelFailure(
        options,
        {durationMs: performance.now() - startedAt, model: this.model, provider: this.getProvider()},
        error,
      )
      throw error
    }

    const choice = response.choices[0]
    if (choice === undefined) throw new Error('OpenAI returned a chat completion without choices.')
    const {message} = choice
    const toolCalls =
      message.tool_calls
        ?.filter((toolCall) => isOpenAIFunctionToolCall(toolCall))
        .map((toolCall) => toOpenAIModelToolCall(toolCall)) ?? []
    const content = message.content ?? message.refusal ?? message.audio?.transcript ?? ''
    const parts = toOpenAIOutputParts(message, toolCalls)
    const metadata: ModelResponseMetadata = {
      durationMs: performance.now() - startedAt,
      model: response.model,
      provider: this.getProvider(),
      responseId: response.id,
      stopReason: choice.finish_reason,
      ...(response.usage === undefined
        ? {}
        : {
            usage: {
              ...(response.usage.prompt_tokens_details?.cached_tokens === undefined
                ? {}
                : {cachedInputTokens: response.usage.prompt_tokens_details.cached_tokens}),
              inputTokens: response.usage.prompt_tokens,
              outputTokens: response.usage.completion_tokens,
              ...(response.usage.completion_tokens_details?.reasoning_tokens === undefined
                ? {}
                : {reasoningTokens: response.usage.completion_tokens_details.reasoning_tokens}),
              totalTokens: response.usage.total_tokens,
            },
          }),
    }
    emitModelResponse(options, {content, metadata, response, toolCalls})

    return new CoreMessage(MessageType.Assistant, {
      content,
      payload: {
        ...(parts.length > 0 ? {parts} : {}),
        response: metadata,
        ...(toolCalls.length > 0 ? {toolCalls} : {}),
      },
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
      content: stringifyToolResult(toolResult),
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

function toOpenAIOutputParts(message: ChatCompletionMessage, toolCalls: ModelToolCall[]): ModelOutputPart[] {
  const parts: ModelOutputPart[] = []
  if (message.content !== null && message.content.length > 0) parts.push({text: message.content, type: 'text'})
  if (message.refusal !== null && message.refusal.length > 0) parts.push({text: message.refusal, type: 'refusal'})
  if (message.audio !== null && message.audio !== undefined) {
    parts.push({
      data: message.audio.data,
      id: message.audio.id,
      transcript: message.audio.transcript,
      type: 'audio',
    })
  }

  for (const annotation of message.annotations ?? []) {
    parts.push({
      endIndex: annotation.url_citation.end_index,
      startIndex: annotation.url_citation.start_index,
      title: annotation.url_citation.title,
      type: 'citation',
      url: annotation.url_citation.url,
    })
  }

  parts.push(...toolCalls.map((toolCall): ModelOutputPart => ({toolCall, type: 'tool-call'})))
  return parts
}

export function toOpenAITool(tool: NonNullable<ModelInvokeOptions['tools']>[number]): ChatCompletionTool {
  return {
    function: {
      description: tool.description,
      name: tool.name,
      parameters: tool.inputSchema,
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
