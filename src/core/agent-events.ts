// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {Message} from './message/index.js'
import type {ModelToolCall} from './models/index.js'
import type {ContextPreparationEvent} from './session/context-policy.js'
import type {ToolResult} from './tools/index.js'

export const AgentEventType = {
  ContextPrepared: 'context-prepared',
  MessageCompleted: 'message-completed',
  ModelStarted: 'model-started',
  ToolCompleted: 'tool-completed',
  ToolStarted: 'tool-started',
  ToolUpdated: 'tool-updated',
} as const

export type AgentEventType = (typeof AgentEventType)[keyof typeof AgentEventType]

export interface AgentModelStartedEvent {
  iteration: number
  type: typeof AgentEventType.ModelStarted
}

export interface AgentMessageCompletedEvent {
  iteration: number
  message: Message
  type: typeof AgentEventType.MessageCompleted
}

export interface AgentToolStartedEvent {
  iteration: number
  toolCall: ModelToolCall
  type: typeof AgentEventType.ToolStarted
}

export interface AgentToolCompletedEvent {
  iteration: number
  message: Message
  toolCall: ModelToolCall
  type: typeof AgentEventType.ToolCompleted
}

export interface AgentToolUpdatedEvent {
  iteration: number
  toolCall: ModelToolCall
  type: typeof AgentEventType.ToolUpdated
  update: ToolResult
}

export type AgentEvent =
  | AgentMessageCompletedEvent
  | AgentModelStartedEvent
  | AgentToolCompletedEvent
  | AgentToolStartedEvent
  | AgentToolUpdatedEvent
  | (ContextPreparationEvent & {iteration: number; type: typeof AgentEventType.ContextPrepared})

export type AgentEventHandler = (event: AgentEvent) => void
