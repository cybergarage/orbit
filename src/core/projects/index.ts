// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

export {createOllamaKnowledgeExtractor} from '../models/adapters/ollama-knowledge.js'
export {AutomaticProjectMemory, containsMemorySecret, extractionCandidates, stableMemoryId} from './automatic-memory.js'
export type {ExtractionResponse, KnowledgeExtractor} from './automatic-memory.js'
export {catalogDigest as projectSourceDigest} from './engine.js'
export {parseMemorySelection, parseProjectContext, renderProjectMemory, selectProjectMemory} from './memory-context.js'
export type {ProjectContextSnapshot, ProjectMemorySelection} from './memory-context.js'

export {ProjectMemoryService} from './memory-service.js'
export type {ProjectMemoryWrite} from './memory-service.js'
export {MemoryProjectStore} from './memory-store.js'
export {ProjectService} from './service.js'

export type {ProjectSessionHost} from './service.js'
export {ProjectSourceLease} from './source-lease.js'
export type {ProjectSourceCapture} from './source-lease.js'

export {SqliteProjectStore} from './sqlite-store.js'
export {ProjectStoreError} from './types.js'

export type {
  Project,
  ProjectCatalogSnapshot,
  ProjectMembership,
  ProjectMemoryEntry,
  ProjectMemorySource,
  ProjectMutation,
  ProjectMutationResult,
  ProjectOperation,
  ProjectQuery,
  ProjectQueryResults,
  ProjectReservation,
  ProjectStore,
} from './types.js'

export type {ProjectAutomation, ProjectExtractionJob} from './types.js'

export type {ProjectAutomationStatus} from './types.js'

export {MAX_PENDING_PROJECT_EXTRACTIONS} from './types.js'
