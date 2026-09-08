// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

// Build first. Open the printed loopback URL, create a session, send edit and
// approve once. This proxy deliberately breaks its own isolated HTTP/SSE flow.
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import {startGuiServer} from '../../../../dist/apps/gui/server.js'
import {
  Agent,
  MemorySessionLogStore,
  Message,
  MessageType,
  OrbitApplicationService,
  SessionRepository,
  ToolProfile,
} from '../../../../dist/core/index.js'
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-gui-faults-'))
const repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
repository.initializeStorage({
  allWritersStopped: true,
  automaticRestartersDisabled: true,
  exclusiveStorageControl: true,
})
let armed = false
let calls = 0
let delayed = false
let failed = false
let replayed = false
let waiting
const streams = new Set()
const timers = new Set()
const schedule = (callback) => {
  const timer = setTimeout(() => {
    timers.delete(timer)
    callback()
  }, 2000)
  timers.add(timer)
}

const service = new OrbitApplicationService({
  contexts: [],
  createAgent: (options) =>
    new Agent({
      ...options,
      deps: {
        createModel: () => ({
          getModel: () => 'fixture',
          getName: () => 'model',
          getProvider: () => 'ollama',
          async invoke() {
            return ++calls === 1
              ? new Message(MessageType.Assistant, {
                  payload: {
                    toolCalls: [
                      {
                        id: 'write',
                        input: {content: 'once despite transport faults', path: 'answer.txt'},
                        name: 'write',
                      },
                    ],
                  },
                })
              : new Message(MessageType.Assistant, {content: 'Fixture completed.'})
          },
        }),
      },
      execution: {onApproval() {}, responderScope: 'local-gui'},
      toolProfile: ToolProfile.Coding,
    }),
  cwd: root,
  logStore: new MemorySessionLogStore(),
  model: 'fixture',
  provider: 'ollama',
  repository,
  settingsSources: [],
})
service.updatePreferences({diagnosticCapture: 'off'})
const server = await startGuiServer({service, token: 'isolated-fixture-token'})
const proxy = http.createServer((request, response) => {
  if (request.url.startsWith('/api/runs/') && request.url.endsWith('/approvals')) {
    armed = true
    for (const stream of streams) stream.end()
    console.log('FAULT disconnected SSE before approval response')
  }

  const isThread = request.method === 'GET' && /^\/api\/threads\/[^/]+$/.test(request.url)
  if (armed && isThread && !delayed && waiting) {
    delayed = true
    schedule(() => {
      response.writeHead(200, {'Content-Type': 'application/json'})
      response.end(waiting)
      console.log('FAULT released delayed stale HTTP snapshot')
    })
    return
  }

  if (armed && isThread && !failed) {
    failed = true
    response.writeHead(503, {'Content-Type': 'application/json'})
    response.end('{"error":"Injected snapshot failure"}')
    console.log('FAULT snapshot HTTP 503')
    return
  }

  const upstream = http.request(
    {
      headers: {
        ...request.headers,
        host: `${server.host}:${server.port}`,
        ...(request.headers.origin ? {origin: `http://${server.host}:${server.port}`} : {}),
      },
      host: server.host,
      method: request.method,
      path: request.url,
      port: server.port,
    },
    (incoming) => {
      response.writeHead(incoming.statusCode, incoming.headers)
      if (request.url.startsWith('/api/events')) {
        streams.add(response)
        if (armed && waiting && !replayed) {
          replayed = true
          const snapshot = JSON.parse(waiting).run
          for (const sequence of [snapshot.sequence, snapshot.sequence - 1, snapshot.sequence])
            response.write(`event: run-snapshot\ndata: ${JSON.stringify({...snapshot, sequence})}\n\n`)
          console.log('FAULT replayed duplicate and reordered SSE snapshots on reconnect')
        }
      }

      const chunks = []
      incoming.on('data', (chunk) => {
        response.write(chunk)
        if (isThread) chunks.push(chunk)
      })
      incoming.on('end', () => {
        if (isThread && !armed) {
          const body = Buffer.concat(chunks).toString()
          if (body && JSON.parse(body).run?.approvals.length) waiting = body
        }

        response.end()
      })
      incoming.on('error', () => response.destroy())
    },
  )
  upstream.on('error', () => response.destroy())
  response.on('close', () => {
    streams.delete(response)
    upstream.destroy()
  })
  request.pipe(upstream)
})
await new Promise((resolve) => {
  proxy.listen(0, '127.0.0.1', resolve)
})
console.log(`http://127.0.0.1:${proxy.address().port}/?token=${server.token}`)
process.once('SIGTERM', async () => {
  for (const timer of timers) clearTimeout(timer)
  for (const stream of streams) stream.end()
  proxy.closeAllConnections()
  proxy.close()
  console.log(
    JSON.stringify({
      calls,
      content: await fs.readFile(path.join(root, 'answer.txt'), 'utf8').catch(() => null),
      delayed,
      failed,
      replayed,
    }),
  )
  await server.close()
  await service.close()
  await fs.rm(root, {force: true, recursive: true})
})
