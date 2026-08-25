// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {runSessionInformationCommand} from '../../../src/apps/cli/session.js'
import {Message, MessageType, Role, SessionRepository} from '../../../src/core/index.js'

describe('session information command', () => {
  it('prints an exact saved summary without changing or locking the transcript', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-session-information-'))
    const repository = new SessionRepository({rootDir: root})
    const session = repository.create({
      createdAt: '2026-08-25T01:02:03.000Z',
      cwd: root,
      id: 'session-1',
      model: 'gpt-5',
      originator: 'orbit-interactive',
      provider: 'openai',
    })
    session.appendMessages([new Message(MessageType.User, {content: 'Debug this session', role: Role.User})])
    const file = session.getFile() as string
    await session.close()
    const before = await fs.readFile(file, 'utf8')
    const beforeStat = await fs.stat(file)
    let output = ''

    const summary = await runSessionInformationCommand(
      'session-1',
      {},
      {
        repository,
        write(value) {
          output += value
        },
      },
    )

    expect(summary).to.include({id: 'session-1', model: 'gpt-5', provider: 'openai', status: 'interrupted'})
    expect(output).to.include('Session ID: session-1')
    expect(output).to.include(`Working directory: ${root}`)
    expect(output).to.include(`Transcript file: ${file}`)
    expect(output).to.include('Preview: Debug this session')
    expect(await fs.readFile(file, 'utf8')).to.equal(before)
    expect((await fs.stat(file)).mtimeMs).to.equal(beforeStat.mtimeMs)
    const reopened = repository.open(file)
    await reopened.close()
    await fs.rm(root, {force: true, recursive: true})
  })

  it('prints stable JSON without transcript contents or session secrets', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-session-json-'))
    const repository = new SessionRepository({rootDir: root})
    const session = repository.create({
      cwd: root,
      id: 'json-session',
      originator: 'orbit-interactive',
      systemPrompt: 'private workspace instructions',
    })
    session.appendMessages([new Message(MessageType.Assistant, {content: 'private assistant output'})])
    await session.close()
    let output = ''

    await runSessionInformationCommand(
      'json-session',
      {json: true},
      {
        repository,
        write(value) {
          output += value
        },
      },
    )

    const parsed = JSON.parse(output) as Record<string, unknown>
    expect(parsed).to.include({cwd: root, id: 'json-session', originator: 'orbit-interactive'})
    expect(parsed).to.have.all.keys('createdAt', 'cwd', 'file', 'id', 'originator', 'status', 'updatedAt')
    expect(output).not.to.include('private workspace instructions')
    expect(output).not.to.include('private assistant output')
    await fs.rm(root, {force: true, recursive: true})
  })

  it('prints only the selected local or global latest session ID', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-session-id-only-'))
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-session-id-workspace-'))
    const otherWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-session-id-other-'))
    const repository = new SessionRepository({rootDir: root})
    const local = repository.create({
      createdAt: '2026-08-24T00:00:00.000Z',
      cwd: workspace,
      id: 'local',
      originator: 'orbit-interactive',
    })
    await local.close()
    const global = repository.create({
      createdAt: '2026-08-25T00:00:00.000Z',
      cwd: otherWorkspace,
      id: 'global',
      originator: 'orbit-thread-manager',
    })
    await global.close()
    const outputs: string[] = []
    const deps = {repository, write: (value: string) => outputs.push(value)}

    await runSessionInformationCommand(undefined, {cwd: workspace, idOnly: true, last: true}, deps)
    await runSessionInformationCommand(undefined, {all: true, cwd: workspace, idOnly: true, last: true}, deps)

    expect(outputs).to.deep.equal(['local\n', 'global\n'])
    await fs.rm(root, {force: true, recursive: true})
    await fs.rm(workspace, {force: true, recursive: true})
    await fs.rm(otherWorkspace, {force: true, recursive: true})
  })

  it('rejects ambiguous output and session selections', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-session-information-errors-'))
    const repository = new SessionRepository({rootDir: root})

    await expectRejected(
      runSessionInformationCommand('session-1', {idOnly: true, json: true}, {repository}),
      'Pass either --id-only or --json, not both.',
    )
    await expectRejected(runSessionInformationCommand(undefined, {}, {repository}), 'Pass a session ID or --last.')
    await expectRejected(
      runSessionInformationCommand('session-1', {last: true}, {repository}),
      'Pass either a session ID or --last, not both.',
    )
    await expectRejected(runSessionInformationCommand('missing', {}, {repository}), 'Unknown session: missing')
    await fs.rm(root, {force: true, recursive: true})
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
