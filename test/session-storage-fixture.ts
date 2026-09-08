// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {afterEach} from 'mocha'
import fs from 'node:fs/promises'

import type {FileExecutionJournalOptions} from '../src/core/execution/journal.js'
import type {SessionRepositoryOptions} from '../src/core/session/repository.js'

import {FileExecutionJournal} from '../src/core/execution/journal.js'
import {SessionRepository as Repository} from '../src/core/session/repository.js'

export const offlineStorage = {
  allWritersStopped: true,
  automaticRestartersDisabled: true,
  exclusiveStorageControl: true,
} as const
/** Test roots are isolated, have no daemon/restarter, and are exclusively controlled by each case. */
export class SessionRepository extends Repository {
  constructor(options: SessionRepositoryOptions = {}) {
    super(options)
    try {
      this.scope('fixture-registration')
    } catch {
      this.initializeStorage(offlineStorage)
    }
  }
}
const extraRoots = new Set<string>()
afterEach(async () => {
  await Promise.all([...extraRoots].map((root) => fs.rm(root, {force: true, recursive: true})))
  extraRoots.clear()
})
export async function openTestJournal(
  id: string,
  options: Omit<FileExecutionJournalOptions, 'lease'> & {releaseLease?: () => void},
): Promise<FileExecutionJournal> {
  const rootDir = options.root + '-transcripts'
  extraRoots.add(rootDir)
  const repository = new SessionRepository({journalRoot: options.root, rootDir})
  const summary = await repository.findById(id)
  const session = summary ? repository.open(summary.file) : repository.create({id})
  try {
    const journal = await FileExecutionJournal.open(id, {...options, lease: session.acquireWriterLease()})
    const close = journal.close.bind(journal)
    let pending: Promise<void> | undefined
    journal.close = () => {
      pending ??= close().finally(async () => {
        await session.close()
        options.releaseLease?.()
      })
      return pending
    }

    return journal
  } catch (error) {
    await session.close()
    options.releaseLease?.()
    throw error
  }
}
