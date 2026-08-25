// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {SessionRepository, SessionSummary} from '../core/index.js'

const interactiveOriginators = ['orbit-interactive', 'orbit-thread-manager']

export interface SessionSelectionOptions {
  all?: boolean
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
      ? await repository.findLatest({
          ...(options.all === true ? {} : {cwd: launchCwd}),
          originators: interactiveOriginators,
        })
      : await repository.findById(sessionId)
  if (summary !== undefined) return summary
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
