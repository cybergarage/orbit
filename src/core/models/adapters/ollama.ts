// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {Config, Message as OllamaMessage, Tool as OllamaTool, ToolCall as OllamaToolCall} from 'ollama'

import {performance} from 'node:perf_hooks'
import {Ollama} from 'ollama'

import type {Message} from '../../message/index.js'
import type {Model, ModelInvokeOptions, ModelOutputPart, ModelResponseMetadata, ModelToolCall} from '../model.js'
import type {Provider, ProviderName} from '../provider.js'

import {Message as CoreMessage, MessageType} from '../../message/index.js'
import {formatOperatorName, OperatorType} from '../../processor/index.js'
import {emitModelFailure, emitModelRequest, emitModelResponse} from '../diagnostics.js'
import {getModelOutputParts, getToolCalls, getToolResult, getToolResultImages, stringifyToolResult} from './tools.js'

export interface OllamaAgentOptions {
  client?: Pick<Ollama, 'abort' | 'chat'>
}

export interface OllamaModelSelectionOptions {
  defaultModel: string
  requestedModel?: string
}

export class OllamaAgent implements Model {
  private readonly abort = () => this.client.abort()
  private readonly client: Pick<Ollama, 'abort' | 'chat'>

  constructor(
    private readonly model: string,
    private readonly provider: Provider,
    options: OllamaAgentOptions = {},
  ) {
    this.client = options.client ?? new Ollama(createOllamaOptions(provider))
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
    const parts = toOllamaOutputParts(response.message, toolCalls)
    const metadata: ModelResponseMetadata = {
      durationMs: performance.now() - startedAt,
      model: response.model,
      provider: this.getProvider(),
      providerMetadata: {
        createdAt:
          response.created_at instanceof Date ? response.created_at.toISOString() : String(response.created_at),
        done: response.done,
        evalDurationNs: response.eval_duration,
        loadDurationNs: response.load_duration,
        ...(response.logprobs === undefined ? {} : {logprobs: response.logprobs}),
        promptEvalDurationNs: response.prompt_eval_duration,
        totalDurationNs: response.total_duration,
      },
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
        ...(parts.length > 0 ? {parts} : {}),
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

export async function selectOllamaModel(
  provider: Provider,
  options: OllamaModelSelectionOptions,
  client: Pick<Ollama, 'list' | 'show'> = new Ollama(createOllamaOptions(provider)),
): Promise<string> {
  let models
  try {
    models = (await client.list()).models
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Unable to list Ollama models: ${detail}`, {cause: error})
  }

  const installedModels = [
    ...new Set(models.map((model) => installedModelName(model)).filter((model) => model.length > 0)),
  ]
  if (options.requestedModel !== undefined) {
    const requestedModel = findInstalledModel(installedModels, options.requestedModel)
    if (requestedModel !== undefined) return requestedModel
    throw new Error(`Ollama model is not installed: ${options.requestedModel}. Pull the model before starting Orbit.`)
  }

  const defaultModel = findInstalledModel(installedModels, options.defaultModel)
  if (defaultModel !== undefined) return defaultModel
  if (installedModels.length === 0) {
    throw new Error('Ollama has no installed models. Install a tool-capable model before starting Orbit.')
  }

  const toolSupport = await Promise.all(installedModels.map(async (model) => supportsTools(client, model)))
  const supportedModelIndex = toolSupport.indexOf(true)
  if (supportedModelIndex !== -1) return installedModels[supportedModelIndex]

  throw new Error(
    'No installed Ollama model reports the tools capability. Install a tool-capable model or select a model explicitly.',
  )
}

function findInstalledModel(installedModels: string[], requestedModel: string): string | undefined {
  return installedModels.find(
    (installedModel) =>
      installedModel === requestedModel ||
      installedModel === `${requestedModel}:latest` ||
      `${installedModel}:latest` === requestedModel,
  )
}

function installedModelName(model: {model: string; name: string}): string {
  return model.model || model.name
}

async function supportsTools(client: Pick<Ollama, 'show'>, model: string): Promise<boolean> {
  try {
    const details = await client.show({model})
    return details.capabilities?.includes('tools') === true
  } catch {
    // A broken model entry must not prevent Orbit from checking the remaining installed models.
    return false
  }
}

export function toOllamaMessage(message: Message): OllamaMessage {
  const toolResult = getToolResult(message)
  if (message.type === MessageType.Tool && toolResult !== undefined) {
    const images = getToolResultImages(toolResult.output)
    return {
      content: stringifyToolResult(toolResult),
      ...(images.length > 0 ? {images} : {}),
      role: 'tool',
      // Ollama's SDK expects snake_case for this field.
      // eslint-disable-next-line camelcase
      tool_name: toolResult.name,
    }
  }

  const toolCalls = getToolCalls(message)
  const parts = getModelOutputParts(message)
  const thinking = parts.flatMap((part) => (part.type === 'reasoning' ? [part.text] : [])).join('\n')
  const images = parts
    .filter((part): part is Extract<ModelOutputPart, {type: 'image'}> => part.type === 'image')
    .map((part) => part.data)
  if (toolCalls.length > 0 || thinking.length > 0 || images.length > 0) {
    return {
      content: message.content,
      ...(images.length > 0 ? {images} : {}),
      role: 'assistant',
      ...(thinking.length > 0 ? {thinking} : {}),
      // Ollama's SDK expects snake_case for this field.
      // eslint-disable-next-line camelcase
      ...(toolCalls.length > 0 ? {tool_calls: toolCalls.map((toolCall) => toOllamaToolCall(toolCall))} : {}),
    }
  }

  return {
    content: message.content,
    role: message.role,
  }
}

function toOllamaOutputParts(message: OllamaMessage, toolCalls: ModelToolCall[]): ModelOutputPart[] {
  const parts: ModelOutputPart[] = []
  if (message.thinking !== undefined && message.thinking.length > 0) {
    parts.push({text: message.thinking, type: 'reasoning'})
  }

  if (message.content.length > 0) parts.push({text: message.content, type: 'text'})
  for (const image of message.images ?? []) {
    parts.push({
      data: typeof image === 'string' ? image : Buffer.from(image).toString('base64'),
      type: 'image',
    })
  }

  parts.push(...toolCalls.map((toolCall): ModelOutputPart => ({toolCall, type: 'tool-call'})))
  return parts
}

export function toOllamaTool(tool: NonNullable<ModelInvokeOptions['tools']>[number]): OllamaTool {
  return {
    function: {
      description: tool.description,
      name: tool.name,
      parameters: tool.inputSchema as OllamaTool['function']['parameters'],
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
