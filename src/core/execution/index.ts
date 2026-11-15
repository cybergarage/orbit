// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

export {allowedPath, canonicalPath, executeManagedTool, executePrepared, OperationExecutor} from './authorization.js'
export type {
  ExecutionPolicy,
  ManagedToolOptions,
  OperationEffect,
  OperationPreparation,
  PreparedExecutionOptions,
  PreparedOperation,
} from './authorization.js'
export {admitEvents, deliverEvent} from './event-inbox.js'
export type {EventDelivery, InboxEvent, JobReceipt} from './event-inbox.js'
export {EventStore} from './event-store.js'
export type {EventInboxState, EventStoreOptions, EventStoreState} from './event-store.js'
export {canonicalJSON, FileExecutionJournal, MemoryExecutionJournal} from './journal.js'
export type {
  ExecutionJournal,
  FileExecutionJournalOptions,
  JournalKind,
  JournalLevel,
  JournalRecord,
} from './journal.js'

export {parseBudgetReason, parseRunLimits} from './limits.js'
export type {BudgetExhaustion, ExecutionLimit} from './limits.js'

export {inspectExecutionJournal, recordReconciliation} from './recovery.js'
export type {JournalInspection} from './recovery.js'

export {
  DEFAULT_RUN_LIMITS,
  ExecutionRequestError,
  recoveredRunSnapshot,
  RunAdmissionRejectedError,
  RunContext,
  RunExecutionError,
  RunStoppedError,
  RunSupervisor,
} from './run.js'
export type {
  ApprovalReply,
  ApprovalRequest,
  OperationOutcome,
  RunHandle,
  RunLimits,
  RunOutcome,
  RunPhase,
  RunResult,
  RunSnapshot,
  RunStartOptions,
} from './run.js'
