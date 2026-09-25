// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

export {createModelContextPolicy} from './context-policy.js'
export {isMessageType, Message, MessageType, UserMessage} from '../message/index.js'
export type {MessageOptions, MessagePayload} from '../message/index.js'
export {encodeSessionEntry, parseSessionFile} from './codec.js'
export type {ParsedSessionFile} from './codec.js'
export type {ContextSummary, SessionCompactionEntry, SummaryFact, SummaryTest} from './compaction.js'
export {SessionContextBuilder} from './context-builder.js'
export type {SessionModelContext} from './context-builder.js'
export {ContextBudgetError, estimateJSONRequest, validateContextProfile} from './context-policy.js'
export type {
  ContextPolicy,
  ContextPreparationEvent,
  ContextProfile,
  RequestEstimate,
  RequestEstimator,
} from './context-policy.js'
export {
  coordinationPaths,
  initializeSessionStorage,
  inspectSessionStorage,
  isSessionLocked,
  recoverSessionWriter,
  resumeSessionStorage,
  retrySessionCleanup,
} from './coordination.js'
export type {
  OfflineStorageConditions,
  RegistrationResumeOptions,
  SessionScope,
  StorageRegistrationInspection,
} from './coordination.js'
export {SessionDeletionService} from './deletion-service.js'
export type {SessionThreadCloser} from './deletion-service.js'
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
export {createSessionInformation, formatSessionInformation} from './information.js'
export type {SessionInformation, SessionInformationOverrides, SessionStatus} from './information.js'
export type {ContextProjectionEntry, InterruptedCall, ProjectionEvidence} from './interrupted-context.js'
export {
  CONTEXT_PROJECTION_RECORD_BYTES,
  CONTEXT_PROJECTION_REVISION,
  VerifiedContextError,
} from './interrupted-context.js'
export {createMessage} from './message-factory.js'

export type {CreateMessageOptions} from './message-factory.js'
export {inspectTranscriptMigration, migrateSessionTranscript, migrateSessionTranscriptV3} from './migration.js'
export type {TranscriptMigrationInspection} from './migration.js'

export {sessionFilePath} from './paths.js'

export {SessionRecorder} from './recorder.js'
export {SessionRepository} from './repository.js'

export type {
  CreateSessionOptions,
  FindLatestSessionOptions,
  SessionListError,
  SessionListOptions,
  SessionListResult,
  SessionRepositoryOptions,
  SessionSummary,
} from './repository.js'

export {Session} from './session.js'

export type {AppendMessageOptions, RecordTurnContextOptions, RecordTurnEventOptions, SessionOptions} from './session.js'
export type {InterruptionPolicy} from './verified-context.js'
export {DEFAULT_PROJECTION_LIMITS, parseInterruptionPolicy} from './verified-context.js'
export type {SessionWriterLease} from './writer-lease.js'
