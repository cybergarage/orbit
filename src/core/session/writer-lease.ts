// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {SessionScope} from './coordination.js'

import {canonicalStoragePath} from './coordination.js'

export type SessionWriterLease = (() => void) & {readonly __writerLease: unique symbol}
const leases = new WeakMap<
  object,
  {consumed: boolean; live: () => void; release: () => void; released: boolean; scope: SessionScope}
>()
/** Internal factory: recorder authority is checked again when the built-in journal claims it. */
export function issueWriterLease(scope: SessionScope, live: () => void, release: () => void): SessionWriterLease {
  const state = {consumed: false, live, release, released: false, scope}
  const lease = (() => {
    if (state.consumed) throw new Error('Journal owns this lease until its I/O settles')
    if (!state.released) {
      state.released = true
      state.release()
    }
  }) as SessionWriterLease
  leases.set(lease, state)
  return Object.freeze(lease)
}

export function consumeWriterLease(lease: SessionWriterLease, sessionId: string, root: string): () => void {
  const state = leases.get(lease)
  if (
    !state ||
    state.released ||
    state.consumed ||
    state.scope.sessionId !== sessionId ||
    state.scope.journalRoot !== canonicalStoragePath(root)
  )
    throw new Error('Invalid, mismatched or already consumed session writer lease')
  state.live()
  state.consumed = true
  return () => {
    if (!state.released) {
      state.released = true
      state.release()
    }
  }
}
