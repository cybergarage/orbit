// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {DiagnosticContext, DiagnosticEventBus} from '../diagnostics/index.js'
import type {Message} from '../message/index.js'
import type {Operator, OperatorOptions} from '../processor/index.js'
import type {ModelToolSpec, ToolResult} from '../tools/index.js'
import type {ProviderName} from './provider.js'

export interface ModelToolCall {
  id: string
  input: unknown
  name: string
}

export interface ModelToolCallPayload {
  toolCalls: ModelToolCall[]
}

export interface ModelTokenUsage {
  cacheCreationInputTokens?: number
  cachedInputTokens?: number
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  totalTokens?: number
}

export interface ModelResponseMetadata {
  durationMs: number
  model: string
  provider: ProviderName
  responseId?: string
  stopReason?: string
  usage?: ModelTokenUsage
}

export interface ModelAssistantPayload {
  response: ModelResponseMetadata
  toolCalls?: ModelToolCall[]
}

export interface ModelToolResultPayload {
  input: unknown
  isError?: boolean
  name: string
  output: ToolResult
  toolCallId: string
}

export interface ModelInvokeOptions extends OperatorOptions {
  diagnosticContext?: DiagnosticContext
  diagnostics?: DiagnosticEventBus
  maxToolIterations?: number
  signal?: AbortSignal
  tools?: ModelToolSpec[]
}

export interface Model extends Operator<Message[], Message, ModelInvokeOptions> {
  getModel(): string
  getName(suffix?: string): string
  getProvider(): ProviderName
  invoke(messages: Message[], options?: Partial<ModelInvokeOptions>): Promise<Message>
}
