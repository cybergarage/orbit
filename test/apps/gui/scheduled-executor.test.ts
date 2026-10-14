// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {randomUUID} from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type {RuntimeSnapshot} from '../../../src/core/application.js'
import type {Model, ModelInvokeOptions} from '../../../src/core/models/model.js'

import {LocalScheduler} from '../../../src/apps/gui/local-scheduler.js'
import {scheduledExecutor} from '../../../src/apps/gui/scheduled-executor.js'
import {Agent} from '../../../src/core/agent.js'
import {DurableWorkStore} from '../../../src/core/execution/scheduled-work.js'
import {Message, MessageType} from '../../../src/core/message/message.js'
import {SessionRepository} from '../../session-storage-fixture.js'

describe('scheduled agent execution with a synthetic model', () => {
  it('passes host cancellation to the actual managed agent and waits for synthetic model settlement', async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-scheduled-cancel-fixture-')))
    const repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
    const runtime: RuntimeSnapshot = {
      contexts: [],
      cwd: root,
      model: 'synthetic',
      provider: 'ollama',
      sessionRoot: repository.rootDir,
      settingsSources: [],
      version: 'test',
    }
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    let observedAbort = false
    const execute = scheduledExecutor(
      runtime,
      path.join(root, 'logs'),
      repository,
      (options) =>
        new Agent({
          ...options,
          deps: {
            ...options.deps,
            createModel: (): Model => ({
              getModel: () => 'synthetic',
              getName: () => 'model',
              getProvider: () => 'ollama',
              async invoke(_messages: Message[], invocation?: Partial<ModelInvokeOptions>) {
                entered()
                await new Promise<void>((resolve) => {
                  const abort = () => {
                    observedAbort = true
                    resolve()
                  }

                  if (invocation?.signal?.aborted) abort()
                  else invocation?.signal?.addEventListener('abort', abort, {once: true})
                })
                throw new Error('Synthetic model acknowledged cancellation')
              },
            }),
          },
        }),
    )
    const scheduler = new LocalScheduler(new DurableWorkStore(path.join(root, 'work.json')), execute)
    try {
      await scheduler.create({
        next: 1000,
        operationId: randomUUID(),
        task: {
          instructions: 'Synthetic model only',
          name: 'Synthetic cancellation',
          permissions: 'workspace-read',
          version: 1,
          workspace: root,
        },
      })
      const running = scheduler.tick(1000)
      await started
      const run = scheduler.snapshot().runs[0]
      scheduler.cancel(run.id)
      await running
      expect(observedAbort).equal(true)
      expect(scheduler.snapshot().runs[0].status).equal('cancelled')
      expect(await repository.findById(run.requestId)).not.equal(undefined)
    } finally {
      await scheduler.close()
      await fs.rm(root, {force: true, recursive: true})
    }
  })

  it('keeps the real managed journal, excludes unsafe tools and ignores inherited MCP startup', async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-scheduled-agent-fixture-')))
    const repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
    const requestId = randomUUID()
    const runtime: RuntimeSnapshot = {
      contexts: [],
      cwd: root,
      model: 'synthetic',
      provider: 'ollama',
      sessionRoot: repository.rootDir,
      settingsSources: [],
      version: 'test',
    }
    await fs.mkdir(path.join(root, '.orbit'))
    await fs.writeFile(
      path.join(root, '.orbit', 'settings.json'),
      JSON.stringify({
        mcp: {servers: {forbidden: {command: 'must-never-execute'}}},
        tools: {include: ['bash', 'write', 'edit'], profile: 'coding'},
      }),
    )
    let tools: string[] = []
    const execute = scheduledExecutor(
      runtime,
      path.join(root, 'logs'),
      repository,
      (options) =>
        new Agent({
          ...options,
          deps: {
            ...options.deps,
            createModel: (): Model => ({
              getModel: () => 'synthetic',
              getName: () => 'model',
              getProvider: () => 'ollama',
              async invoke(_messages: Message[], invocation?: Partial<ModelInvokeOptions>) {
                tools = invocation?.tools?.map((tool) => tool.name) ?? []
                return new Message(MessageType.Assistant, {content: 'Synthetic completion; no tools invoked'})
              },
            }),
          },
        }),
    )
    try {
      const result = await execute(
        {
          instructions: 'Synthetic request',
          name: 'Synthetic',
          permissions: 'workspace-read',
          version: 1,
          workspace: root,
        },
        requestId,
        new AbortController().signal,
      )
      expect(result.status).equal('succeeded')
      expect(tools.sort()).deep.equal(['glob', 'grep', 'list', 'read'])
      expect(await repository.findById(requestId)).not.equal(undefined)
      expect((await fs.readdir(repository.journalRoot)).length).greaterThan(0)
    } finally {
      await fs.rm(root, {force: true, recursive: true})
    }
  })
})
