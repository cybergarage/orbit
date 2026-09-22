// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {createHash} from 'node:crypto'
import path from 'node:path'
import {z} from 'zod'

import type {
  Project,
  ProjectMembership,
  ProjectMemoryEntry,
  ProjectMutation,
  ProjectMutationResult,
  ProjectOperation,
  ProjectQuery,
  ProjectQueryResults,
  ProjectReservation,
} from './types.js'

import {ProjectStoreError} from './types.js'

const uuid = z.string().uuid()
const sessionId = z.string().regex(/^[A-Za-z0-9_-]{1,160}$/u)
const revision = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER - 1)
const timestamp = z.string().datetime()
const directory = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => path.isAbsolute(value) && !value.includes('\0'))
  .nullable()
const name = z.string().trim().min(1).max(256)
const source = z
  .object({digest: z.string().regex(/^[a-f0-9]{64}$/u), messageId: sessionId, pairId: uuid, sessionId})
  .strict()
const projectSchema = z
  .object({
    archived: z.boolean(),
    createdAt: timestamp,
    defaultDirectory: directory,
    id: uuid,
    memoryGeneration: revision,
    name,
    revision,
    updatedAt: timestamp,
  })
  .strict()
const membershipSchema = z
  .object({pairId: uuid, projectId: uuid.nullable(), revision, sessionId, unavailable: z.boolean()})
  .strict()
const memorySchema = z
  .object({
    body: z
      .string()
      .min(1)
      .refine((value) => Buffer.byteLength(value) <= 8192),
    createdAt: timestamp,
    edited: z.boolean(),
    id: uuid,
    projectId: uuid,
    retired: z.boolean(),
    revision,
    sources: z.array(source).max(16),
    title: name,
    updatedAt: timestamp,
  })
  .strict()
const reservationSchema = z
  .object({
    cwd: directory.unwrap(),
    id: uuid,
    pairId: uuid,
    projectId: uuid,
    projectRevision: revision,
    sessionId,
    state: z.enum(['pending', 'committed']),
  })
  .strict()
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u)
const mutationSchema = z.discriminatedUnion('kind', [
  z.object({directory, expectedRevision: z.literal(0), id: uuid, kind: z.literal('create'), name}).strict(),
  z
    .object({archived: z.boolean(), directory, expectedRevision: revision, id: uuid, kind: z.literal('update'), name})
    .strict(),
  z
    .object({
      expectedRevision: revision,
      kind: z.literal('membership'),
      pairId: uuid,
      projectId: uuid.nullable(),
      sessionId,
      sourceProjectId: uuid.nullable().optional(),
      unavailable: z.boolean(),
    })
    .strict(),
  z.object({kind: z.literal('reserve'), reservation: reservationSchema.omit({state: true})}).strict(),
  z.object({kind: z.literal('commit-reservation'), reservationId: uuid}).strict(),
  z
    .object({
      entry: memorySchema.omit({createdAt: true, revision: true, updatedAt: true}),
      expectedRevision: revision,
      kind: z.literal('memory'),
    })
    .strict(),
  z
    .object({
      generation: revision,
      kind: z.literal('capture'),
      membershipRevision: revision,
      pairId: uuid,
      projectId: uuid,
      sessionId,
      snapshotDigest: digestSchema,
    })
    .strict(),
])
const limit = z.number().int().min(1).max(200)
const querySchema = z.discriminatedUnion('kind', [
  z.object({id: uuid, kind: z.literal('project')}).strict(),
  z.object({after: uuid.optional(), archived: z.boolean().optional(), kind: z.literal('projects'), limit}).strict(),
  z
    .object({kind: z.literal('membership'), pairId: uuid, sessionId, sourceProjectId: uuid.nullable().optional()})
    .strict(),
  z
    .object({
      after: sessionId.optional(),
      kind: z.literal('memberships'),
      limit,
      pairId: uuid,
      projectId: uuid.nullable(),
    })
    .strict(),
  z.object({id: uuid, kind: z.literal('reservation')}).strict(),
  z.object({id: uuid, kind: z.literal('operation')}).strict(),
  z.object({kind: z.literal('snapshot'), pairId: uuid, projectId: uuid, sessionId}).strict(),
  z.object({kind: z.literal('memories'), projectId: uuid}).strict(),
])

export interface CatalogRows {
  memberships: ProjectMembership
  memories: ProjectMemoryEntry
  operations: ProjectOperation
  projects: Project
  reservations: ProjectReservation
}
export type CatalogTable = keyof CatalogRows
export interface CatalogBackend {
  get<T extends CatalogTable>(table: T, key: string): CatalogRows[T] | null
  list<T extends CatalogTable>(
    table: T,
    filter?: {after?: string; archived?: boolean; limit?: number; pairId?: string; projectId?: null | string},
  ): CatalogRows[T][]
  put<T extends CatalogTable>(table: T, key: string, row: CatalogRows[T]): void
  transaction<T>(work: () => T, write: boolean): T
}

