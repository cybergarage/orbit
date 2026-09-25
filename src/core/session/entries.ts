// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {ExecutionLimit} from '../execution/limits.js'
import type {MessagePayload, MessageType} from '../message/index.js'
import type {ProviderName} from '../models/provider.js'
import type {Role} from '../models/role.js'
import type {SessionSkillEntry} from '../skills/record.js'
import type {SessionCompactionEntry} from './compaction.js'
import type {ContextProjectionEntry} from './interrupted-context.js'

export const SESSION_FORMAT_VERSION = 1

export const SessionEntryType = {
  Compaction: 'compaction',
  ContextProjection: 'context_projection',
  Message: 'message',
  Session: 'session',
  SkillContext: 'skill_context',
  TurnContext: 'turn_context',
  TurnEvent: 'turn_event',
} as const

export type SessionEntryType = (typeof SessionEntryType)[keyof typeof SessionEntryType]

export const TurnPhase = {
  Cancelled: 'cancelled',
  Completed: 'completed',
  Failed: 'failed',
  Started: 'started',
} as const

export type TurnPhase = (typeof TurnPhase)[keyof typeof TurnPhase]

export interface PersistedMessage {
  contents: string[]
  id: string
  parentid: null | string
  payload?: MessagePayload
  role: Role
  timestamp: string
  type: MessageType
}

export interface SessionHeaderEntry {
  cwd: string
  id: string
  model?: string
  originator?: string
  provider?: ProviderName
  rootMessageId: string
  systemPrompt?: string
  timestamp: string
  type: typeof SessionEntryType.Session
  version: 1 | 2 | 3
}

export interface SessionMessageEntry {
  iteration?: number
  message: PersistedMessage
  timestamp: string
  turnId?: string
  type: typeof SessionEntryType.Message
}

export interface SessionTurnContextEntry {
  cwd: string
  maxToolIterations: ExecutionLimit
  model: string
  provider: ProviderName
  timestamp: string
  turnId: string
  type: typeof SessionEntryType.TurnContext
}

export interface SessionError {
  code?: string
  message: string
  name: string
}

export interface SessionTurnEventEntry {
  error?: SessionError
  phase: TurnPhase
  timestamp: string
  turnId: string
  type: typeof SessionEntryType.TurnEvent
}

export type SessionEntry =
  | ContextProjectionEntry
  | SessionCompactionEntry
  | SessionHeaderEntry
  | SessionMessageEntry
  | SessionSkillEntry
  | SessionTurnContextEntry
  | SessionTurnEventEntry

export interface SessionMetadata {
  createdAt: string
  cwd: string
  file?: string
  id: string
  model?: string
  originator?: string
  provider?: ProviderName
  rootMessageId: string
  systemPrompt?: string
}
