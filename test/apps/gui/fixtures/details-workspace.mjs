// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

// Synthetic-only browser fixture. Build first; no user settings, history, or providers are loaded.
import {randomUUID} from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {startGuiServer} from '../../../../dist/apps/gui/server.js'
import {
  Agent,
  MemoryProjectStore,
  MemorySessionLogStore,
  Message,
  MessageType,
  OrbitApplicationService,
  SessionRepository,
  ToolProfile,
} from '../../../../dist/core/index.js'

export async function startDetailsFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-details-fixture-'))
  const repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
  repository.initializeStorage({allWritersStopped: true, automaticRestartersDisabled: true, exclusiveStorageControl: true})
  const logs = new MemorySessionLogStore()
  const service = new OrbitApplicationService({
    contexts: [],
    createAgent(options) {
      const called = new Set()
      return new Agent({
        ...options,
        deps: {
          createModel: () => ({
            getModel: () => 'synthetic-model',
            getName: () => 'model',
            getProvider: () => 'ollama',
            async invoke(messages) {
              const user = messages.findLast((message) => message.role === 'user')
              const prompt = user?.content ?? ''
              if (/operation/i.test(prompt) && !called.has(user.id)) {
                called.add(user.id)
                return new Message(MessageType.Assistant, {payload: {toolCalls: [{id: randomUUID(), input: {content: 'Synthetic approval result.', path: 'synthetic-answer.txt'}, name: 'write'}]}})
              }

              return new Message(MessageType.Assistant, {content: 'Keep the conversation in focus. Project context, next-run limits, Skills and logs are together in the Logs panel.'})
            },
          }),
        },
        execution: {onApproval() {}, responderScope: 'local-gui'},
        toolProfile: ToolProfile.Coding,
      })
    },
    cwd: root,
    logStore: logs,
    model: 'synthetic-model',
    projectStore: new MemoryProjectStore(),
    provider: 'ollama',
    repository,
    resolveProjectRuntime: async () => ({model: 'synthetic-model', provider: 'ollama', settings: {}}),
    settingsSources: [],
  })
  const token = 'synthetic-details-capability'
  let server = await startGuiServer({service, token})
  return {
    async close() {
      await server.close()
      await service.close()
      await fs.rm(root, {force: true, recursive: true})
    },
    async disconnectStreams() {
      // Restart only the transport; keep the isolated service and session state.
      const {port} = server
      await server.close()
      await new Promise((resolve) => {setTimeout(resolve, 500)})
      server = await startGuiServer({port, service, token})
    },
    logs,
    root,
    server,
    service,
  }
}
