// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {execFile} from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {promisify} from 'node:util'

import {Agent, MemorySessionLogStore, Message, MessageType, ToolProfile} from '../../../src/core/index.js'

describe('managed built-in read failures', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-read-failures-')))
    await fs.writeFile(path.join(root, 'sample.txt'), 'sample')
    await fs.writeFile(path.join(root, 'binary'), Buffer.from([0, 1]))
  })

  afterEach(async () => {
    await fs.rm(root, {force: true, recursive: true})
  })

  it('reports settled input and filesystem failures and continues the model', async () => {
    const requests = [
      ...['read', 'list', 'glob', 'grep'].map((name) => ({input: {path: 'missing', pattern: '*'}, name})),
      {input: {path: '.'}, name: 'read'},
      {input: {path: 'binary'}, name: 'read'},
      {input: {path: 'sample.txt'}, name: 'list'},
      {input: {path: 'sample.txt', pattern: '*'}, name: 'glob'},
      {input: {path: 'sample.txt', pattern: '['}, name: 'grep'},
    ]
    let calls = 0
    const store = new MemorySessionLogStore()
    const agent = new Agent({
      cwd: root,
      deps: {
        createModel: () => ({
          getModel: () => 'fixture',
          getName: () => 'model',
          getProvider: () => 'ollama',
          async invoke(messages) {
            if (++calls === 1)
              return new Message(MessageType.Assistant, {
                payload: {
                  toolCalls: requests.map((request, index) => ({...request, id: String(index)})),
                },
              })
            const results = messages.filter((message) => message.type === MessageType.Tool)
            expect(results).to.have.length(requests.length)
            for (const result of results) expect(result.payload).to.have.property('isError', true)
            return new Message(MessageType.Assistant, {content: 'Read failures reported.'})
          },
        }),
      },
      logStore: store,
      toolProfile: ToolProfile.Coding,
    })
    try {
      const result = await (
        await agent.startRun([new Message(MessageType.User, {content: 'Inspect fixture'})])
      ).finished
      expect(result.outcome).to.equal('completed')
      expect(result.quiescence).to.equal(true)
      expect(result.operations.map((operation) => operation.status)).to.deep.equal(requests.map(() => 'failed'))
      expect(calls).to.equal(2)
      expect(await fs.readFile(path.join(root, 'sample.txt'), 'utf8')).to.equal('sample')
    } finally {
      await agent.close()
      await store.close()
    }
  })

  for (const code of ['EACCES', 'EIO']) {
    it(`keeps ${code} distinct from arbitrary executor completion`, async () => {
      const fixture = fileURLToPath(new URL('fixtures/read-failure.mjs', import.meta.url))
      const {stdout} = await promisify(execFile)(process.execPath, [fixture, root, code], {timeout: 15_000})
      const result = JSON.parse(stdout)
      expect(result).to.include(
        code === 'EACCES'
          ? {calls: 2, closeIncomplete: false, outcome: 'completed', quiescence: true}
          : {calls: 1, closeIncomplete: true, outcome: 'incomplete', quiescence: false, reason: 'unknown-operation'},
      )
      expect(result.statuses).to.deep.equal([code === 'EACCES' ? 'failed' : 'unknown'])
    })
  }
})
