// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable no-await-in-loop -- Denial must finish before testing approval of the same target. */

import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {access, mkdir, mkdtemp, readFile, rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {createHost, repositoryFor, waitForRun} from './host.js'

// Every effect and automatic test approval is confined to this new directory.
const root = await mkdtemp(path.join(os.tmpdir(), 'orbit-consumer-'))
const workspace = path.join(root, 'workspace')
const dataDir = path.join(root, 'data')
await mkdir(workspace)
repositoryFor(dataDir).initializeStorage({
  allWritersStopped: true,
  automaticRestartersDisabled: true,
  exclusiveStorageControl: true,
})
let host = await createHost({dataDir, demo: true, workspace})
try {
  const thread = host.service.createThread()
  const requestId = randomUUID()
  const first = await host.service.startRun(thread.id, 'hello', requestId)
  assert.equal(first.kind, 'run')
  if (first.kind !== 'run') throw new Error('Expected a run')
  assert.equal((await waitForRun(host.service, first.runId, async () => false)).outcome, 'completed')
  const retry = await host.service.startRun(thread.id, 'hello', requestId)
  assert.equal(retry.runId, first.runId)
  assert.match(host.service.getThread(thread.id)!.messages.at(-1)!.content, /Demo reply: hello/)
  assert.equal((await host.service.startRun(thread.id, '/help', randomUUID())).kind, 'command')

  for (const approve of [false, true]) {
    let prompts = 0
    const run = await host.service.startRun(thread.id, 'write-demo', randomUUID())
    if (run.kind !== 'run') throw new Error('Expected a run')
    const result = await waitForRun(host.service, run.runId, async () => {
      prompts++
      return approve
    })
    assert.equal(result.outcome, 'completed')
    assert.equal(prompts, 1)
    assert.ok(result.operations.some((operation) => operation.status === (approve ? 'succeeded' : 'denied')))
    if (!approve) await assert.rejects(access(path.join(workspace, 'demo-note.txt')))
  }

  assert.match(await readFile(path.join(workspace, 'demo-note.txt'), 'utf8'), /approved Orbit operation/)
  const waiting = await host.service.startRun(thread.id, 'wait-demo', randomUUID())
  if (waiting.kind !== 'run') throw new Error('Expected a run')
  const stopped = await waitForRun(
    host.service,
    waiting.runId,
    async () => false,
    (snapshot) => {
      if (snapshot.phase === 'running') host.service.cancelRun(waiting.runId)
    },
  )
  assert.equal(stopped.outcome, 'cancelled')
  assert.equal(stopped.quiescence, true)
  await host.close()
  host = await createHost({dataDir, demo: true, workspace})
  const resumed = await host.service.resumeSession(thread.id)
  assert.ok(resumed.messages.some((message) => message.content === 'hello'))
  const next = await host.service.startRun(thread.id, 'after restart', randomUUID())
  if (next.kind !== 'run') throw new Error('Expected a run')
  assert.equal((await waitForRun(host.service, next.runId, async () => false)).outcome, 'completed')
  assert.ok((await host.service.getSessionLogs(thread.id))?.data.length)
  console.log(
    'Consumer smoke passed: imports, runs, request retry, commands, approval/denial, cancellation, logs and restart/resume.',
  )
} finally {
  await host.close()
  await rm(root, {force: true, recursive: true})
}
