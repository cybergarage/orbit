// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {randomUUID} from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  Agent,
  AppleProjectMemoryAgent,
  createProjectMemorySearchTool,
  createProvider,
  MemoryProjectStore,
  MemorySessionLogStore,
  Message,
  MessageType,
  ProjectMemoryService,
  ProjectService,
  State,
} from '../../../src/core/index.js'
import {SessionRepository} from '../../session-storage-fixture.js'

describe('Apple native protocol through Core search authorization', () => {
  let root: string
  let store: MemoryProjectStore
  let memory: ProjectMemoryService
  let projects: ProjectService

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-apple-core-'))
    store = new MemoryProjectStore()
    const repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
    const host = {async closeThread() {}, getThread(): undefined {}}
    projects = new ProjectService(store, repository, host, root)
    memory = new ProjectMemoryService(projects, host)
  })

  afterEach(async () => {
    await memory.close()
    await store.close()
    await fs.rm(root, {force: true, recursive: true})
  })

  for (const changed of [false, true])
    it(
      changed
        ? 'refuses a binding changed after native request without feeding another Project'
        : 'dispatches only the registered read and returns the actual canonical result',
      async () => {
        const project = await projects.create({name: 'Synthetic original', operationId: randomUUID()})
        const other = await projects.create({name: 'Synthetic other', operationId: randomUUID()})
        await memory.create(project.id, {
          body: 'Use cobalt for catalog status.',
          operationId: randomUUID(),
          title: 'Catalog',
        })
        await memory.create(other.id, {
          body: 'PRIVATE_OTHER_PROJECT catalog.',
          operationId: randomUUID(),
          title: 'Catalog',
        })
        const b = await projects.createSession(project.id, randomUUID(), async () => ({formatVersion: 3}))
        const fed: string[] = []
        let nonce = ''
        let step = 0
        let closed = false
        const model = new AppleProjectMemoryAgent(createProvider('apple'), {
          channelFactory(initial) {
            expect(JSON.stringify(initial)).not.contains('cobalt').and.not.contains('PRIVATE_OTHER_PROJECT')
            nonce = initial.nonce as string
            return {
              close() {
                closed = true
              },
              async next() {
                step++
                if (step === 1) return {nonce, tool: 'project_memory_search', type: 'ready', version: 2}
                if (step === 2) {
                  if (changed) {
                    const membership = await projects.membership(b.getId())
                    await projects.changeMembership(b.getId(), {
                      expectedRevision: membership!.revision,
                      operationId: randomUUID(),
                      projectId: other.id,
                      sourceProjectId: project.id,
                    })
                  }

                  return {
                    id: 'native-call',
                    input: {limit: 1, query: 'catalog'},
                    name: 'project_memory_search',
                    nonce,
                    type: 'call',
                    version: 2,
                  }
                }

                return {nonce, text: 'Synthetic fixture answer', type: 'final', version: 2}
              },
              send(frame) {
                fed.push(frame.text as string)
              },
            }
          },
        })
        const agent = new Agent({
          cwd: root,
          deps: {createModel: () => model},
          logStore: new MemorySessionLogStore(),
          state: new State(b),
          toolDefinitions: [createProjectMemorySearchTool(memory, {projectId: project.id, sessionId: b.getId()})],
          toolProfile: 'none',
        })
        try {
          const run = await agent.startRun([new Message(MessageType.User, {content: 'Recall catalog status.'})], {
            requestId: randomUUID(),
          })
          const result = await run.finished
          if (changed) {
            expect(result.outcome).not.equals('completed')
            expect(fed).length(0)
          } else {
            expect(result.outcome).equals('completed')
            expect(fed).length(1)
            expect(fed[0]).contains('cobalt').and.not.contains('PRIVATE_OTHER_PROJECT')
          }

          expect(closed).equals(true)
        } finally {
          model.close()
          await agent.close()
          await b.close()
        }
      },
    )
})
