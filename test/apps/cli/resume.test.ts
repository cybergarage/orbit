// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type {InteractiveSessionOptions} from '../../../src/core/index.js'

import {runResumeSessionCommand} from '../../../src/apps/cli/resume.js'
import {Message, MessageType, SessionRepository} from '../../../src/core/index.js'

describe('resume command', () => {
  it('resumes an exact session with persisted context and closes it', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-resume-command-'))
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-resume-workspace-'))
    const repository = new SessionRepository({rootDir: root})
    const session = repository.create({
      cwd: workspace,
      id: 'session-1',
      model: 'persisted-model',
      originator: 'orbit-interactive',
      provider: 'openai',
      systemPrompt: 'Persisted instructions',
    })
    session.appendMessages([new Message(MessageType.User, {content: 'Earlier request'})])
    const file = session.getFile() as string
    await session.close()
    const calls: Array<Record<string, unknown>> = []

    const result = await runResumeSessionCommand(
      'session-1',
      {model: 'explicit-model'},
      {
        async contextLoader() {
          throw new Error('Persisted instructions should be reused.')
        },
        repository,
        async sessionRunner(options) {
          calls.push({
            cwd: options.cwd,
            messages: options.session?.getConversationMessages().map((message) => message.content),
            model: options.initialModel,
            provider: options.initialProvider,
            systemPrompt: options.systemPrompt,
          })
        },
        async settingsLoader(cwd) {
          expect(cwd).to.equal(workspace)
          return {model: 'workspace-model', provider: 'ollama'}
        },
        stdinIsTTY: true,
        stdoutIsTTY: true,
      },
    )

    expect(result).to.include({id: 'session-1'})
    expect(calls).to.deep.equal([
      {
        cwd: workspace,
        messages: ['Earlier request'],
        model: 'explicit-model',
        provider: 'openai',
        systemPrompt: 'Persisted instructions',
      },
    ])
    const reopened = repository.open(file)
    await reopened.close()
    await fs.rm(root, {force: true, recursive: true})
    await fs.rm(workspace, {force: true, recursive: true})
  })

  it('resumes the latest eligible session in the requested cwd or globally', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-resume-last-'))
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-resume-last-workspace-'))
    const otherWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-resume-last-other-'))
    const repository = new SessionRepository({rootDir: root})
    const local = repository.create({
      createdAt: '2026-08-22T00:00:00.000Z',
      cwd: workspace,
      id: 'local',
      originator: 'orbit-interactive',
    })
    await local.close()
    const global = repository.create({
      createdAt: '2026-08-23T00:00:00.000Z',
      cwd: otherWorkspace,
      id: 'global',
      originator: 'orbit-thread-manager',
    })
    await global.close()
    const resumedIds: string[] = []
    const deps = {
      contextLoader: async () => [],
      repository,
      async sessionRunner(options: InteractiveSessionOptions) {
        resumedIds.push(options.session?.getMetadata().id ?? '')
      },
      settingsLoader: async () => ({}),
      stdinIsTTY: true,
      stdoutIsTTY: true,
    }

    await runResumeSessionCommand(undefined, {cwd: workspace, last: true}, deps)
    await runResumeSessionCommand(undefined, {all: true, cwd: workspace, last: true}, deps)

    expect(resumedIds).to.deep.equal(['local', 'global'])
    await fs.rm(root, {force: true, recursive: true})
    await fs.rm(workspace, {force: true, recursive: true})
    await fs.rm(otherWorkspace, {force: true, recursive: true})
  })

  it('rejects ambiguous selections and missing sessions without creating one', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-resume-errors-'))
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-resume-errors-workspace-'))
    const repository = new SessionRepository({rootDir: root})
    const deps = {repository, stdinIsTTY: true, stdoutIsTTY: true}

    await expectRejected(runResumeSessionCommand(undefined, {}, deps), 'Pass a session ID or --last')
    await expectRejected(runResumeSessionCommand('session-1', {last: true}, deps), 'Pass either a session ID or --last')
    await expectRejected(runResumeSessionCommand('missing', {}, deps), 'Unknown session: missing')
    await expectRejected(
      runResumeSessionCommand(undefined, {cwd: workspace, last: true}, deps),
      `No saved interactive sessions found for ${workspace}.`,
    )
    expect((await repository.listPage()).data).to.deep.equal([])
    await fs.rm(root, {force: true, recursive: true})
    await fs.rm(workspace, {force: true, recursive: true})
  })
})

async function expectRejected(promise: Promise<unknown>, message: string): Promise<void> {
  try {
    await promise
    expect.fail('Expected command to reject.')
  } catch (error) {
    expect((error as Error).message).to.contain(message)
  }
}
