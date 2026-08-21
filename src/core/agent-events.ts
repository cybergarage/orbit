// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {Message} from './message/index.js'
import type {ModelToolCall} from './models/index.js'

export const AgentEventType = {
  MessageCompleted: 'message-completed',
  ModelStarted: 'model-started',
  ToolCompleted: 'tool-completed',
  ToolStarted: 'tool-started',
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

export type AgentEvent =
  | AgentMessageCompletedEvent
  | AgentModelStartedEvent
  | AgentToolCompletedEvent
  | AgentToolStartedEvent

export type AgentEventHandler = (event: AgentEvent) => void
