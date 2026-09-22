// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {createHash} from 'node:crypto'

import type {ContextPolicy} from '../session/context-policy.js'
import type {ProjectSessionHost} from './service.js'
import type {ProjectMemoryEntry, ProjectMemorySource, ProjectMutation} from './types.js'

import {Message} from '../message/index.js'
import {WriterClaim} from '../session/coordination.js'
import {catalogDigest} from './engine.js'
import {
  parseMemorySelection,
  type ProjectContextSnapshot,
  type ProjectMemorySelection,
  selectProjectMemory,
} from './memory-context.js'
import {ProjectService} from './service.js'
import {readProjectSession} from './session-reader.js'
import {ProjectStoreError} from './types.js'

export interface ProjectMemoryWrite {
  body: string
  operationId: string
  title: string
}

export class ProjectMemoryService {
  private readonly retainedClaims = new Set<WriterClaim>()

  constructor(
    private readonly projects: ProjectService,
    private readonly host: ProjectSessionHost,
  ) {}

  async close(): Promise<void> {
    for (const claim of this.retainedClaims) {
      claim.release()
      this.retainedClaims.delete(claim)
    }
  }

  async create(projectId: string, input: ProjectMemoryWrite): Promise<ProjectMemoryEntry> {
    return this.write(
      input.operationId,
      {
        body: input.body,
        edited: false,
        id: input.operationId,
        projectId,
        retired: false,
        sources: [],
        title: input.title,
      },
      0,
    )
  }

  async edit(
    projectId: string,
    id: string,
    input: ProjectMemoryWrite & {expectedRevision: number; retired: boolean},
  ): Promise<ProjectMemoryEntry> {
    const prior = await this.prior(input.operationId)
    const entry = prior ?? (await this.projects.store.query({id, kind: 'memory'}))
    if (!entry || entry.id !== id || entry.projectId !== projectId)
      throw new ProjectStoreError('missing', 'Project memory not found')
    const changed = {
      body: input.body,
      edited: true,
      id,
      projectId,
      retired: input.retired,
      sources: entry.sources,
      title: input.title,
    }
    if (prior || input.retired) return this.write(input.operationId, changed, input.expectedRevision)
    return this.withSources(
      entry.sources.map((source) => source.sessionId),
      undefined,
      async () => {
        const ineligible = await this.validateSources(projectId, [entry])
        if (ineligible.size > 0)
          throw new ProjectStoreError('missing', `Memory source is unavailable: ${ineligible.get(entry.id)}`)
        return this.write(input.operationId, changed, input.expectedRevision)
      },
    )
  }

  async prepare(
    sessionId: string,
    requestId: string,
    selection: ProjectMemorySelection,
    options: {
      capture?: boolean
      contextPolicy?: ContextPolicy
      execution?: 'agent' | 'graph'
      signal?: AbortSignal
    } = {},
  ): Promise<ProjectContextSnapshot> {
    selection = parseMemorySelection(selection)
    if (selection.mode !== 'curated') throw new ProjectStoreError('invalid', 'Memory preparation requires curated mode')
    const membership = await this.projects.requireActive(sessionId)
    if (!membership?.projectId) throw new ProjectStoreError('missing', 'Curated memory requires a Project')
    const catalog = await this.projects.store.query({
      kind: 'snapshot',
      pairId: membership.pairId,
      projectId: membership.projectId,
      sessionId,
    })
    if (selection.expectedGeneration !== undefined && selection.expectedGeneration !== catalog.project.memoryGeneration)
      throw new ProjectStoreError('conflict', 'Memory preview is stale; prepare it again')
    const hex = createHash('sha256')
      .update(JSON.stringify([membership.pairId, sessionId, requestId]))
      .digest('hex')
    const captureId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
    const ids = catalog.entries.flatMap((entry) => entry.sources.map((source) => source.sessionId))
    return this.withSources(ids, sessionId, async () => {
      options.signal?.throwIfAborted()
      const ineligible = await this.validateSources(catalog.project.id, catalog.entries, options.signal)
      const policy = options.contextPolicy
      const tokenBudget =
        policy?.mode === 'budgeted'
          ? Math.min(
              2048,
              policy.profile.target,
              policy.profile.window - policy.profile.outputReserve - policy.profile.safetyMargin,
            )
          : 2048
      const snapshot = selectProjectMemory(catalog, {
        captureId,
        execution: options.execution ?? 'agent',
        ineligible,
        selectedIds: selection.selectedIds,
        tokenBudget,
      })
      options.signal?.throwIfAborted()
      if (options.capture !== false)
        await this.projects.store.mutate(captureId, {
          generation: snapshot.generation,
          kind: 'capture',
          membershipRevision: snapshot.membershipRevision,
          pairId: snapshot.pairId,
          projectId: snapshot.projectId,
          sessionId,
          snapshotDigest: snapshot.digest,
        })
      return snapshot
    })
  }