export function catalogDigest(value: unknown): string {
  const canonical = (item: unknown): string => {
    if (item === null || typeof item !== 'object') return JSON.stringify(item)
    if (Array.isArray(item)) return `[${item.map((part) => canonical(part)).join(',')}]`
    return `{${Object.entries(item)
      .sort(([a], [b]) => (a < b ? -1 : a === b ? 0 : 1))
      .map(([key, part]) => `${JSON.stringify(key)}:${canonical(part)}`)
      .join(',')}}`
  }

  return createHash('sha256').update(canonical(value)).digest('hex')
}

export function validateCatalogRow<T extends CatalogTable>(table: T, value: unknown): CatalogRows[T] {
  const schemas = {
    memberships: membershipSchema,
    memories: memorySchema,
    operations: z
      .object({
        digest: digestSchema,
        id: uuid,
        result: z.union([
          projectSchema,
          membershipSchema,
          memorySchema,
          reservationSchema,
          z.object({snapshotDigest: digestSchema}).strict(),
        ]),
      })
      .strict(),
    projects: projectSchema,
    reservations: reservationSchema,
  }
  const parsed = schemas[table].safeParse(value)
  if (!parsed.success) throw new ProjectStoreError('storage', `Invalid catalog ${table} record`)
  return parsed.data as CatalogRows[T]
}

function conflict(): never {
  throw new ProjectStoreError('conflict', 'Catalog revision or operation input changed')
}

function membershipKey(pairId: string, id: string): string {
  return `${pairId}:${id}`
}

/** Synchronous transaction logic, executed in the SQLite worker or an isolated test adapter. */
export class CatalogEngine {
  constructor(private readonly backend: CatalogBackend) {}

  mutate(operationId: string, input: ProjectMutation): ProjectMutationResult {
    const parsed = mutationSchema.safeParse(input)
    if (!uuid.safeParse(operationId).success || !parsed.success)
      throw new ProjectStoreError('invalid', 'Invalid catalog mutation')
    const mutation = parsed.data
    const digest = catalogDigest(mutation)
    return this.backend.transaction(() => {
      const prior = this.backend.get('operations', operationId)
      if (prior) {
        if (prior.digest !== digest) conflict()
        return prior.result
      }

      const result = this.apply(mutation, new Date().toISOString())
      this.backend.put('operations', operationId, {digest, id: operationId, result})
      return result
    }, true)
  }

  query<Q extends ProjectQuery>(input: Q): ProjectQueryResults[Q['kind']] {
    const parsed = querySchema.safeParse(input)
    if (!parsed.success) throw new ProjectStoreError('invalid', 'Invalid catalog query')
    const q = parsed.data
    return this.backend.transaction(() => {
      switch (q.kind) {
        case 'membership': {
          return this.backend.get('memberships', membershipKey(q.pairId, q.sessionId))
        }

        case 'memberships': {
          return this.backend.list('memberships', {
            after: q.after,
            limit: q.limit,
            pairId: q.pairId,
            projectId: q.projectId,
          })
        }

        case 'memories': {
          this.project(q.projectId)
          return this.backend.list('memories', {projectId: q.projectId})
        }

        case 'operation': {
          return this.backend.get('operations', q.id)
        }

        case 'project': {
          return this.backend.get('projects', q.id)
        }

        case 'projects': {
          return this.backend.list('projects', {after: q.after, archived: q.archived, limit: q.limit})
        }

        case 'reservation': {
          return this.backend.get('reservations', q.id)
        }

        case 'snapshot': {
          return {
            entries: this.backend.list('memories', {projectId: q.projectId}),
            membership: this.backend.get('memberships', membershipKey(q.pairId, q.sessionId)),
            project: this.project(q.projectId),
          }
        }
      }
    }, false) as ProjectQueryResults[Q['kind']]
  }

