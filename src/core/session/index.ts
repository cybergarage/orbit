// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

export {isMessageType, Message, MessageType, UserMessage} from '../message/index.js'
export type {MessageOptions, MessagePayload} from '../message/index.js'
export {encodeSessionEntry, parseSessionFile} from './codec.js'
export type {ParsedSessionFile} from './codec.js'
export {SessionContextBuilder} from './context-builder.js'
export type {SessionModelContext} from './context-builder.js'
export {SESSION_FORMAT_VERSION, SessionEntryType, TurnPhase} from './entries.js'
export type {
  PersistedMessage,
  SessionEntry,
  SessionError,
  SessionHeaderEntry,
  SessionMessageEntry,
  SessionMetadata,
  SessionTurnContextEntry,
  SessionTurnEventEntry,
} from './entries.js'
export {SessionHeader} from './header.js'
export type {SessionHeaderOptions} from './header.js'
export {createMessage} from './message-factory.js'
export type {CreateMessageOptions} from './message-factory.js'
export {sessionFilePath} from './paths.js'
export {SessionRecorder} from './recorder.js'
export {SessionRepository} from './repository.js'
export type {
  CreateSessionOptions,
  SessionListError,
  SessionListOptions,
  SessionListResult,
  SessionRepositoryOptions,
  SessionSummary,
} from './repository.js'
export {Session} from './session.js'
export type {AppendMessageOptions, RecordTurnContextOptions, RecordTurnEventOptions, SessionOptions} from './session.js'
