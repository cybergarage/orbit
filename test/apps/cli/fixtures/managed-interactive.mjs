// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

// Build first, then run this fixture in a real terminal. Type edit, answer y/n
// or Ctrl+C at the preview, then /exit. No provider or user session is accessed.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  Agent,
  MemorySessionLogStore,
  Message,
  MessageType,
  SessionRepository,
  StoreSessionLoggerFactory,
} from '../../../../dist/core/index.js'
import {runInteractiveSession} from '../../../../dist/core/interactive.js'
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-ink-fixture-'))
const repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
repository.initializeStorage({
  allWritersStopped: true,
  automaticRestartersDisabled: true,
  exclusiveStorageControl: true,
})
const store = new MemorySessionLogStore()
const results = []
let calls = 0
class FixtureAgent extends Agent {
  constructor(options = {}) {
    super({
      ...options,
      deps: {
        createModel: () => ({
          getModel: () => 'fixture',
          getName: () => 'model',
          getProvider: () => 'ollama',
          async invoke() {
            return ++calls % 2 === 1
              ? new Message(MessageType.Assistant, {
                  payload: {
                    toolCalls: [{id: 'write', input: {content: 'approved once', path: 'answer.txt'}, name: 'write'}],
                  },
                })
              : new Message(MessageType.Assistant, {content: 'Fixture response finished.'})
          },
        }),
      },
      logStore: store,
    })
  }

  async startRun(...args) {
    const handle = await super.startRun(...args)
    handle.finished.then((result) => results.push(result))
    return handle
  }
}
try {
  await runInteractiveSession({
    agentClass: FixtureAgent,
    cwd: root,
    initialModel: 'fixture',
    initialProvider: 'ollama',
    journalLevel: 'file-sync',
    logger: new StoreSessionLoggerFactory(store).forApplication(),
    sessionRepository: repository,
  })
  console.log(
    'FIXTURE_RESULT ' +
      JSON.stringify({
        calls,
        content: await fs.readFile(path.join(root, 'answer.txt'), 'utf8').catch(() => null),
        results: results.map(({outcome, quiescence, recording}) => ({outcome, quiescence, recording})),
      }),
  )
} finally {
  await store.close()
  await fs.rm(root, {force: true, recursive: true})
}
