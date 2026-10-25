// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {SessionRepository} from '../session/repository.js'

import {inspectExecutionJournal} from '../execution/recovery.js'
import {Message} from '../message/index.js'
import {WriterClaim} from '../session/coordination.js'
import {containsMemorySecret} from './automatic-memory.js'
import {catalogDigest} from './engine.js'
import {parseProjectContext} from './memory-context.js'
import {readProjectSession} from './session-reader.js'

export interface ProjectSourceCapture {
  archived: boolean
  messages: {digest: string; id: string; role: string; text?: string; turnId?: string}[]
  pairId: string
  runs: {runId: string; snapshot: ReturnType<typeof parseProjectContext>}[]
  sessionId: string
}

/**
 * A transport-neutral source lease. Open it only at the original registered paths.
 * Hosts release all leases before inference, and retain fresh leases through apply.
 */
export class ProjectSourceLease {
  private readonly claims: WriterClaim[] = []
  private closed = false
  private readonly sessions = new Set<string>()

  private constructor(private readonly repository: SessionRepository) {}

  static acquire(repository: SessionRepository, sessionIds: string[]): ProjectSourceLease {
    if (sessionIds.length > 128 || new Set(sessionIds).size !== sessionIds.length)
      throw new Error('Invalid Project source lease group')
    const lease = new ProjectSourceLease(repository)
    try {
      // Lock ordering must stay identical across hosts, locales and input permutations.
      const orderedIds = [...sessionIds].sort((left, right) => {
        if (left === right) return 0
        return left < right ? -1 : 1
      })
      for (const id of orderedIds) {
        lease.claims.push(WriterClaim.acquire(repository.scope(id), () => {}, true))
        lease.sessions.add(id)
      }

      return lease
    } catch (error) {
      lease.close()
      throw error
    }
  }

  async capture(sessionId: string): Promise<ProjectSourceCapture> {
    if (this.closed || !this.sessions.has(sessionId)) throw new Error('Project source session is not leased')
    // scope validates identity and the original registration; never accept a caller path.
    const scope = this.repository.scope(sessionId)
    const summary = await this.repository.findById(sessionId)
    const source = await readProjectSession(this.repository, sessionId)
    if (!summary || !source || source.parsed.recovered) throw new Error('Project source unavailable')
    const messages = source.parsed.entries.flatMap((entry) => {
      if (entry.type !== 'message') return []
      const text = new Message(entry.message.type, entry.message).content
      return [
        {
          digest: catalogDigest(entry.message),
          id: entry.message.id,
          role: entry.message.role,
          ...(entry.turnId ? {turnId: entry.turnId} : {}),
          ...(!containsMemorySecret(text) && Buffer.byteLength(text) <= 8192 ? {text} : {}),
        },
      ]
    })
    if (messages.length > 4096 || Buffer.byteLength(JSON.stringify(messages)) > 1024 * 1024)
      throw new Error('Project source capture exceeds limit')
    const inspection = await inspectExecutionJournal(scope.journalRoot, sessionId).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return {keyAvailable: false, runs: []}
        throw error
      },
    )
    const runs = inspection.keyAvailable
      ? inspection.runs.flatMap((run) => {
          const terminal = run.records.find((record) => record.kind === 'run-terminal')
          const context = run.records.find((record) => record.kind === 'project-context')
          if (
            run.issue ||
            !context ||
            terminal?.data.outcome !== 'completed' ||
            terminal.data.quiescence !== true ||
            (terminal.data.recording as {status?: string})?.status !== 'acknowledged'
          )
            return []
          return [{runId: run.runId, snapshot: parseProjectContext(context.data.snapshot)}]
        })
      : []
    return {archived: summary.archived ?? false, messages, pairId: scope.pairId, runs, sessionId}
  }

  close(): void {
    const failures: unknown[] = []
    for (const claim of [...this.claims].reverse()) {
      try {
        claim.release()
        this.claims.splice(this.claims.indexOf(claim), 1)
      } catch (error) {
        failures.push(error)
      }
    }

    if (failures.length > 0) throw new AggregateError(failures, 'Project source lease cleanup incomplete')
    this.closed = true
  }
}
