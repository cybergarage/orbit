// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {randomUUID} from 'node:crypto'

import type {SessionScope} from '../session/coordination.js'
import type {SessionRepository} from '../session/repository.js'
import type {Session} from '../session/session.js'
import type {ProjectSearchBinding} from './memory-service.js'
import type {ProjectSessionHost} from './service.js'
import type {ProjectCatalogSnapshot, ProjectMemoryEntry, ProjectMemorySource, ProjectStore} from './types.js'

import {WriterClaim} from '../session/coordination.js'
import {catalogDigest} from './engine.js'
import {projectMemoryOverlap, selectProjectMemory} from './memory-context.js'
import {readProjectDeletion, readProjectSession} from './session-reader.js'
import {ProjectStoreError} from './types.js'

export type ProjectSearchRepositoryResolver = (sessionId: string) => SessionRepository | undefined

interface RegisteredPair {
  repository: SessionRepository
  scope: SessionScope
}

interface SourceCandidate {
  ids: Set<string>
  source: ProjectMemorySource
}

interface InspectedSource extends RegisteredPair {
  bytes: number
  provenance: Map<string, string>
  revision: number
}

/** Strict opt-in path for co-resident registries; never resolves a path or falls back from an unknown Session. */
export class RegisteredPairSearch {
  constructor(
    private readonly store: ProjectStore,
    private readonly resolveRepository: ProjectSearchRepositoryResolver,
    private readonly retainedClaims: Set<WriterClaim>,
    private readonly host: ProjectSessionHost,
  ) {}

  async resolve(session: Session, signal?: AbortSignal): Promise<ProjectSearchBinding | undefined> {
    signal?.throwIfAborted()
    const sessionId = session.getId()
    const registered = this.registered(sessionId)
    if (!registered || !session.hasManagedLeaseFor(registered.scope))
      throw missing('Memory search requires a live lease for the registered Session pair')
    const {repository, scope} = registered
    const summary = await repository.findById(sessionId)
    if (
      !summary ||
      summary.file !== session.getFile() ||
      summary.archived ||
      (await readProjectDeletion(repository, sessionId))
    )
      throw missing('Memory search Session is unavailable in its registered pair')
    const member = await this.store.query({kind: 'membership', pairId: scope.pairId, sessionId})
    const project = member?.projectId ? await this.store.query({id: member.projectId, kind: 'project'}) : undefined
    signal?.throwIfAborted()
    if (!this.stillRegistered(registered) || !session.hasManagedLeaseFor(scope))
      throw missing('Memory search Session registration or lease changed')
    if (!member?.projectId) return undefined
    if (member.unavailable || !project || project.archived) throw missing('Memory search Project is unavailable')
    return {pairId: scope.pairId, projectId: member.projectId, revision: member.revision, sessionId}
  }

  /** Return only canonical evidence, after verifying all selected sources under their original claims. */
  async search(session: Session, binding: ProjectSearchBinding, query: string, signal?: AbortSignal) {
    const assertBinding = async () => {
      if (!sameSearchBinding(binding, await this.resolve(session, signal)))
        throw missing('Memory search membership changed')
    }

    const {pairId, projectId, sessionId} = binding
    const load = () => this.store.query({kind: 'snapshot', pairId, projectId, sessionId})
    await assertBinding()
    const catalog = await load()
    assertSnapshot(binding, catalog)

    const entries = catalog.entries.filter((entry) => projectMemoryOverlap(query, entry) > 0)
    return this.withClaims(async (claims) => {
      const sources = await this.collect(entries, binding, claims, signal)
      const snapshot = selectProjectMemory(
        {...catalog, entries},
        {
          captureId: randomUUID(),
          crossPair: true,
          execution: 'agent',
          ineligible: missingEvidence(entries, sources),
          request: query,
        },
      )
      for (const source of sources.values()) {
        // Recheck all completed source reads while still holding their original claims.
        // eslint-disable-next-line no-await-in-loop
        if (source && !(await this.current(source, projectId))) throw missing('Memory source authorization changed')
      }

      await assertBinding()
      assertSnapshot(binding, await load(), snapshot.generation)
      signal?.throwIfAborted()
      const requester = this.registered(sessionId)
      if (requester?.scope.pairId !== pairId || !session.hasManagedLeaseFor(requester.scope))
        throw missing('Memory search Session registration or lease changed')
      for (const source of sources.values())
        if (source && !this.stillRegistered(source)) throw missing('Memory source registration changed')
      for (const claim of claims) claim.assertLive()
      return snapshot
    })
  }

  private async collect(
    entries: ProjectMemoryEntry[],
    binding: ProjectSearchBinding,
    claims: WriterClaim[],
    signal?: AbortSignal,
  ) {
    const sources = new Map<string, InspectedSource | undefined>()
    let bytes = 0
    // Stable order across pairs and hosts; keep handles and aggregate read size bounded.
    for (const candidate of uniqueSources(entries)) {
      signal?.throwIfAborted()
      // eslint-disable-next-line no-await-in-loop
      const inspected = await this.inspect(candidate, binding, claims)
      sources.set(sourceKey(candidate.source), inspected)
      bytes += inspected?.bytes ?? 0
      if (bytes > 64 * 1024 * 1024)
        throw new ProjectStoreError('invalid', 'Memory sources exceed the inspection budget')
    }

    return sources
  }

