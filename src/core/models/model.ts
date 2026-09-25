// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {DiagnosticContext, DiagnosticEventBus} from '../diagnostics/index.js'
import type {ExecutionLimit} from '../execution/limits.js'
import type {Message} from '../message/index.js'
import type {Operator, OperatorOptions} from '../processor/index.js'
import type {ModelToolSpec, ToolResult} from '../tools/index.js'
import type {ModelContextInfo} from './context-capacity.js'
import type {ProviderName} from './provider.js'

export interface ModelToolCall {
  id: string
  input: unknown
  name: string
}

export type ModelOutputPart =
  | {
      data: string
      id?: string
      transcript?: string
      type: 'audio'
    }
  | {
      data: string
      mediaType?: string
      type: 'image'
    }
  | {
      endIndex?: number
      startIndex?: number
      title: string
      type: 'citation'
      url: string
    }
  | {
      text: string
      type: 'reasoning' | 'refusal' | 'text'
    }
  | {
      toolCall: ModelToolCall
      type: 'tool-call'
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
  providerMetadata?: Record<string, unknown>
  responseId?: string
  stopReason?: string
  usage?: ModelTokenUsage
}

export interface ModelAssistantPayload {
  parts?: ModelOutputPart[]
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
  contextWindow?: number
  diagnosticContext?: DiagnosticContext
  diagnostics?: DiagnosticEventBus
  maxOutputTokens?: number
  maxToolIterations?: ExecutionLimit
  signal?: AbortSignal
  tools?: ModelToolSpec[]
}

export interface PreparedModelInvocation {
  invoke(): Promise<Message>
  readonly request: Readonly<Record<string, unknown>>
}

export interface Model extends Operator<Message[], Message, ModelInvokeOptions> {
  getContextInfo?(options?: {signal?: AbortSignal}): Promise<ModelContextInfo>
  getModel(): string
  getName(suffix?: string): string
  getProvider(): ProviderName
  invoke(messages: Message[], options?: Partial<ModelInvokeOptions>): Promise<Message>
  prepare?(messages: Message[], options?: Partial<ModelInvokeOptions>): PreparedModelInvocation
}
