// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {spawn} from 'node:child_process'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type {Model} from '../../src/core/index.js'

import {
  Agent,
  Message,
  MessageType,
  ModelAbortError,
  OperatorType,
  parseSessionFile,
  Role,
  SessionContextBuilder,
  SessionEntryType,
  SessionRepository,
  State,
  TurnPhase,
} from '../../src/core/index.js'

describe('session persistence', () => {
  let root = ''

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-sessions-'))
  })

  afterEach(async () => {
    await fs.rm(root, {force: true, recursive: true})
  })

  it('writes a versioned JSONL session with ordered turn and message entries', async () => {
    const repository = new SessionRepository({rootDir: root})
    const session = repository.create({
      createdAt: '2026-08-22T01:02:03.004Z',
      cwd: '/work/orbit',
      id: 'session-1',
      model: 'gpt-test',
      originator: 'test',
      provider: 'openai',
      systemPrompt: 'Test instructions',
    })
    session.recordTurnContext({
      cwd: '/work/orbit',
      maxToolIterations: 5,
      model: 'gpt-test',
      provider: 'openai',
      turnId: 'turn-1',
    })
    session.recordTurnEvent({phase: TurnPhase.Started, turnId: 'turn-1'})
    const [user, assistant] = session.appendMessages(
      [new Message(MessageType.User, {content: 'hello'}), new Message(MessageType.Assistant, {content: 'hi'})],
      {iteration: 0, turnId: 'turn-1'},
    )
    session.recordTurnEvent({phase: TurnPhase.Completed, turnId: 'turn-1'})
    await session.close()

    const file = session.getFile()
    expect(file).to.equal(path.join(root, '2026', '08', '22', 'session-2026-08-22T01-02-03-004Z-session-1.jsonl'))
    const raw = await fs.readFile(file as string, 'utf8')
    expect(raw.endsWith('\n')).to.equal(true)
    const parsed = parseSessionFile(raw, file as string)

    expect(parsed.recovered).to.equal(false)
    expect(parsed.header).to.include({
      cwd: '/work/orbit',
      id: 'session-1',
      model: 'gpt-test',
      originator: 'test',
      provider: 'openai',
      systemPrompt: 'Test instructions',
      type: SessionEntryType.Session,
      version: 1,
    })
    expect(parsed.entries.map((entry) => entry.type)).to.deep.equal([
      SessionEntryType.Session,
      SessionEntryType.TurnContext,
      SessionEntryType.TurnEvent,
      SessionEntryType.Message,
      SessionEntryType.Message,
      SessionEntryType.TurnEvent,
    ])
    expect(user.parentid).to.equal(parsed.header.rootMessageId)
    expect(assistant.parentid).to.equal(user.id)
    if (process.platform !== 'win32') {
      expect(fsSync.statSync(file as string).mode % 0o1000).to.equal(0o600)
    }
  })

  it('resumes a session without changing message identity', async () => {
    const repository = new SessionRepository({rootDir: root})
    const session = repository.create({id: 'session-1'})
    const [original] = session.appendMessages([new Message(MessageType.User, {content: 'first', role: Role.User})])
    const file = session.getFile() as string
    await session.close()

    const resumed = repository.open(file)
    const loaded = resumed.getConversationMessages()[0]
    expect(loaded).to.deep.equal(original)
    const [next] = resumed.appendMessages([new Message(MessageType.Assistant, {content: 'second'})])
    expect(next.parentid).to.equal(original.id)
    await resumed.close()

    const reopened = repository.open(file)
    expect(reopened.getConversationMessages().map((message) => message.content)).to.deep.equal(['first', 'second'])
    await reopened.close()
  })

  it('projects copied provider-neutral messages from canonical session history', () => {
    const session = new State().getSession()
    const [stored] = session.appendMessages([new Message(MessageType.User, {content: 'hello'})])

    const context = new SessionContextBuilder().build(session)

    expect(context.messages).to.deep.equal([stored])
    expect(context.messages[0]).not.to.equal(stored)
    expect(context.messages[0].contents).not.to.equal(stored.contents)
  })

  it('records turn metadata before appending new input messages', async () => {
    const session = new State().getSession()
    const agent = new Agent({
      deps: {createModel: () => testModel(async () => new Message(MessageType.Assistant, {content: 'response'}))},
      state: new State(session),
    })

    await agent.invoke([new Message(MessageType.User, {content: 'prompt'})], {turnId: 'turn-1'})

    expect(session.getEntries().map((entry) => entry.type)).to.deep.equal([
      SessionEntryType.TurnContext,
      SessionEntryType.TurnEvent,
      SessionEntryType.Message,
      SessionEntryType.Message,
      SessionEntryType.TurnEvent,
    ])
    expect(session.getConversationMessages().map((message) => message.content)).to.deep.equal(['prompt', 'response'])
    await agent.close()
  })

  it('prevents two writers from opening the same session in one process', async () => {
    const repository = new SessionRepository({rootDir: root})
    const session = repository.create({id: 'session-1'})
    const file = session.getFile() as string

    expect(() => repository.open(file)).to.throw('Session file is already open for writing')
    await session.close()

    const resumed = repository.open(file)
    await resumed.close()
  })

  it('repairs one malformed unterminated final line before resuming', async () => {
    const repository = new SessionRepository({rootDir: root})
    const session = repository.create({id: 'session-1'})
    session.appendMessages([new Message(MessageType.User, {content: 'first'})])
    const file = session.getFile() as string
    await session.close()
    await fs.appendFile(file, '{"type":')

    const resumed = repository.open(file)
    resumed.appendMessages([new Message(MessageType.Assistant, {content: 'second'})])
    await resumed.close()

    const parsed = parseSessionFile(await fs.readFile(file, 'utf8'), file)
    expect(parsed.recovered).to.equal(false)
    expect(parsed.entries.filter((entry) => entry.type === SessionEntryType.Message)).to.have.length(2)
  })

  it('rejects malformed JSON before the final line', async () => {
    const repository = new SessionRepository({rootDir: root})
    const session = repository.create({id: 'session-1'})
    const file = session.getFile() as string
    await session.close()
    await fs.appendFile(file, 'not-json\n{"type":"turn_event"}')

    expect(() => repository.open(file)).to.throw(`Invalid session file ${file} at line 2`)
  })

  it('rejects values that cannot be represented safely as JSON', async () => {
    const repository = new SessionRepository({rootDir: root})
    const session = repository.create({id: 'session-1'})

    expect(() =>
      session.appendMessages([
        new Message(MessageType.Tool, {
          payload: {value: 1n},
        }),
      ]),
    ).to.throw('contains unsupported bigint data')
    await session.close()
  })

  it('rejects duplicate ids before appending any part of a batch', async () => {
    const repository = new SessionRepository({rootDir: root})
    const session = repository.create({id: 'session-1'})
    const duplicate = new Message(MessageType.User, {content: 'duplicate'})

    expect(() => session.appendMessages([duplicate, duplicate])).to.throw('Message already exists in session')
    expect(session.getConversationMessages()).to.deep.equal([])
    await session.close()
  })

  it('lists newest sessions with their terminal status', async () => {
    const repository = new SessionRepository({rootDir: root})
    const older = repository.create({createdAt: '2026-08-21T00:00:00.000Z', id: 'older'})
    older.recordTurnEvent({
      error: {message: 'failed', name: 'Error'},
      phase: TurnPhase.Failed,
      turnId: 'turn-old',
    })
    await older.close()
    const newer = repository.create({createdAt: '2026-08-22T00:00:00.000Z', id: 'newer'})
    newer.recordTurnEvent({phase: TurnPhase.Completed, turnId: 'turn-new'})
    await newer.close()

    expect(repository.list().map((summary) => ({id: summary.id, status: summary.status}))).to.deep.equal([
      {id: 'newer', status: 'completed'},
      {id: 'older', status: 'failed'},
    ])
  })

  it('lists paginated session previews while isolating corrupt files', async () => {
    const repository = new SessionRepository({rootDir: root})
    const first = repository.create({createdAt: '2026-08-21T00:00:00.000Z', id: 'first'})
    first.appendMessages([new Message(MessageType.User, {content: 'First prompt'})])
    await first.close()
    const second = repository.create({createdAt: '2026-08-22T00:00:00.000Z', id: 'second'})
    second.appendMessages([new Message(MessageType.User, {content: 'Second prompt'})])
    await second.close()
    const corruptFile = path.join(root, 'broken.jsonl')
    await fs.writeFile(corruptFile, 'not-json\n')

    const firstPage = await repository.listPage({limit: 1})
    const secondPage = await repository.listPage({cursor: firstPage.nextCursor, limit: 1})
    const summaries = [...firstPage.data, ...secondPage.data]

    expect(summaries.map((summary) => summary.id)).to.have.members(['first', 'second'])
    expect(summaries.find((summary) => summary.id === 'first')?.preview).to.equal('First prompt')
    expect(summaries.find((summary) => summary.id === 'second')?.preview).to.equal('Second prompt')
    expect(firstPage.nextCursor).to.equal('1')
    expect(secondPage.nextCursor).to.equal(undefined)
    expect(firstPage.errors).to.have.length(1)
    expect(firstPage.errors[0].file).to.equal(corruptFile)
    expect(firstPage.errors[0].message).to.contain(`Invalid session file ${corruptFile} at line 1`)
  })

  it('finds the most recently updated eligible session', async () => {
    const repository = new SessionRepository({rootDir: root})
    const workspace = path.join(root, 'workspace')
    const otherWorkspace = path.join(root, 'other-workspace')
    const globalCreatedAt = new Date(Date.now() + 60_000).toISOString()
    const older = repository.create({
      createdAt: '2026-08-20T00:00:00.000Z',
      cwd: workspace,
      id: 'older-but-updated',
      originator: 'orbit-interactive',
    })
    older.appendMessages([
      new Message(MessageType.User, {content: 'updated later', timestamp: '2026-08-23T00:00:00.000Z'}),
    ])
    await older.close()
    const newer = repository.create({
      createdAt: '2026-08-22T00:00:00.000Z',
      cwd: workspace,
      id: 'newer',
      originator: 'orbit-interactive',
    })
    await newer.close()
    const gui = repository.create({
      createdAt: globalCreatedAt,
      cwd: otherWorkspace,
      id: 'gui',
      originator: 'orbit-thread-manager',
    })
    await gui.close()

    expect(
      await repository.findLatest({cwd: workspace, originators: ['orbit-interactive', 'orbit-thread-manager']}),
    ).to.include({id: 'older-but-updated'})
    expect(await repository.findLatest({originators: ['orbit-interactive', 'orbit-thread-manager']})).to.include({
      id: 'gui',
    })
    expect(await repository.findLatest({cwd: workspace, originators: ['other']})).to.equal(undefined)
  })

  it('honors process lock files and recovers a stale owner', async () => {
    const repository = new SessionRepository({rootDir: root})
    const session = repository.create({id: 'locked-session'})
    const file = session.getFile() as string
    const lockFile = `${file}.lock`
    await session.close()
    await fs.writeFile(lockFile, `${JSON.stringify({pid: process.pid, token: 'external'})}\n`)

    expect(() => repository.open(file)).to.throw('Session file is already open for writing')
    const stalePid = await exitedProcessId()
    await fs.writeFile(lockFile, `${JSON.stringify({pid: stalePid, token: 'stale'})}\n`)

    const resumed = repository.open(file)
    await resumed.close()
    expect(fsSync.existsSync(lockFile)).to.equal(false)
  })

  it('finds and permanently deletes a saved session by id', async () => {
    const repository = new SessionRepository({rootDir: root})
    const session = repository.create({id: 'session-to-delete'})
    session.appendMessages([new Message(MessageType.User, {content: 'Delete me'})])
    const file = session.getFile() as string
    await session.close()

    expect(await repository.findById('session-to-delete')).to.include({file, id: 'session-to-delete'})
    expect(await repository.delete('session-to-delete')).to.include({file, id: 'session-to-delete'})
    expect(await repository.findById('session-to-delete')).to.equal(undefined)
    expect(fsSync.existsSync(file)).to.equal(false)
    expect(await repository.delete('session-to-delete')).to.equal(undefined)
  })

  it('refuses to delete a session that is open for writing', async () => {
    const repository = new SessionRepository({rootDir: root})
    const session = repository.create({id: 'open-session'})

    try {
      await repository.delete('open-session')
      throw new Error('Expected deletion to fail for an open session.')
    } catch (error) {
      expect((error as Error).message).to.equal('Session is open for writing: open-session')
    }

    await session.close()
    expect(await repository.delete('open-session')).to.include({id: 'open-session'})
  })

  it('records failed and pre-cancelled agent turns', async () => {
    const repository = new SessionRepository({rootDir: root})
    const failedSession = repository.create({id: 'failed'})
    const failedAgent = new Agent({
      deps: {
        createModel: () =>
          testModel(async () => {
            throw new Error('model failed')
          }),
      },
      state: new State(failedSession),
    })

    try {
      await failedAgent.invoke([new Message(MessageType.User, {content: 'fail'})])
      expect.fail('Expected the model invocation to fail.')
    } catch (error) {
      expect((error as Error).message).to.equal('model failed')
    }

    expect(
      failedSession
        .getEntries()
        .filter((entry) => entry.type === SessionEntryType.TurnEvent)
        .map((entry) => entry.phase),
    ).to.deep.equal([TurnPhase.Started, TurnPhase.Failed])
    await failedAgent.close()
    await failedSession.close()

    const cancelledSession = repository.create({id: 'cancelled'})
    let modelCalls = 0
    const cancelledAgent = new Agent({
      deps: {
        createModel: () =>
          testModel(async () => {
            modelCalls += 1
            return new Message(MessageType.Assistant, {content: 'unexpected'})
          }),
      },
      state: new State(cancelledSession),
    })
    const controller = new AbortController()
    controller.abort('cancelled before invoke')

    try {
      await cancelledAgent.invoke([new Message(MessageType.User, {content: 'cancel'})], {signal: controller.signal})
      expect.fail('Expected the model invocation to be cancelled.')
    } catch (error) {
      expect(error).to.be.instanceOf(ModelAbortError)
    }

    expect(modelCalls).to.equal(0)
    expect(cancelledSession.getConversationMessages().map((message) => message.content)).to.deep.equal(['cancel'])
    expect(
      cancelledSession
        .getEntries()
        .filter((entry) => entry.type === SessionEntryType.TurnEvent)
        .map((entry) => entry.phase),
    ).to.deep.equal([TurnPhase.Started, TurnPhase.Cancelled])
    await cancelledAgent.close()
    await cancelledSession.close()
  })
})

function testModel(invoke: Model['invoke']): Model {
  return {
    getModel() {
      return 'test-model'
    },
    getName() {
      return OperatorType.Model
    },
    getProvider() {
      return 'ollama'
    },
    invoke,
  }
}

async function exitedProcessId(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''])
  const {pid} = child
  if (pid === undefined) throw new Error('Failed to start a child process.')
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', () => resolve())
  })
  return pid
}