  private async current(source: InspectedSource, projectId: string): Promise<boolean> {
    const {pairId, sessionId} = source.scope
    const member = await this.store.query({kind: 'membership', pairId, sessionId})
    return (
      member?.projectId === projectId &&
      member.revision === source.revision &&
      !member.unavailable &&
      !source.repository.isArchived(sessionId) &&
      !(await readProjectDeletion(source.repository, sessionId))
    )
  }

  private async inspect(
    {ids, source}: SourceCandidate,
    binding: ProjectSearchBinding,
    claims: WriterClaim[],
  ): Promise<InspectedSource | undefined> {
    const {pairId, sessionId} = source
    const registered = this.registered(sessionId)
    if (registered?.scope.pairId !== pairId) return undefined
    const member = await this.store.query({kind: 'membership', pairId, sessionId})
    if (member?.projectId !== binding.projectId || member.unavailable) return undefined
    const {repository, scope} = registered
    if (repository.isArchived(sessionId)) return undefined

    // A peer claim is temporary and exclusive. Never close a host thread or acquire for the current Session.
    if (sessionId !== binding.sessionId) {
      const thread = this.host.getThread(sessionId)
      if (thread?.status === 'running' || thread?.run?.quarantined)
        throw new ProjectStoreError('busy', 'Memory source has an active or quarantined writer')
      const claim = WriterClaim.acquire(scope, () => {}, true)
      claims.push(claim)
      this.retainedClaims.add(claim)
    }

    const read = await readProjectSession(repository, sessionId).catch((error: unknown) => {
      if (error instanceof ProjectStoreError && error.code === 'missing') return null
      throw error
    })
    if (!read) return undefined
    const provenance = new Map<string, string>()
    for (const entry of read.parsed.entries) {
      if (entry.type !== 'message' || !ids.has(entry.message.id)) continue
      if (provenance.has(entry.message.id)) throw missing('Ambiguous memory source message')
      provenance.set(entry.message.id, catalogDigest(entry.message))
    }

    return {
      ...registered,
      bytes: Buffer.byteLength(JSON.stringify(read.parsed.entries)),
      provenance,
      revision: member.revision,
    }
  }

  private registered(sessionId: string): RegisteredPair | undefined {
    const repository = this.resolveRepository(sessionId)
    return repository && {repository, scope: repository.scope(sessionId)}
  }

  private stillRegistered(prior: RegisteredPair): boolean {
    const current = this.registered(prior.scope.sessionId)
    return (
      prior.scope.pairId === current?.scope.pairId &&
      prior.scope.sessionRoot === current.scope.sessionRoot &&
      prior.scope.journalRoot === current.scope.journalRoot
    )
  }

  private async withClaims<T>(work: (claims: WriterClaim[]) => Promise<T>): Promise<T> {
    const claims: WriterClaim[] = []
    const failures: unknown[] = []
    let result: T | undefined
    try {
      result = await work(claims)
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
}

function missing(message: string): ProjectStoreError {
  return new ProjectStoreError('missing', message)
}

function assertSnapshot(
  binding: ProjectSearchBinding,
  {membership, project}: ProjectCatalogSnapshot,
  generation?: number,
): void {
  if (
    project.id !== binding.projectId ||
    project.archived ||
    (generation !== undefined && project.memoryGeneration !== generation) ||
    !membership ||
    !sameSearchBinding(binding, membership.projectId ? {...membership, projectId: membership.projectId} : undefined) ||
    membership.unavailable
  )
    throw missing(generation === undefined ? 'Memory search membership changed' : 'Memory search catalog changed')
}

function missingEvidence(
  entries: ProjectMemoryEntry[],
  sources: Map<string, InspectedSource | undefined>,
): Map<string, string> {
  const ineligible = new Map<string, string>()
  for (const entry of entries)
    if (
      entry.sources.some((source) => sources.get(sourceKey(source))?.provenance.get(source.messageId) !== source.digest)
    )
      ineligible.set(entry.id, 'source-evidence')
  return ineligible
}

function sourceKey({pairId, sessionId}: ProjectMemorySource): string {
  return `${sessionId}:${pairId}`
}

function uniqueSources(entries: ProjectMemoryEntry[]): SourceCandidate[] {
  const byKey = new Map<string, SourceCandidate>()
  for (const entry of entries) {
    for (const source of entry.sources) {
      const key = sourceKey(source)
      let item = byKey.get(key)
      if (!item) {
        item = {ids: new Set(), source}
        byKey.set(key, item)
      }

      item.ids.add(source.messageId)
    }
  }

  return [...byKey.keys()].sort().map((key) => byKey.get(key)!)
}

export function sameSearchBinding(a: ProjectSearchBinding, b?: ProjectSearchBinding): boolean {
  return (
    a.projectId === b?.projectId && a.pairId === b?.pairId && a.sessionId === b?.sessionId && a.revision === b?.revision
  )
}
