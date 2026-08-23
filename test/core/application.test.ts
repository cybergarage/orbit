// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type {AgentOptions, DiagnosticEvent, ThreadAgentFactory} from '../../src/core/index.js'

import {
  createNoopLogger,
  DiagnosticCapture,
  guiSlashCommandHelpMessage,
  Message,
  MessageType,
  OrbitApplicationService,
  SessionRepository,
} from '../../src/core/index.js'

describe('OrbitApplicationService', () => {
  it('creates durable threads, starts runs, and projects diagnostics', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-application-'))
    const repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
    const agentOptions: AgentOptions[] = []
    const service = new OrbitApplicationService({
      contexts: [{content: 'Project guidance', source: {file: path.join(root, 'AGENTS.md'), kind: 'compat'}}],
      createAgent: createAgentFactory(agentOptions),
      cwd: root,
      model: 'test-model',
      provider: 'openai',
      repository,
      settings: {},
      settingsSources: [],
      version: '1.2.3',
    })

    try {
      const thread = service.createThread()
      const completed = waitForEvent(service, 'run.completed')
      const run = service.startRun(thread.id, 'Hello GUI')

      expect(run.threadId).to.equal(thread.id)
      expect(run.runId).to.be.a('string').and.not.empty
      await completed
      const snapshot = service.getThread(thread.id)
      expect(snapshot?.messages.map((message) => message.content)).to.deep.equal(['Hello GUI', 'mock response'])
      expect(snapshot).to.include({cwd: root, model: 'test-model', provider: 'openai', status: 'idle'})
      expect(service.runtime.version).to.equal('1.2.3')
      expect(service.getEvents().map((event) => event.type)).to.include.members([
        'app.started',
        'context.source.loaded',
        'session.created',
        'run.started',
        'run.completed',
      ])
      expect(agentOptions[0].messages?.[0].content).to.equal('Project guidance')

      const sessions = await service.listSessions()
      expect(sessions.data[0]).to.include({id: thread.id, preview: 'Hello GUI'})
      expect(sessions.errors).to.deep.equal([])
    } finally {
      await service.close()
    }
  })

  it('restores persisted runtime defaults when resuming a session', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-application-resume-'))
    const repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
    const firstOptions: AgentOptions[] = []
    const first = new OrbitApplicationService({
      contexts: [],
      createAgent: createAgentFactory(firstOptions),
      cwd: root,
      model: 'persisted-model',
      provider: 'anthropic',
      repository,
      settings: {},
      settingsSources: [],
    })
    const thread = first.createThread()
    await first.close()

    const resumedOptions: AgentOptions[] = []
    const second = new OrbitApplicationService({
      contexts: [],
      createAgent: createAgentFactory(resumedOptions),
      cwd: path.join(root, 'other'),
      model: 'current-default',
      provider: 'ollama',
      repository,
      settings: {},
      settingsSources: [],
    })

    try {
      const resumed = await second.resumeSession(thread.id)

      expect(resumed).to.include({cwd: root, id: thread.id, model: 'persisted-model', provider: 'anthropic'})
      expect(resumedOptions[0].cwd).to.equal(root)
      expect(resumedOptions[0].model).to.deep.equal({name: 'persisted-model', provider: 'anthropic'})
    } finally {
      await second.close()
    }
  })

  it('displays and logs GUI slash commands without adding them to the session', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-application-command-'))
    const repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
    let invokeCount = 0
    const modelRequests: string[][] = []
    const loggedCommands: unknown[] = []
    const logger = createNoopLogger()
    logger.info = (fields) => loggedCommands.push(fields)
    const service = new OrbitApplicationService({
      contexts: [],
      createAgent: (agentOptions) => ({
        async close() {},
        async invoke(messages, invokeOptions) {
          invokeCount += 1
          modelRequests.push(messages.map((message) => message.content))
          agentOptions.state?.getSession().appendMessages(messages, {turnId: invokeOptions?.turnId})
          return new Message(MessageType.Assistant, {content: 'unexpected'})
        },
      }),
      cwd: root,
      logger,
      model: 'qwen3:latest',
      provider: 'ollama',
      repository,
      settingsSources: [],
    })

    try {
      const thread = service.createThread()
      const result = service.startRun(thread.id, '/help')
      const commandEvent = service.getEvents().find((event) => event.type === 'command.submitted')

      expect(result).to.include({threadId: thread.id})
      expect(result.runId).to.be.a('string').and.not.empty
      expect(invokeCount).to.equal(0)
      expect(service.getThread(thread.id)?.messages.map((message) => message.content)).to.deep.equal([
        '/help',
        guiSlashCommandHelpMessage,
      ])
      expect(commandEvent).to.include({level: 'info', runId: result.runId, sessionId: thread.id, threadId: thread.id})
      expect(commandEvent?.data).to.deep.equal({command: '/help', response: guiSlashCommandHelpMessage})
      expect(loggedCommands).to.deep.include({diagnosticEvent: JSON.stringify(commandEvent)})

      service.startRun(thread.id, '/model')
      expect(service.getThread(thread.id)?.messages.map((message) => message.content)).to.deep.equal([
        '/help',
        guiSlashCommandHelpMessage,
        '/model',
        'Current model: ollama:qwen3:latest',
      ])

      const sessions = await service.listSessions()
      expect(sessions.data[0]).to.include({id: thread.id})
      expect(sessions.data[0].preview).to.equal(undefined)

      const completed = waitForEvent(service, 'run.completed')
      service.startRun(thread.id, 'Hello after help')
      await completed
      expect(modelRequests).to.deep.equal([['Hello after help']])
      expect(service.getThread(thread.id)?.messages.map((message) => message.content)).to.deep.equal([
        '/help',
        guiSlashCommandHelpMessage,
        '/model',
        'Current model: ollama:qwen3:latest',
        'Hello after help',
      ])
    } finally {
      await service.close()
    }
  })

  it('updates diagnostics capture independently from pane visibility', async () => {
    const service = new OrbitApplicationService({
      contexts: [],
      cwd: process.cwd(),
      model: 'test-model',
      provider: 'ollama',
      settingsSources: [],
    })

    const preferences = service.updatePreferences({
      debugPanelVisible: false,
      diagnosticCapture: DiagnosticCapture.Metadata,
    })

    expect(preferences).to.deep.equal({debugPanelVisible: false, diagnosticCapture: 'metadata'})
    expect(service.diagnostics.getCapture()).to.equal('metadata')
    await service.close()
  })

  it('closes an active thread before permanently deleting its session', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-application-delete-'))
    const repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
    const service = new OrbitApplicationService({
      contexts: [],
      createAgent: createAgentFactory([]),
      cwd: root,
      model: 'test-model',
      provider: 'ollama',
      repository,
      settingsSources: [],
    })

    try {
      const thread = service.createThread()
      const file = thread.file as string

      expect(await service.deleteSession(thread.id)).to.equal(true)
      expect(service.getThread(thread.id)).to.equal(undefined)
      expect(await repository.findById(thread.id)).to.equal(undefined)
      expect(service.getEvents().find((event) => event.type === 'session.deleted')).to.include({
        sessionId: thread.id,
        threadId: thread.id,
      })
      expect(await service.deleteSession(thread.id)).to.equal(false)
      await fs.access(file).then(
        () => {
          throw new Error('Expected deleted session file to be absent.')
        },
        () => {},
      )
    } finally {
      await service.close()
    }
  })
})

function createAgentFactory(options: AgentOptions[]): ThreadAgentFactory {
  return (agentOptions) => {
    options.push(agentOptions)
    return {
      async close() {},
      async invoke(messages, invokeOptions) {
        invokeOptions?.onEvent?.({iteration: 0, type: 'model-started'})
        agentOptions.state?.getSession().appendMessages(messages, {turnId: invokeOptions?.turnId})
        const response = new Message(MessageType.Assistant, {content: 'mock response'})
        const [storedResponse] =
          agentOptions.state?.getSession().appendMessages([response], {
            iteration: 0,
            turnId: invokeOptions?.turnId,
          }) ?? [response]
        invokeOptions?.onEvent?.({iteration: 0, message: storedResponse, type: 'message-completed'})
        return storedResponse
      },
    }
  }
}

function waitForEvent(service: OrbitApplicationService, type: string): Promise<DiagnosticEvent> {
  return new Promise((resolve) => {
    const unsubscribe = service.subscribe((event) => {
      if (event.type !== type) return
      unsubscribe()
      resolve(event)
    })
  })
}
