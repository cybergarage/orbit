// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

// Synthetic-only browser fixture. Build first; no user settings, history, or providers are loaded.
import {randomUUID} from 'node:crypto'
import fs from 'node:fs/promises'
import http from 'node:http'
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

              return new Message(MessageType.Assistant, {content: 'Keep the conversation in focus. Project context, next-run limits, Skills and logs are together in Details.'})
            },
          }),
        },
        execution: {onApproval() {}, responderScope: 'local-gui'},
        toolProfile: ToolProfile.Coding,
      })
    },
    cwd: root,
    logStore: new MemorySessionLogStore(),
    model: 'synthetic-model',
    projectStore: new MemoryProjectStore(),
    provider: 'ollama',
    repository,
    resolveProjectRuntime: async () => ({model: 'synthetic-model', provider: 'ollama', settings: {}}),
    settingsSources: [],
  })
  const server = await startGuiServer({service, token: 'synthetic-details-capability'})
  const streams = new Set()
  const proxy = http.createServer((request, response) => {
    const upstream = http.request({headers: {...request.headers, host: `${server.host}:${server.port}`, ...(request.headers.origin ? {origin: `http://${server.host}:${server.port}`} : {})}, host: server.host, method: request.method, path: request.url, port: server.port}, (reply) => {
      response.writeHead(reply.statusCode, reply.headers)
      reply.pipe(response)
    })
    if (request.url.startsWith('/api/events')) {
      streams.add(response)
      response.on('close', () => {streams.delete(response); upstream.destroy()})
    }

    upstream.on('error', () => {if (!response.headersSent) response.writeHead(502); response.end()})
    request.pipe(upstream)
  })
  await new Promise((resolve) => {proxy.listen(0, '127.0.0.1', resolve)})
  return {async close() {
    for (const stream of streams) stream.end()
    proxy.closeAllConnections()
    await new Promise((resolve) => {proxy.close(resolve)})
    await server.close()
    await service.close()
    await fs.rm(root, {force: true, recursive: true})
  }, disconnectStreams() {for (const stream of streams) stream.end()}, root, server: {...server, port: proxy.address().port}, service}
}
