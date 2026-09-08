// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises'
import path from 'node:path'

import type {JournalLevel} from '../execution/journal.js'
import type {SessionLogStore} from '../logs/index.js'
import type {SessionRepository, SessionSummary} from './repository.js'

import {readDeletionMarker, writeDeletionMarker} from '../execution/deletion.js'
import {syncDirectory} from '../execution/journal.js'
import {inspectTranscript, WriterClaim} from './coordination.js'

export interface SessionThreadCloser {
  closeThread(threadId: string): Promise<boolean>
  getThread?(
    id: string,
  ): undefined | {run?: {phase: string; quarantined?: boolean; result?: {quiescence: boolean}}; status: string}
}

export class SessionDeletionService {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly logs: SessionLogStore,
    private readonly threads?: SessionThreadCloser,
    private readonly level: Exclude<JournalLevel, 'memory'> = 'file-and-directory-sync',
  ) {}

  async delete(sessionId: string): Promise<SessionSummary | undefined | {file?: undefined; id: string}> {
    if (!['file-and-directory-sync', 'file-sync'].includes(this.level))
      throw new Error('Unsupported deletion acknowledgement level')
    const scope = this.sessions.scope(sessionId)
    const root = this.sessions.journalRoot
    let marker = await readDeletionMarker(root, sessionId)
    let session = await this.sessions.findById(sessionId)
    if (!session && !marker) return undefined
    const thread = this.threads?.getThread?.(sessionId)
    if (thread?.status === 'running' || thread?.run?.quarantined === true)
      throw new Error('Cannot delete an active or quarantined session')
    await this.threads?.closeThread(sessionId)
    const guard = WriterClaim.acquire(scope, () => {}, true)
    try {
      marker = await readDeletionMarker(root, sessionId)
      session = await this.sessions.findById(sessionId)
      if (!session && !marker) return undefined
      if (session) inspectTranscript(scope, session.file)
      const currentThread = this.threads?.getThread?.(sessionId)
      if (currentThread?.status === 'running' || currentThread?.run?.quarantined === true)
        throw new Error('Cannot delete an active or quarantined session')
      await writeDeletionMarker(root, sessionId, 'deleting', this.level)
      await this.logs.deleteSession(sessionId)
      if (session) {
        await fs.unlink(session.file)
        if (this.level === 'file-and-directory-sync') await syncDirectory(path.dirname(session.file))
      }

      await fs.rm(path.join(root, sessionId), {force: true, recursive: true})
      if (this.level === 'file-and-directory-sync') await syncDirectory(root)
      await writeDeletionMarker(root, sessionId, 'completed', this.level)
      return session ?? {id: sessionId}
    } catch (error) {
      throw new Error('Session deletion incomplete; retry deletion using the retained marker', {cause: error})
    } finally {
      guard.release()
    }
  }
}
