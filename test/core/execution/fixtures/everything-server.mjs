// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

// Build first. Pass the dist/index.js of an isolated installation of
// @modelcontextprotocol/server-everything@2026.8.31. No automatic installation.
// This verifies the current managed catalog refusal, then a direct-client control.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'

import {
  Agent,
  DiagnosticEventBus,
  MemorySessionLogStore,
  Message,
  MessageType,
  SessionRepository,
} from '../../../../dist/core/index.js'
import {createMcpClient, createMcpTransport} from '../../../../dist/core/mcp.js'

assert.ok(process.argv[2], 'Pass the isolated server dist/index.js path')
const entry = path.resolve(process.argv[2])
const metadata = JSON.parse(await fs.readFile(path.resolve(path.dirname(entry), '../package.json'), 'utf8'))
assert.equal(metadata.name, '@modelcontextprotocol/server-everything')
assert.equal(metadata.version, '2026.8.31')
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-everything-'))
const repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
repository.initializeStorage({allWritersStopped: true, automaticRestartersDisabled: true, exclusiveStorageControl: true})
const session = repository.create()
const store = new MemorySessionLogStore()
const diagnostics = new DiagnosticEventBus({capture: 'full'})
const failures = []
diagnostics.subscribe((event) => {
  if (event.type === 'mcp.server.failed') failures.push(event.data.error)
})
const pidFile = path.join(root, 'pid')
const wrapper = path.join(root, 'server.mjs')
await fs.writeFile(
  wrapper,
  `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); await import(${JSON.stringify(pathToFileURL(entry).href)});`,
)
let models = 0
let approvals = 0
const agent = new Agent({
  cwd: root,
  deps: {
    createModel: () => ({
      getModel: () => 'fixture',
      getName: () => 'model',
      getProvider: () => 'ollama',
      async invoke() {
        models++
        throw new Error('Managed catalog refusal must precede the model')
      },
    }),
  },
  diagnostics,
  execution: {
    async onApproval(request) {
      approvals++
      await agent.replyApproval(request.runId, {
        approve: true,
        digest: request.digest,
        requestId: request.id,
        responderScope: 'fixture',
      })
    },
    responderScope: 'fixture',
  },
  logStore: store,
  settings: {mcp: {servers: {everything: {args: [wrapper], command: process.execPath}}}},
})
try {
  const result = await (
    await agent.startRun([new Message(MessageType.User, {content: 'exercise official MCP server'})], {}, session)
  ).finished
  assert.deepEqual(failures, ['Unsupported managed MCP schema keyword: $schema'])
  assert.equal(models, 0)
  assert.equal(approvals, 1)
  assert.equal(result.outcome, 'incomplete')
  assert.equal(result.recording.status, 'acknowledged')
  assert.equal(result.recording.level, 'file-and-directory-sync')
  assert.equal(result.quiescence, false)
  const pid = Number(await fs.readFile(pidFile, 'utf8'))
  assert.throws(() => process.kill(pid, 0), {code: 'ESRCH'})
  // No tool/model ran, discovery failed, and the only child is confirmed gone.
  await agent.supervisor.reconcileRun(result.runId, {
    confirmedStopped: true,
    operations: result.operations.map(({id}) => ({id, status: 'failed'})),
  })
  console.log(JSON.stringify({approvals, childExited: true, failures, mode: 'managed', models, result}))
  await agent.close()
  await session.close()
  await store.close()

  const client = createMcpClient()
  const transport = createMcpTransport({args: [entry], command: process.execPath, env: {}}, {cwd: root})
  try {
    await client.connect(transport)
    const {tools} = await client.listTools()
    const echo = await client.callTool({arguments: {message: 'isolated MCP trial'}, name: 'echo'})
    const started = performance.now()
    const slow = await client.callTool(
      {arguments: {duration: 3, steps: 3}, name: 'trigger-long-running-operation'},
      undefined,
      {timeout: 10_000},
    )
    assert.equal(echo.content[0].text, 'Echo: isolated MCP trial')
    assert.match(slow.content[0].text, /Duration: 3 seconds, Steps: 3/u)
    console.log(JSON.stringify({catalogCount: tools.length, echo, mode: 'direct-control', slow, slowMs: performance.now() - started}))
  } finally {
    await client.close()
  }
} finally {
  // Do not silently reconcile an unexpected result merely to force cleanup.
  await agent.close()
  await session.close()
  await store.close()
  await fs.rm(root, {force: true, recursive: true})
}
