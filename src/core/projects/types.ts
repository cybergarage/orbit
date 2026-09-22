// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

export interface Project {
  archived: boolean
  createdAt: string
  defaultDirectory: null | string
  id: string
  memoryGeneration: number
  name: string
  revision: number
  updatedAt: string
}

export interface ProjectMembership {
  pairId: string
  projectId: null | string
  revision: number
  sessionId: string
  unavailable: boolean
}

export interface ProjectMemorySource {
  digest: string
  messageId: string
  pairId: string
  sessionId: string
}

export interface ProjectMemoryEntry {
  body: string
  createdAt: string
  edited: boolean
  id: string
  projectId: string
  retired: boolean
  revision: number
  sources: ProjectMemorySource[]
  title: string
  updatedAt: string
}

export interface ProjectReservation {
  cwd: string
  id: string
  pairId: string
  projectId: string
  projectRevision: number
  sessionId: string
  state: 'committed' | 'pending'
}

export interface ProjectCatalogSnapshot {
  entries: ProjectMemoryEntry[]
  membership: null | ProjectMembership
  project: Project
}

export type ProjectMutation =
  | {archived: boolean; directory: null | string; expectedRevision: number; id: string; kind: 'update'; name: string}
  | {directory: null | string; expectedRevision: 0; id: string; kind: 'create'; name: string}
  | {entry: Omit<ProjectMemoryEntry, 'createdAt' | 'revision' | 'updatedAt'>; expectedRevision: number; kind: 'memory'}
  | {
      expectedRevision: number
      kind: 'membership'
      pairId: string
      projectId: null | string
      sessionId: string
      unavailable: boolean
    }
  | {
      generation: number
      kind: 'capture'
      membershipRevision: number
      pairId: string
      projectId: string
      sessionId: string
      snapshotDigest: string
    }
  | {kind: 'commit-reservation'; reservationId: string}
  | {kind: 'reserve'; reservation: Omit<ProjectReservation, 'state'>}

export type ProjectMutationResult =
  | Project
  | ProjectMembership
  | ProjectMemoryEntry
  | ProjectReservation
  | {snapshotDigest: string}

export interface ProjectOperation {
  digest: string
  id: string
  result: ProjectMutationResult
}

export type ProjectQuery =
  | {after?: string; archived?: boolean; kind: 'projects'; limit: number}
  | {after?: string; kind: 'memberships'; limit: number; pairId: string; projectId: null | string}
  | {id: string; kind: 'operation'}
  | {id: string; kind: 'project'}
  | {id: string; kind: 'reservation'}
  | {kind: 'membership'; pairId: string; sessionId: string}
  | {kind: 'memories'; projectId: string}
  | {kind: 'snapshot'; pairId: string; projectId: string; sessionId: string}

export interface ProjectQueryResults {
  membership: null | ProjectMembership
  memberships: ProjectMembership[]
  memories: ProjectMemoryEntry[]
  operation: null | ProjectOperation
  project: null | Project
  projects: Project[]
  reservation: null | ProjectReservation
  snapshot: ProjectCatalogSnapshot
}

/** The host validates session ownership and provenance before catalog mutations. */
export interface ProjectStore {
  close(): Promise<void>
  mutate(operationId: string, mutation: ProjectMutation): Promise<ProjectMutationResult>
  query<Q extends ProjectQuery>(query: Q): Promise<ProjectQueryResults[Q['kind']]>
}

export class ProjectStoreError extends Error {
  constructor(
    readonly code: 'archived' | 'busy' | 'closed' | 'conflict' | 'invalid' | 'missing' | 'storage',
    message: string,
  ) {
    super(message)
    this.name = 'ProjectStoreError'
  }
}