  private apply(m: ProjectMutation, now: string): ProjectMutationResult {
    switch (m.kind) {
      case 'capture': {
        const project = this.project(m.projectId, true)
        const member = this.backend.get('memberships', membershipKey(m.pairId, m.sessionId))
        if (
          project.memoryGeneration !== m.generation ||
          member?.projectId !== m.projectId ||
          member.revision !== m.membershipRevision ||
          member.unavailable
        )
          conflict()
        return {snapshotDigest: m.snapshotDigest}
      }

      case 'commit-reservation': {
        const r = this.backend.get('reservations', m.reservationId)
        if (!r) throw new ProjectStoreError('missing', 'Project session reservation not found')
        if (r.state === 'committed') return r
        if (this.project(r.projectId, true).revision !== r.projectRevision) conflict()
        this.membership(
          {expectedRevision: 0, pairId: r.pairId, projectId: r.projectId, sessionId: r.sessionId, unavailable: false},
          now,
        )
        const committed: ProjectReservation = {...r, state: 'committed'}
        this.backend.put('reservations', r.id, committed)
        return committed
      }

      case 'create': {
        if (this.backend.get('projects', m.id)) conflict()
        const project: Project = {
          archived: false,
          createdAt: now,
          defaultDirectory: m.directory,
          id: m.id,
          memoryGeneration: 0,
          name: m.name,
          revision: 1,
          updatedAt: now,
        }
        this.backend.put('projects', m.id, project)
        return project
      }

      case 'membership': {
        return this.membership(m, now)
      }

      case 'memory': {
        this.project(m.entry.projectId, true)
        const before = this.backend.get('memories', m.entry.id)
        if (
          (before?.revision ?? 0) !== m.expectedRevision ||
          (before &&
            (before.projectId !== m.entry.projectId ||
              catalogDigest(before.sources) !== catalogDigest(m.entry.sources)))
        )
          conflict()
        const entry: ProjectMemoryEntry = {
          ...m.entry,
          createdAt: before?.createdAt ?? now,
          edited: Boolean(before?.edited || m.entry.edited || (before && before.body !== m.entry.body)),
          revision: m.expectedRevision + 1,
          updatedAt: now,
        }
        const active = this.backend
          .list('memories', {projectId: entry.projectId})
          .filter((item) => !item.retired && item.id !== entry.id)
        if (!entry.retired) active.push(entry)
        if (
          active.length > 128 ||
          active.reduce((bytes, item) => bytes + Buffer.byteLength(item.body), 0) > 1024 * 1024
        )
          throw new ProjectStoreError('invalid', 'Project memory capacity exceeded')
        this.backend.put('memories', entry.id, entry)
        this.bumpMemory(entry.projectId)
        return entry
      }

      case 'reserve': {
        const r = m.reservation
        const project = this.project(r.projectId, true)
        if (project.revision !== r.projectRevision || this.backend.get('reservations', r.id)) conflict()
        if (this.backend.get('memberships', membershipKey(r.pairId, r.sessionId))) conflict()
        if (this.backend.list('reservations', {pairId: r.pairId}).some((item) => item.sessionId === r.sessionId))
          conflict()
        const pending: ProjectReservation = {...r, state: 'pending'}
        this.backend.put('reservations', r.id, pending)
        return pending
      }

      case 'update': {
        const before = this.project(m.id)
        if (before.revision !== m.expectedRevision) conflict()
        const project = {
          ...before,
          archived: m.archived,
          defaultDirectory: m.directory,
          name: m.name,
          revision: before.revision + 1,
          updatedAt: now,
        }
        this.backend.put('projects', m.id, project)
        return project
      }
    }
  }

  private bumpMemory(id: string): void {
    const project = this.project(id)
    this.backend.put('projects', id, {...project, memoryGeneration: project.memoryGeneration + 1})
  }

  private membership(m: Omit<Extract<ProjectMutation, {kind: 'membership'}>, 'kind'>, now: string): ProjectMembership {
    if (m.projectId) this.project(m.projectId, !m.unavailable)
    const key = membershipKey(m.pairId, m.sessionId)
    const prior = this.backend.get('memberships', key)
    if (
      (prior?.revision ?? 0) !== m.expectedRevision ||
      (m.sourceProjectId !== undefined && (prior?.projectId ?? null) !== m.sourceProjectId)
    )
      conflict()
    if (prior?.projectId) {
      this.bumpMemory(prior.projectId)
      if (prior.projectId !== m.projectId || m.unavailable) {
        for (const entry of this.backend.list('memories', {projectId: prior.projectId})) {
          if (
            !entry.retired &&
            entry.sources.some((source) => source.pairId === m.pairId && source.sessionId === m.sessionId)
          ) {
            this.backend.put('memories', entry.id, {
              ...entry,
              retired: true,
              revision: entry.revision + 1,
              updatedAt: now,
            })
          }
        }
      }
    }

    const member: ProjectMembership = {
      pairId: m.pairId,
      projectId: m.projectId,
      revision: m.expectedRevision + 1,
      sessionId: m.sessionId,
      unavailable: m.unavailable,
    }
    this.backend.put('memberships', key, member)
    return member
  }

  private project(id: string, active = false): Project {
    const project = this.backend.get('projects', id)
    if (!project) throw new ProjectStoreError('missing', 'Project not found')
    if (active && project.archived) throw new ProjectStoreError('archived', 'Project is archived')
    return project
  }
}
