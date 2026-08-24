// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {SessionLogStore} from '../logs/index.js'
import type {SessionRepository, SessionSummary} from './repository.js'

export interface SessionThreadCloser {
  closeThread(threadId: string): Promise<boolean>
}

export class SessionDeletionService {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly logs: SessionLogStore,
    private readonly threads?: SessionThreadCloser,
  ) {}

  async delete(sessionId: string): Promise<SessionSummary | undefined> {
    const session = await this.sessions.findById(sessionId)
    if (session === undefined) return undefined
    await this.threads?.closeThread(sessionId)
    await this.logs.deleteSession(sessionId)
    return this.sessions.delete(sessionId)
  }
}