  async saveExcerpt(
    projectId: string,
    input: {body?: string; excerpt: string; messageId: string; operationId: string; sessionId: string; title: string},
  ): Promise<ProjectMemoryEntry> {
    const previous = await this.prior(input.operationId)
    const body = input.body ?? input.excerpt
    if (!input.excerpt || Buffer.byteLength(input.excerpt) > 8192)
      throw new ProjectStoreError('invalid', 'Invalid memory excerpt')
    if (previous) {
      if (
        previous.sources.length !== 1 ||
        previous.sources[0].sessionId !== input.sessionId ||
        previous.sources[0].messageId !== input.messageId
      )
        throw new ProjectStoreError('conflict', 'Memory source request changed')
      return this.write(
        input.operationId,
        {
          body,
          edited: body !== input.excerpt,
          id: input.operationId,
          projectId,
          retired: false,
          sources: previous.sources,
          title: input.title,
        },
        0,
      )
    }

    return this.withSources([input.sessionId], undefined, async () => {
      const member = await this.projects.membership(input.sessionId)
      if (member?.projectId !== projectId || member.unavailable)
        throw new ProjectStoreError('missing', 'Memory source is outside this Project')
      const source = await readProjectSession(this.projects.repository, input.sessionId)
      const entry = source?.parsed.entries.find(
        (entry) => entry.type === 'message' && entry.message.id === input.messageId,
      )
      if (entry?.type !== 'message' || !new Message(entry.message.type, entry.message).content.includes(input.excerpt))
        throw new ProjectStoreError('invalid', 'Excerpt is not present in the registered source message')
      const provenance: ProjectMemorySource = {
        digest: catalogDigest(entry.message),
        messageId: input.messageId,
        pairId: member.pairId,
        sessionId: input.sessionId,
      }
      return this.write(
        input.operationId,
        {
          body,
          edited: body !== input.excerpt,
          id: input.operationId,
          projectId,
          retired: false,
          sources: [provenance],
          title: input.title,
        },
        0,
      )
    })
  }

  private async prior(operationId: string): Promise<ProjectMemoryEntry | undefined> {
    const operation = await this.projects.store.query({id: operationId, kind: 'operation'})
    if (!operation) return undefined
    if (!('body' in operation.result))
      throw new ProjectStoreError('conflict', 'Operation ID belongs to another catalog mutation')
    return operation.result
  }

  private async validateSources(
    projectId: string,
    entries: ProjectMemoryEntry[],
    signal?: AbortSignal,
  ): Promise<Map<string, string>> {
    const ineligible = new Map<string, string>()
    const cache = new Map<string, Awaited<ReturnType<typeof readProjectSession>>>()
    let inspectedBytes = 0
    for (const entry of entries) {
      for (const source of entry.sources) {
        signal?.throwIfAborted()
        const scope = this.projects.repository.scope(source.sessionId)
        // Source inspections are sequential to bound aggregate memory and open handles.
        // eslint-disable-next-line no-await-in-loop
        const member = await this.projects.membership(source.sessionId)
        if (scope.pairId !== source.pairId || member?.projectId !== projectId || member.unavailable) {
          ineligible.set(entry.id, 'source-membership')
          continue
        }

        if (!cache.has(source.sessionId)) {
          // eslint-disable-next-line no-await-in-loop
          const read = await readProjectSession(this.projects.repository, source.sessionId).catch((error: unknown) => {
            if (error instanceof ProjectStoreError && error.code === 'missing') return null
            throw error
          })
          inspectedBytes += read ? Buffer.byteLength(JSON.stringify(read.parsed.entries)) : 0
          if (inspectedBytes > 64 * 1024 * 1024)
            throw new ProjectStoreError('invalid', 'Memory sources exceed the aggregate inspection budget')
          cache.set(source.sessionId, read)
        }

        const read = cache.get(source.sessionId)
        const message = read?.parsed.entries.find(
          (entry) => entry.type === 'message' && entry.message.id === source.messageId,
        )
        if (message?.type !== 'message') ineligible.set(entry.id, 'source-unavailable')
        else if (catalogDigest(message.message) !== source.digest) ineligible.set(entry.id, 'source-changed')
      }
    }

    return ineligible
  }

  private async withSources<T>(
    ids: string[],
    currentSessionId: string | undefined,
    work: () => Promise<T>,
  ): Promise<T> {
    const claims: WriterClaim[] = []
    const failures: unknown[] = []
    let result: T | undefined
    try {
      for (const id of [...new Set(ids)].filter((id) => id !== currentSessionId).sort()) {
        const thread = this.host.getThread(id)
        if (thread?.status === 'running' || thread?.run?.quarantined)
          throw new ProjectStoreError(
            'busy',
            'Memory source has an active or quarantined writer; retry or use memory off',
          )
        // Acquire in stable session order, never while holding a catalog transaction.
        // eslint-disable-next-line no-await-in-loop
        await this.host.closeThread(id)
        const claim = WriterClaim.acquire(this.projects.repository.scope(id), () => {}, true)
        claims.push(claim)
        this.retainedClaims.add(claim)
      }

      result = await work()
    } catch (error) {
      failures.push(error)
    }

    const errors: unknown[] = []
    for (const claim of claims.reverse()) {
      try {
        claim.release()
        this.retainedClaims.delete(claim)
      } catch (error) {
        errors.push(error)
      }
    }

    if (errors.length > 0)
      throw new AggregateError([...failures, ...errors], 'Memory source ownership cleanup incomplete')
    if (failures.length > 0) throw failures[0]
    return result as T
  }

  private async write(
    operationId: string,
    entry: Extract<ProjectMutation, {kind: 'memory'}>['entry'],
    expectedRevision: number,
  ): Promise<ProjectMemoryEntry> {
    return (await this.projects.store.mutate(operationId, {
      entry,
      expectedRevision,
      kind: 'memory',
    })) as ProjectMemoryEntry
  }
}
