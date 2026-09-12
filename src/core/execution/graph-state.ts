// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {RunContext} from './run.js'

const visits = new WeakMap<RunContext, string>()
export function currentGraphVisit(run: RunContext): string | undefined {
  return visits.get(run)
}

export function enterGraphVisit(run: RunContext, id: string): void {
  run.check()
  if (visits.has(run)) throw new Error('Graph visit is already active')
  visits.set(run, id)
}

export function leaveGraphVisit(run: RunContext): void {
  visits.delete(run)
}

/** Internal failure disposition; cannot override real stop, failed recording or pending ownership. */
export class GraphDeclaredFailure extends Error {
  constructor() {
    super('graph-declared-failure')
  }
}
