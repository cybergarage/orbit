// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {createHash, randomUUID} from 'node:crypto'

import type {ContextPolicy} from '../session/context-policy.js'
import type {SessionRepository} from '../session/repository.js'
import type {KnowledgeExtractor} from './automatic-memory.js'
import type {ProjectSessionHost} from './service.js'
import type {ProjectExtractionJob, ProjectMemoryEntry, ProjectMemorySource, ProjectMutation} from './types.js'

import {inspectExecutionJournal} from '../execution/recovery.js'
import {Message} from '../message/index.js'
import {WriterClaim} from '../session/coordination.js'
import {AutomaticProjectMemory, containsMemorySecret, stableMemoryId} from './automatic-memory.js'
import {catalogDigest} from './engine.js'
import {parseProjectContext} from './memory-context.js'
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
  private automaticStopped = false
  private automaticTimer?: ReturnType<typeof setInterval>
  private automaticWork?: Promise<void>
  private readonly retainedClaims = new Set<WriterClaim>()

  constructor(
    private readonly projects: ProjectService,
    private readonly host: ProjectSessionHost,
    private readonly resolveSource?: (sessionId: string) => SessionRepository | undefined,
  ) {}

  async close(): Promise<void> {
    this.automaticStopped = true
    clearInterval(this.automaticTimer)
    await this.automaticWork
    for (const claim of this.retainedClaims) {
      claim.release()
      this.retainedClaims.delete(claim)
    }
  }

  /* eslint-disable no-await-in-loop -- Retry optimistic writes against fresh counters. */
  async configureAutomatic(
    projectId: string,
    enabled: boolean,
    limits?: {maxCalls: number; maxInputTokens: number; maxOutputTokens: number},
  ): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const prior = await this.projects.store.query({id: projectId, kind: 'automation'})
        const config = prior ?? {
          enabled: true,
          id: projectId,
          inputTokens: 0,
          maxInputTokens: 100_000,
          maxOutputTokens: 16_384,
          outputTokens: 0,
          revision: 0,
        }
        await this.projects.store.mutate(randomUUID(), {
          config: {...config, ...limits, enabled},
          expectedRevision: config.revision,
          kind: 'automation',
        })
        return
      } catch (error) {
        if (!(error instanceof ProjectStoreError) || error.code !== 'conflict' || attempt === 2) throw error
      }
    }
  }

  /* eslint-enable no-await-in-loop */

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
      ...(entry.automatic ? {automatic: {...entry.automatic, pending: false}} : {}),
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
      request?: string
      signal?: AbortSignal
    } = {},
  ): Promise<ProjectContextSnapshot> {
    selection = parseMemorySelection(selection)
    if (!['automatic', 'curated'].includes(selection.mode))
      throw new ProjectStoreError('invalid', 'Memory preparation requires curated mode')
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
        request: selection.mode === 'automatic' ? options.request : undefined,
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

  /** Reconciliation, not an observer callback, is the authoritative enqueue path. */
  /* Catalog and source ownership operations are intentionally serialized to bound open handles. */
  /* eslint-disable no-await-in-loop */
  async reconcileAutomatic(extract?: KnowledgeExtractor): Promise<void> {
    const runner = new AutomaticProjectMemory(
      this.projects.store,
      extract ??
        (async () => {
          throw new Error('No extractor')
        }),
      (job, apply) => this.validateAutomatic(job, apply),
    )
    let after: string | undefined
    do {
      const projects = await this.projects.store.query({after, archived: false, kind: 'projects', limit: 100})
      for (const project of projects) {
        if (this.automaticStopped) return
        const config = await this.projects.store.query({id: project.id, kind: 'automation'})
        if (config?.enabled === false) continue
        if (
          config &&
          ((config.calls ?? 0) >= (config.maxCalls ?? 16) ||
            config.inputTokens + 4096 > config.maxInputTokens ||
            config.outputTokens + 1024 > config.maxOutputTokens)
        )
          continue
        const status = await this.projects.store.query({kind: 'automation-status', projectId: project.id})
        let available = status.queue.limit - status.queue.pending
        let cursor: string | undefined
        do {
          const members = await this.projects.store.query({
            after: cursor,
            kind: 'memberships',
            limit: 100,
            pairId: this.projects.repository.scope('automatic-memory').pairId,
            projectId: project.id,
          })
          for (const member of members) {
            if (available <= 0) break
            if (member.unavailable || this.host.getThread(member.sessionId)?.status === 'running') continue
            const summary = await this.projects.repository.findById(member.sessionId)
            if (!summary || summary.archived) continue
            await this.withSources([member.sessionId], undefined, async () => {
              const inspection = await inspectExecutionJournal(this.projects.repository.journalRoot, member.sessionId)
              if (!inspection.keyAvailable) return
              const source = await readProjectSession(this.projects.repository, member.sessionId)
              if (!source || source.parsed.recovered) return
              for (const run of inspection.runs) {
                if (available <= 0) break
                if (run.issue) continue
                const terminal = run.records.find((record) => record.kind === 'run-terminal')
                const context = run.records.find((record) => record.kind === 'project-context')
                if (
                  terminal?.data.outcome !== 'completed' ||
                  terminal.data.quiescence !== true ||
                  (terminal.data.recording as {status?: string})?.status !== 'acknowledged' ||
                  !context
                )
                  continue
                const snapshot = parseProjectContext(context.data.snapshot)
                if (snapshot.projectId !== project.id || snapshot.membershipRevision !== member.revision) continue
                const id = stableMemoryId([snapshot.pairId, member.sessionId, run.runId, 'extract-v1'])
                if (await this.projects.store.query({id, kind: 'extraction'})) continue
                const messages = source.parsed.entries.flatMap((entry) => {
                  if (entry.type !== 'message' || entry.turnId !== run.runId) return []
                  const text = new Message(entry.message.type, entry.message).content
                  if (!text || containsMemorySecret(text) || Buffer.byteLength(text) > 8192) return []
                  return [{digest: catalogDigest(entry.message), id: entry.message.id, role: entry.message.role, text}]
                })
                if (
                  messages.length === 0 ||
                  messages.length > 32 ||
                  Buffer.byteLength(JSON.stringify(messages)) > 12_000
                )
                  continue
                const job: ProjectExtractionJob = {
                  admissionDigest: snapshot.digest,
                  attempt: 0,
                  id,
                  inputTokens: 0,
                  membershipRevision: member.revision,
                  messages,
                  outputTokens: 0,
                  pairId: member.pairId,
                  projectId: project.id,
                  revision: 0,
                  runId: run.runId,
                  sessionId: member.sessionId,
                  sourceDigest: catalogDigest(messages),
                  state: 'pending',
                }
                await this.projects.store.mutate(stableMemoryId([id, 'enqueue']), {
                  entries: [],
                  expectedRevision: 0,
                  generation: project.memoryGeneration,
                  job,
                  kind: 'extraction',
                })
                available--
              }
            }).catch(() => {})
          }

          cursor = available > 0 && members.length === 100 ? members.at(-1)!.sessionId : undefined
        } while (cursor)

        const jobs = await this.projects.store.query({kind: 'extractions', projectId: project.id})
        if (extract)
          for (const job of jobs
            .filter((job) => !['completed', 'discarded'].includes(job.state) && job.attempt < 3)
            .slice(0, 10)) {
            if (this.automaticStopped) return
            await runner.process(job).catch(() => {})
          }
      }

      after = projects.length === 100 ? projects.at(-1)!.id : undefined
    } while (after)
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

  startAutomatic(extract: KnowledgeExtractor): void {
    const tick = () => {
      if (this.automaticWork || this.automaticStopped) return
      this.automaticWork = this.reconcileAutomatic(extract)
        .catch(() => {})
        .finally(() => {
          this.automaticWork = undefined
        })
    }

    this.automaticTimer = setInterval(tick, 5000)
    this.automaticTimer.unref()
    tick()
  }

  /* eslint-enable no-await-in-loop */

  async validateAutomatic(job: ProjectExtractionJob, apply?: () => Promise<void>): Promise<boolean> {
    return this.withSources([job.sessionId], undefined, async () => {
      const repository = this.resolveSource?.(job.sessionId) ?? this.projects.repository
      if (repository.scope(job.sessionId).pairId !== job.pairId) return false
      const member = await this.projects.store.query({kind: 'membership', pairId: job.pairId, sessionId: job.sessionId})
      if (member?.projectId !== job.projectId || member.revision !== job.membershipRevision || member.unavailable)
        return false
      const summary = await repository.findById(job.sessionId)
      if (!summary || summary.archived) return false
      const source = await readProjectSession(repository, job.sessionId)
      if (!source || source.parsed.recovered || catalogDigest(job.messages) !== job.sourceDigest) return false
      const inspection = await inspectExecutionJournal(repository.journalRoot, job.sessionId)
      const run = inspection.runs.find((item) => item.runId === job.runId)
      const context = run?.records.find((item) => item.kind === 'project-context')
      const terminal = run?.records.find((item) => item.kind === 'run-terminal')
      if (
        !inspection.keyAvailable ||
        run?.issue ||
        !context ||
        terminal?.data.outcome !== 'completed' ||
        terminal.data.quiescence !== true ||
        (terminal.data.recording as {status?: string})?.status !== 'acknowledged'
      )
        return false
      const snapshot = parseProjectContext(context.data.snapshot)
      if (
        !job.admissionDigest ||
        snapshot.digest !== job.admissionDigest ||
        snapshot.projectId !== job.projectId ||
        snapshot.membershipRevision !== job.membershipRevision
      )
        return false

      if (
        job.messages.some(
          (message) =>
            !source.parsed.entries.some(
              (entry) =>
                entry.type === 'message' &&
                entry.message.id === message.id &&
                catalogDigest(entry.message) === message.digest,
            ),
        )
      )
        return false
      await apply?.()
      return true
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
    const archived = new Map<string, boolean>()
    let inspectedBytes = 0
    for (const entry of entries) {
      for (const source of entry.sources) {
        signal?.throwIfAborted()
        const repository = this.resolveSource?.(source.sessionId) ?? this.projects.repository
        const scope = repository.scope(source.sessionId)
        if (!archived.has(source.sessionId)) {
          // eslint-disable-next-line no-await-in-loop
          archived.set(source.sessionId, (await repository.findById(source.sessionId))?.archived ?? false)
        }

        if (archived.get(source.sessionId)) {
          ineligible.set(entry.id, 'source-archived')
          continue
        }

        // Source inspections are sequential to bound aggregate memory and open handles.
        // eslint-disable-next-line no-await-in-loop
        const member = await this.projects.store.query({
          kind: 'membership',
          pairId: scope.pairId,
          sessionId: source.sessionId,
        })
        if (scope.pairId !== source.pairId || member?.projectId !== projectId || member.unavailable) {
          ineligible.set(entry.id, 'source-membership')
          continue
        }

        if (!cache.has(source.sessionId)) {
          // eslint-disable-next-line no-await-in-loop
          const read = await readProjectSession(repository, source.sessionId).catch((error: unknown) => {
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
        const claim = WriterClaim.acquire(
          (this.resolveSource?.(id) ?? this.projects.repository).scope(id),
          () => {},
          true,
        )
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
