// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {FileExecutionJournal} from '../../../src/core/execution/journal.js'
import {coordinationPaths, inspectRestartRun, verifyRestartCommandApproval} from '../../../src/index.js'
import {SessionRepository} from '../../session-storage-fixture.js'

describe('Exact-run restart inspection', () => {
  let root: string
  let repository: SessionRepository

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-restart-inspection-'))
    repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
  })

  afterEach(async () => {
    await fs.rm(root, {force: true, recursive: true})
  })

  it('reports an interrupted operation on the exact run without changing its evidence or writer', async () => {
    const session = repository.create({id: 'chat'})
    const level = 'file-sync'
    const journal = await FileExecutionJournal.open('chat', {
      lease: session.acquireWriterLease(),
      level,
      root: repository.journalRoot,
    })
    try {
      const admit = {configuration: journal.digest({}), level, mode: 'file', requestId: 'request'}
      await journal.append('old-run', 'run-admitted', admit)
      await journal.append('old-run', 'operation-intent', {operationId: 'write-file'})
      await journal.append('later-run', 'run-admitted', {...admit, requestId: 'other'})
      const target = path.join(repository.journalRoot, 'chat', 'old-run', 'events.jsonl')
      const bytes = await fs.readFile(target)
      const scope = new SessionRepository({rootDir: repository.rootDir}).scope('chat')
      const expected = {
        journal: 'open',
        pairId: scope.pairId,
        runId: 'old-run',
        sessionId: 'chat',
        unresolvedOperationIds: ['write-file'],
        writerRetained: true,
      }
      expect(inspectRestartRun(scope, 'old-run')).deep.equals(expected)
      expect(inspectRestartRun(scope, 'old-run')).deep.equals(expected)
      expect(inspectRestartRun(scope, 'absent')).includes({journal: 'missing', writerRetained: true})
      expect(await fs.readFile(target)).deep.equals(bytes)
    } finally {
      await journal.close()
      await session.close()
    }
  })

  it('binds a pending command to its original explicit approval without writing evidence', async () => {
    const session = repository.create({id: 'chat'})
    const level = 'file-sync'
    const journal = await FileExecutionJournal.open('chat', {
      lease: session.acquireWriterLease(),
      level,
      root: repository.journalRoot,
    })
    try {
      const digest = journal.digest({example: 'approved-command'})
      const scope = repository.scope('chat')
      const binding = {
        approvalId: 'approval',
        digest,
        operationId: 'op',
        pairId: scope.pairId,
        runId: 'valid',
        sessionId: 'chat',
      }
      const request = {
        digest,
        expiresAt: Date.now() + 86_400_000,
        operationId: 'op',
        policy: 'policy',
        requestId: 'approval',
        responderScope: 'host',
      }
      const response = {digest, operationId: 'op', policy: 'policy', requestId: 'approval', responderScope: 'host'}
      const intent = {authorization: 'approval', digest, effect: 'command', operationId: 'op', variant: 'tool-call'}
      async function write(runId: string, variant = runId) {
        await journal.append(runId, 'run-admitted', {level, mode: 'file', requestId: 'request'})
        await journal.append(runId, 'run-ready', {})
        if (variant !== 'automatic')
          await journal.append(
            runId,
            'approval-requested',
            variant === 'expired' ? {...request, expiresAt: 0} : request,
          )
        if (variant === 'late') await journal.append(runId, 'operation-intent', intent)
        await journal.append(
          runId,
          'authorization-decided',
          variant === 'automatic' ? {...response, decision: 'allow'} : {...response, approve: variant !== 'denied'},
        )
        if (variant === 'duplicate') await journal.append(runId, 'authorization-decided', {...response, approve: false})
        if (variant !== 'late')
          await journal.append(
            runId,
            'operation-intent',
            variant === 'write'
              ? {...intent, effect: 'write'}
              : variant === 'wrong-intent'
                ? {...intent, authorization: 'different'}
                : intent,
          )
        if (variant === 'settled' || variant === 'unknown')
          await journal.append(runId, 'operation-result', {
            operationId: 'op',
            status: variant === 'unknown' ? 'unknown' : 'succeeded',
          })
        if (variant === 'unknown') await journal.append(runId, 'run-terminal', {outcome: 'incomplete'})
        if (variant === 'multiple') await journal.append(runId, 'operation-intent', {...intent, operationId: 'other'})
      }

      await write('valid')
      const file = path.join(repository.journalRoot, 'chat', 'valid', 'events.jsonl')
      const owner = await fs.readFile(coordinationPaths(scope).owner)
      const bytes = await fs.readFile(file)
      expect(verifyRestartCommandApproval(scope, binding)).equals('matched')
      expect(verifyRestartCommandApproval(scope, binding)).equals('matched')
      expect(await fs.readFile(file)).deep.equals(bytes)
      expect(await fs.readFile(coordinationPaths(scope).owner)).deep.equals(owner)
      for (const mismatch of [
        {approvalId: 'wrong'},
        {digest: 'a'.repeat(64)},
        {operationId: 'wrong'},
        {pairId: 'wrong'},
        {runId: '../valid'},
        {runId: 'missing'},
        {sessionId: 'wrong'},
      ])
        expect(verifyRestartCommandApproval(scope, {...binding, ...mismatch})).equals('unverified')
      for (const runId of [
        'automatic',
        'denied',
        'duplicate',
        'expired',
        'late',
        'multiple',
        'settled',
        'write',
        'wrong-intent',
      ]) {
        // eslint-disable-next-line no-await-in-loop -- The fixture shares one journal writer.
        await write(runId)
        expect(verifyRestartCommandApproval(scope, {...binding, runId}), runId).equals('unverified')
      }

      await write('unknown')
      expect(verifyRestartCommandApproval(scope, {...binding, runId: 'unknown'})).equals('matched')
      await fs.appendFile(file, '{')
      expect(verifyRestartCommandApproval(scope, binding)).equals('unverified')
      await journal.close()
      await session.close()
      expect(verifyRestartCommandApproval(scope, {...binding, runId: 'unknown'})).equals('unverified')
    } finally {
      await journal.close()
      await session.close()
    }
  })

  it('preserves unknown original evidence even if a settlement record follows', async () => {
    const session = repository.create({id: 'chat'})
    const journal = await FileExecutionJournal.open('chat', {
      lease: session.acquireWriterLease(),
      level: 'file-sync',
      root: repository.journalRoot,
    })
    try {
      await journal.append('run', 'run-admitted', {level: 'file-sync', mode: 'file', requestId: 'request'})
      await journal.append('run', 'operation-intent', {operationId: 'command'})
      await journal.append('run', 'operation-result', {operationId: 'command', status: 'unknown'})
      await journal.append('run', 'run-terminal', {outcome: 'incomplete'})
      await journal.append('run', 'late-settlement', {
        operations: [{id: 'command', status: 'succeeded'}],
        settled: true,
      })
    } finally {
      await journal.close()
      await session.close()
    }

    const result = inspectRestartRun(repository.scope('chat'), 'run')
    expect(result).includes({journal: 'terminal-recorded', writerRetained: false})
    expect(result.unresolvedOperationIds).deep.equals(['command'])
  })

  it('does not use a torn prefix, aliased file, or another scope as evidence', async () => {
    const session = repository.create({id: 'chat'})
    const journal = await FileExecutionJournal.open('chat', {
      lease: session.acquireWriterLease(),
      level: 'file-sync',
      root: repository.journalRoot,
    })
    await journal.append('run', 'run-admitted', {level: 'file-sync', mode: 'file', requestId: 'request'})
    await journal.close()
    await session.close()
    const directory = path.join(repository.journalRoot, 'chat', 'run')
    const file = path.join(directory, 'events.jsonl')
    const scope = repository.scope('chat')
    const alias = path.join(directory, 'alias')
    await fs.link(file, alias)
    expect(inspectRestartRun(scope, 'run').journal).equals('unverified')
    await fs.unlink(alias)
    await fs.appendFile(file, '{"partial":')
    const torn = await fs.readFile(file)
    expect(inspectRestartRun(scope, 'run').journal).equals('unverified')
    expect(await fs.readFile(file)).deep.equals(torn)
    expect(inspectRestartRun(repository.scope('another-chat'), 'run').journal).equals('missing')
    expect(() => inspectRestartRun({...scope}, 'run')).throws('validated SessionRepository scope')
    expect(() => inspectRestartRun(scope, '../run')).throws('Invalid session identity')
  })
})
