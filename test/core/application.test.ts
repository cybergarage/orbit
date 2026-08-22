// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type {AgentOptions, DiagnosticEvent, ThreadAgentFactory} from '../../src/core/index.js'

import {
  DiagnosticCapture,
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

  it('updates diagnostics capture independently from pane visibility', async () => {
    const service = new OrbitApplicationService({contexts: [], cwd: process.cwd(), settingsSources: []})

    const preferences = service.updatePreferences({
      debugPanelVisible: false,
      diagnosticCapture: DiagnosticCapture.Metadata,
    })

    expect(preferences).to.deep.equal({debugPanelVisible: false, diagnosticCapture: 'metadata'})
    expect(service.diagnostics.getCapture()).to.equal('metadata')
    await service.close()
  })
})

function createAgentFactory(options: AgentOptions[]): ThreadAgentFactory {
  return (agentOptions) => {
    options.push(agentOptions)
    return {
      async close() {},
      async invoke(_messages, invokeOptions) {
        invokeOptions?.onEvent?.({iteration: 0, type: 'model-started'})
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
