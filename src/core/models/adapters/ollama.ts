// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {Config, Message as OllamaMessage, Tool as OllamaTool, ToolCall as OllamaToolCall} from 'ollama'

import {performance} from 'node:perf_hooks'
import {Ollama} from 'ollama'

import type {Message} from '../../message/index.js'
import type {Model, ModelInvokeOptions, ModelResponseMetadata, ModelToolCall} from '../model.js'
import type {Provider, ProviderName} from '../provider.js'

import {Message as CoreMessage, MessageType} from '../../message/index.js'
import {formatOperatorName, OperatorType} from '../../processor/index.js'
import {emitModelFailure, emitModelRequest, emitModelResponse} from '../diagnostics.js'
import {getToolCalls, getToolResult, stringifyToolOutput, toolInputSchema} from './tools.js'

export class OllamaAgent implements Model {
  private readonly abort = () => this.client.abort()
  private readonly client: Ollama

  constructor(
    private readonly model: string,
    private readonly provider: Provider,
  ) {
    this.client = new Ollama(createOllamaOptions(provider))
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
    options?.signal?.addEventListener('abort', this.abort, {once: true})
    const request = {
      messages: messages.map((message) => toOllamaMessage(message)),
      model: this.model,
      ...(options?.tools && options.tools.length > 0 ? {tools: options.tools.map((tool) => toOllamaTool(tool))} : {}),
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
      response = await this.client.chat(request)
    } catch (error) {
      emitModelFailure(
        options,
        {durationMs: performance.now() - startedAt, model: this.model, provider: this.getProvider()},
        error,
      )
      throw error
    } finally {
      options?.signal?.removeEventListener('abort', this.abort)
    }

    const toolCalls = response.message.tool_calls?.map(toOllamaModelToolCall) ?? []
    const {content} = response.message
    const metadata: ModelResponseMetadata = {
      durationMs: performance.now() - startedAt,
      model: response.model,
      provider: this.getProvider(),
      ...(response.done_reason === undefined ? {} : {stopReason: response.done_reason}),
      usage: {
        inputTokens: response.prompt_eval_count,
        outputTokens: response.eval_count,
        totalTokens: response.prompt_eval_count + response.eval_count,
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

export function createOllamaOptions(provider: Provider): Partial<Config> {
  const host = provider.getHost()
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
