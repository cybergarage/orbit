// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {createHash} from 'node:crypto'
import path from 'node:path'
import {z} from 'zod'

import type {
  Project,
  ProjectAutomation,
  ProjectExtractionJob,
  ProjectMembership,
  ProjectMemoryEntry,
  ProjectMutation,
  ProjectMutationResult,
  ProjectOperation,
  ProjectQuery,
  ProjectQueryResults,
  ProjectReservation,
} from './types.js'

import {displayNameSchema} from '../display-name.js'
import {knowledgeOverlap} from './knowledge-relevance.js'
import {MAX_PENDING_PROJECT_EXTRACTIONS, ProjectStoreError} from './types.js'

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
    name: z.string().trim().min(1).max(256),
    revision,
    updatedAt: timestamp,
  })
  .strict()
const membershipSchema = z
  .object({pairId: uuid, projectId: uuid.nullable(), revision, sessionId, unavailable: z.boolean()})
  .strict()
const memorySchema = z
  .object({
    automatic: z
      .object({
        condition: z.string().max(512),
        evidence: z.string().max(2048).optional(),
        fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
        importance: z.number().int().min(0).max(3),
        kind: z.enum(['decision', 'constraint', 'correction', 'fact']),
        pending: z.boolean(),
        supersedes: uuid.optional(),
      })
      .strict()
      .optional(),
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
const automationSchema = z
  .object({
    calls: revision.optional(),
    enabled: z.boolean(),
    id: uuid,
    inputTokens: revision,
    maxCalls: revision.max(10_000).optional(),
    maxInputTokens: revision.max(10_000_000),
    maxOutputTokens: revision.max(1_000_000),
    observedInputTokens: revision.optional(),
    observedOutputTokens: revision.optional(),
    outputTokens: revision,
    revision,
  })
  .strict()
const extractionSchema = z
  .object({
    admissionDigest: digestSchema.optional(),
    attempt: revision.max(3),
    error: z.string().max(256).optional(),
    id: uuid,
    inputTokens: revision,
    membershipRevision: revision,
    messages: z
      .array(
        z.object({digest: digestSchema, id: sessionId, role: z.string().max(32), text: z.string().max(8192)}).strict(),
      )
      .min(1)
      .max(32),
    observedInputTokens: revision.optional(),
    observedOutputTokens: revision.optional(),
    outputTokens: revision,
    pairId: uuid,
    projectId: uuid,
    revision,
    runId: sessionId,
    sessionId,
    sourceDigest: digestSchema,
    state: z.enum(['pending', 'running', 'completed', 'failed', 'discarded']),
  })
  .strict()
const mutationSchema = z.discriminatedUnion('kind', [
  z.object({config: automationSchema, expectedRevision: revision, kind: z.literal('automation')}).strict(),
  z
    .object({
      entries: z.array(memorySchema.omit({createdAt: true, revision: true, updatedAt: true})).max(8),
      expectedRevision: revision,
      generation: revision,
      job: extractionSchema,
      kind: z.literal('extraction'),
    })
    .strict(),
  z.object({expectedRevision: revision, id: uuid, kind: z.literal('delete')}).strict(),
  z.object({expectedRevision: revision, id: uuid, kind: z.literal('rename'), name: displayNameSchema}).strict(),
  z
    .object({directory, expectedRevision: z.literal(0), id: uuid, kind: z.literal('create'), name: displayNameSchema})
    .strict(),
  z
    .object({
      archived: z.boolean().optional(),
      directory: directory.optional(),
      expectedRevision: revision,
      id: uuid,
      kind: z.literal('update'),
      name: displayNameSchema.optional(),
    })
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
  z.object({kind: z.literal('automation-status'), projectId: uuid}).strict(),
  z.object({id: uuid, kind: z.literal('automation')}).strict(),
  z.object({id: uuid, kind: z.literal('extraction')}).strict(),
  z.object({kind: z.literal('extractions'), projectId: uuid}).strict(),
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
  z
    .object({
      after: uuid.optional(),
      kind: z.literal('memories'),
      limit: limit.optional(),
      projectId: uuid,
      retired: z.boolean().optional(),
    })
    .strict(),
  z.object({id: uuid, kind: z.literal('memory')}).strict(),
])

export interface CatalogRows {
  automation: ProjectAutomation
  extractions: ProjectExtractionJob
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
    filter?: {
      after?: string
      archived?: boolean
      limit?: number
      pairId?: string
      projectId?: null | string
      retired?: boolean
    },
  ): CatalogRows[T][]
  put<T extends CatalogTable>(table: T, key: string, row: CatalogRows[T]): void
  remove(table: CatalogTable, key: string): void
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
    automation: automationSchema,
    extractions: extractionSchema,
    memberships: membershipSchema,
    memories: memorySchema,
    operations: z
      .object({
        digest: digestSchema,
        id: uuid,
        result: z.union([
          automationSchema,
          extractionSchema,
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
        case 'automation': {
          return this.backend.get('automation', q.id)
        }

        case 'automation-status': {
          this.project(q.projectId)
          const jobs = this.backend.list('extractions', {projectId: q.projectId})
          return {
            config: this.backend.get('automation', q.projectId),
            entries: this.backend.list('memories', {projectId: q.projectId}),
            jobs,
            queue: {
              limit: MAX_PENDING_PROJECT_EXTRACTIONS,
              pending: jobs.filter((job) => job.attempt < 3 && !['completed', 'discarded'].includes(job.state)).length,
            },
          }
        }

        case 'extraction': {
          return this.backend.get('extractions', q.id)
        }

        case 'extractions': {
          return this.backend.list('extractions', {projectId: q.projectId})
        }

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
          return this.backend.list('memories', {
            after: q.after,
            limit: q.limit ?? 200,
            projectId: q.projectId,
            retired: q.retired,
          })
        }

        case 'memory': {
          return this.backend.get('memories', q.id)
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
            entries: this.backend.list('memories', {limit: 129, projectId: q.projectId, retired: false}),
            membership: this.backend.get('memberships', membershipKey(q.pairId, q.sessionId)),
            project: this.project(q.projectId),
          }
        }
      }
    }, false) as ProjectQueryResults[Q['kind']]
  }

  private apply(m: ProjectMutation, now: string): ProjectMutationResult {
    switch (m.kind) {
      case 'automation': {
        this.project(m.config.id, true)
        const before = this.backend.get('automation', m.config.id)
        if (
          (before?.revision ?? 0) !== m.expectedRevision ||
          m.config.inputTokens !== (before?.inputTokens ?? 0) ||
          m.config.outputTokens !== (before?.outputTokens ?? 0) ||
          (m.config.calls ?? 0) !== (before?.calls ?? 0) ||
          (m.config.observedInputTokens ?? 0) !== (before?.observedInputTokens ?? 0) ||
          (m.config.observedOutputTokens ?? 0) !== (before?.observedOutputTokens ?? 0)
        )
          conflict()
        const config = {...m.config, revision: m.expectedRevision + 1}
        this.backend.put('automation', config.id, config)
        this.bumpMemory(config.id)
        return config
      }

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

      case 'delete': {
        const project = this.project(m.id)
        if (project.revision !== m.expectedRevision) conflict()
        const reservations = this.backend.list('reservations', {projectId: m.id})
        if (
          this.backend.list('memberships', {limit: 1, projectId: m.id}).length > 0 ||
          reservations.some((item) => item.state === 'pending')
        )
          throw new ProjectStoreError(
            'conflict',
            'Move or delete all project sessions and complete pending reservations before deleting the project',
          )
        for (const entry of this.backend.list('memories', {projectId: m.id})) this.backend.remove('memories', entry.id)
        for (const reservation of reservations) this.backend.remove('reservations', reservation.id)
        for (const job of this.backend.list('extractions', {projectId: m.id}))
          this.backend.remove('extractions', job.id)
        this.backend.remove('automation', m.id)
        this.backend.remove('projects', m.id)
        return project
      }

      case 'extraction': {
        const {job} = m
        const project = this.project(job.projectId, true)
        const member = this.backend.get('memberships', membershipKey(job.pairId, job.sessionId))
        if (
          job.state !== 'discarded' &&
          (member?.projectId !== job.projectId || member.unavailable || member.revision !== job.membershipRevision)
        )
          conflict()
        const prior = this.backend.get('extractions', job.id)
        if ((prior?.revision ?? 0) !== m.expectedRevision) conflict()
        if (
          prior &&
          (prior.sourceDigest !== job.sourceDigest ||
            prior.admissionDigest !== job.admissionDigest ||
            prior.runId !== job.runId ||
            prior.projectId !== job.projectId ||
            prior.membershipRevision !== job.membershipRevision ||
            catalogDigest(prior.messages) !== catalogDigest(job.messages))
        )
          conflict()
        const config = this.backend.get('automation', job.projectId) ?? {
          enabled: true,
          id: job.projectId,
          inputTokens: 0,
          maxInputTokens: 100_000,
          maxOutputTokens: 16_384,
          outputTokens: 0,
          revision: 0,
        }
        // A stopped Project may settle already-reserved work, but cannot start or apply it.
        if (!config.enabled && (!prior || m.entries.length > 0 || !['discarded', 'failed'].includes(job.state)))
          throw new ProjectStoreError('invalid', 'Automatic memory is stopped')
        if (
          !prior &&
          this.backend
            .list('extractions', {projectId: job.projectId})
            .filter((item) => item.attempt < 3 && !['completed', 'discarded'].includes(item.state)).length >=
            MAX_PENDING_PROJECT_EXTRACTIONS
        )
          throw new ProjectStoreError('busy', 'Project extraction queue capacity reached')
        if (
          !prior &&
          (job.state !== 'pending' ||
            job.attempt !== 0 ||
            job.inputTokens !== 0 ||
            job.outputTokens !== 0 ||
            (job.observedInputTokens ?? 0) !== 0 ||
            (job.observedOutputTokens ?? 0) !== 0)
        )
          conflict()
        if (prior) {
          if (['completed', 'discarded'].includes(prior.state)) conflict()
          const starting = job.state === 'running'
          if (
            (job.observedInputTokens ?? 0) < (prior.observedInputTokens ?? 0) ||
            (job.observedOutputTokens ?? 0) < (prior.observedOutputTokens ?? 0)
          )
            conflict()
          if (
            starting &&
            ((job.observedInputTokens ?? 0) !== (prior.observedInputTokens ?? 0) ||
              (job.observedOutputTokens ?? 0) !== (prior.observedOutputTokens ?? 0))
          )
            conflict()
          if (
            job.attempt !== prior.attempt + (starting ? 1 : 0) ||
            job.inputTokens < prior.inputTokens ||
            job.outputTokens < prior.outputTokens
          )
            conflict()
          if (!starting && !['completed', 'discarded', 'failed'].includes(job.state)) conflict()
          if (
            starting &&
            (job.inputTokens - prior.inputTokens !== 4096 || job.outputTokens - prior.outputTokens !== 1024)
          )
            conflict()
          if (!starting && (job.inputTokens !== prior.inputTokens || job.outputTokens !== prior.outputTokens))
            conflict()
          const next = {
            ...config,
            calls: (config.calls ?? 0) + (starting ? 1 : 0),
            enabled: config.enabled && job.error !== 'Extractor usage metadata or limit violation',
            inputTokens: config.inputTokens + job.inputTokens - prior.inputTokens,
            observedInputTokens:
              (config.observedInputTokens ?? 0) + (job.observedInputTokens ?? 0) - (prior.observedInputTokens ?? 0),
            observedOutputTokens:
              (config.observedOutputTokens ?? 0) + (job.observedOutputTokens ?? 0) - (prior.observedOutputTokens ?? 0),
            outputTokens: config.outputTokens + job.outputTokens - prior.outputTokens,
            revision: config.revision + 1,
          }
          if (
            next.calls > (next.maxCalls ?? 16) ||
            next.inputTokens > next.maxInputTokens ||
            next.outputTokens > next.maxOutputTokens
          )
            throw new ProjectStoreError('invalid', 'Project extraction token budget exhausted')
          this.backend.put('automation', next.id, next)
        }

        if (m.entries.length > 0) {
          if (job.state !== 'completed' || project.memoryGeneration !== m.generation) conflict()
          for (const entry of m.entries) {
            if (
              entry.projectId !== job.projectId ||
              entry.retired ||
              entry.edited ||
              entry.sources.some(
                (source) =>
                  source.pairId !== job.pairId ||
                  source.sessionId !== job.sessionId ||
                  !job.messages.some((message) => message.id === source.messageId && message.digest === source.digest),
              )
            )
              conflict()
            const before = this.backend.get('memories', entry.id)
            // Retired entries are durable tombstones, including explicit user deletion.
            if (before) continue
            const duplicate = this.backend
              .list('memories', {projectId: job.projectId})
              .some(
                (item) =>
                  item.automatic?.fingerprint === entry.automatic?.fingerprint ||
                  item.body.normalize('NFKC').trim() === entry.body.normalize('NFKC').trim(),
              )
            if (duplicate) continue
            const protectedSource = this.backend
              .list('memories', {projectId: job.projectId})
              .some(
                (item) =>
                  (item.edited || item.retired) &&
                  item.automatic?.kind === entry.automatic?.kind &&
                  item.sources.some((source) =>
                    entry.sources.some(
                      (candidate) =>
                        source.pairId === candidate.pairId &&
                        source.sessionId === candidate.sessionId &&
                        source.messageId === candidate.messageId,
                    ),
                  ),
              )
            if (protectedSource) continue
            if (
              entry.automatic &&
              !entry.automatic.supersedes &&
              this.backend
                .list('memories', {projectId: job.projectId, retired: false})
                .some(
                  (item) =>
                    item.id !== entry.id &&
                    (!item.automatic ||
                      item.automatic.kind === entry.automatic?.kind ||
                      entry.automatic?.kind === 'correction') &&
                    item.body !== entry.body &&
                    (item.title.normalize('NFKC').toLowerCase() === entry.title.normalize('NFKC').toLowerCase() ||
                      knowledgeOverlap(`${item.title} ${item.body}`, `${entry.title} ${entry.body}`) > 0),
                )
            )
              entry.automatic.pending = true
            if (entry.automatic?.kind === 'correction' && !entry.automatic.supersedes) entry.automatic.pending = true
            if (entry.automatic?.supersedes && !entry.automatic.pending) {
              const old = this.backend.get('memories', entry.automatic.supersedes)
              if (!old || old.projectId !== job.projectId || old.retired || old.edited) entry.automatic.pending = true
              else
                this.backend.put('memories', old.id, {
                  ...old,
                  retired: true,
                  revision: old.revision + 1,
                  updatedAt: now,
                })
            }

            this.apply({entry, expectedRevision: 0, kind: 'memory'}, now)
          }
        }

        const next = {...job, revision: m.expectedRevision + 1}
        this.backend.put('extractions', job.id, next)
        return next
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
          .list('memories', {projectId: entry.projectId, retired: false})
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

      case 'rename': // falls through

      case 'update': {
        const before = this.project(m.id)
        if (before.revision !== m.expectedRevision) conflict()
        const project = {
          ...before,
          ...(m.kind === 'update' && m.archived !== undefined ? {archived: m.archived} : {}),
          ...(m.kind === 'update' && m.directory !== undefined ? {defaultDirectory: m.directory} : {}),
          ...(m.name === undefined ? {} : {name: m.name}),
          revision: before.revision + 1,
          updatedAt: now,
        }
        this.backend.put('projects', m.id, project)
        return project
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
        for (const entry of this.backend.list('memories', {projectId: prior.projectId, retired: false})) {
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
