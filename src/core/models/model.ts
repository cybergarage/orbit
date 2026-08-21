// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {AgentTool} from '../agent.js'
import type {Message} from '../message/index.js'
import type {Operator, OperatorOptions} from '../processor/index.js'
import type {ProviderName} from './provider.js'

export interface ModelToolCall {
  id: string
  input: unknown
  name: string
}

export interface ModelToolCallPayload {
  toolCalls: ModelToolCall[]
}

export interface ModelToolResultPayload {
  input: unknown
  isError?: boolean
  name: string
  output: unknown
  toolCallId: string
}

export interface ModelInvokeOptions extends OperatorOptions {
  maxToolIterations?: number
  signal?: AbortSignal
  tools?: AgentTool[]
}

export interface Model extends Operator<Message[], Message, ModelInvokeOptions> {
  getModel(): string
  getName(suffix?: string): string
  getProvider(): ProviderName
  invoke(messages: Message[], options?: Partial<ModelInvokeOptions>): Promise<Message>
}
