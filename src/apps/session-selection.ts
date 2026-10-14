// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {SessionRepository, SessionSummary} from '../core/index.js'

const interactiveOriginators = new Set(['orbit-interactive', 'orbit-thread-manager'])

export interface SessionSelectionOptions {
  all?: boolean
  archive?: 'active' | 'all' | 'archived'
  last?: boolean
}

export async function selectSessionSummary(
  repository: SessionRepository,
  sessionId: string | undefined,
  options: SessionSelectionOptions,
  launchCwd: string,
): Promise<SessionSummary> {
  validateSessionSelection(sessionId, options)
  const summary =
    sessionId === undefined
      ? await latestEligibleSession(repository, options, launchCwd)
      : await exactSession(repository, sessionId)
  if (summary !== undefined) {
    if (
      options.archive !== undefined &&
      options.archive !== 'all' &&
      summary.archived !== (options.archive === 'archived')
    )
      throw new Error(`Session does not match archive filter: ${summary.id}`)
    return summary
  }

  if (sessionId !== undefined) throw new Error(`Unknown session: ${sessionId}`)
  if (options.all === true) throw new Error('No saved interactive sessions found.')
  throw new Error(`No saved interactive sessions found for ${launchCwd}.`)
}

export function validateSessionSelection(sessionId: string | undefined, options: SessionSelectionOptions): void {
  if (sessionId !== undefined && options.last === true) {
    throw new Error('Pass either a session ID or --last, not both.')
  }

  if (sessionId === undefined && options.last !== true) {
    throw new Error('Pass a session ID or --last. Interactive session selection is not available yet.')
  }

  if (options.all === true && options.last !== true) {
    throw new Error('--all requires --last.')
  }
}

async function latestEligibleSession(repository: SessionRepository, options: SessionSelectionOptions, cwd: string) {
  let cursor: string | undefined
  do {
    // eslint-disable-next-line no-await-in-loop
    const page = await repository.listPage({archive: options.archive, cursor, limit: 200})
    if (page.errors.length > 0)
      throw new Error(`Session selection failed: ${page.errors.map((error) => error.message).join('; ')}`)
    const session = page.data.find(
      (item) =>
        (options.all === true || item.cwd === cwd) &&
        item.originator !== undefined &&
        interactiveOriginators.has(item.originator),
    )
    if (session) return session
    cursor = page.nextCursor
  } while (cursor !== undefined)
}

async function exactSession(repository: SessionRepository, id: string) {
  let cursor: string | undefined
  do {
    // eslint-disable-next-line no-await-in-loop
    const page = await repository.listPage({cursor, limit: 200})
    if (page.errors.length > 0)
      throw new Error(`Session selection failed: ${page.errors.map((error) => error.message).join('; ')}`)
    const session = page.data.find((item) => item.id === id)
    if (session) return session
    cursor = page.nextCursor
  } while (cursor !== undefined)
}
