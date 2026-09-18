// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {z} from 'zod'

import type {McpToolManagerOptions} from '../../../src/core/mcp.js'
import type {McpSettings} from '../../../src/core/settings.js'

import {createMcpToolManager} from '../../../src/core/mcp.js'
import {formatToolInventory, inspectTools} from '../../../src/core/tools/inventory.js'

function fixture() {
  const counts = {calls: 0, closes: 0, connects: 0, lists: 0}
  const create = (settings: McpSettings, options: McpToolManagerOptions) =>
    createMcpToolManager(settings, {
      ...options,
      clientFactory: () => ({
        async callTool() {
          counts.calls++
          throw new Error('Tools must not be invoked')
        },
        async close() {
          counts.closes++
        },
        async connect() {
          counts.connects++
        },
        async listTools() {
          counts.lists++
          return {tools: [{description: 'Look up a record', inputSchema: {type: 'object'}, name: 'lookup'}]}
        },
      }),
      transportFactory: () => ({}) as never,
    })
  return {counts, create}
}

describe('tool inventory', () => {
  let cwd: string

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-inventory-'))
  })

  afterEach(async () => {
    await fs.rm(cwd, {force: true, recursive: true})
  })

  const settings = {mcp: {servers: {fixture: {command: 'fake', env: {API_KEY: 'fake-secret'}}}}}

  it('uses the coding default and honors profile, include and exclude without MCP startup', async () => {
    expect((await inspectTools()).tools).to.have.length(7)
    const result = await inspectTools(
      {settings: {...settings, tools: {exclude: ['list'], include: ['read', 'list'], profile: 'none'}}},
      () => {
        throw new Error('Unexpected startup')
      },
    )
    expect(result.tools.map((tool) => tool.name)).to.deep.equal(['read'])
    expect(result.complete).equal(false)
    expect(result.servers).to.deep.equal([{name: 'fixture', status: 'not-connected', toolCount: null}])
    expect(JSON.stringify(result)).not.include('fake-secret')
    expect(formatToolInventory(result, 'mcp')).include('tools=unknown')
  })

  it('retains custom provenance without invoking custom tools', async () => {
    const result = await inspectTools({
      settings: {tools: {profile: 'none'}},
      tools: [
        {
          description: 'Custom lookup',
          getName: () => 'tool',
          async invoke() {
            throw new Error('Unexpected invocation')
          },
          name: 'lookup',
          schema: z.object({}),
          source: {id: 'application', kind: 'custom'},
        },
      ],
    })
    expect(result.tools[0].source).deep.equal({id: 'application', kind: 'custom'})
    expect(result.complete).equal(true)
  })

  it('requires approval before connecting and closes clients after discovery', async () => {
    const {counts, create} = fixture()
    let approvals = 0
    const result = await inspectTools(
      {
        async approve() {
          approvals++
          expect(counts.connects).equal(0)
          return true
        },
        connect: true,
        cwd,
        settings,
      },
      create,
    )
    expect(approvals).equal(1)
    expect(counts).deep.equal({calls: 0, closes: 1, connects: 1, lists: 1})
    expect(result.complete).equal(true)
    expect(result.inspection?.recording.mode).equal('memory')
    expect(result.servers[0]).deep.equal({name: 'fixture', status: 'discovered', toolCount: 1})
    expect(result.tools.find((tool) => tool.name === 'fixture__lookup')?.source).deep.equal({
      kind: 'mcp',
      server: 'fixture',
      tool: 'lookup',
    })
    expect(JSON.stringify(result)).not.include('fake-secret')
  })

  it('reports denied discovery without starting clients', async () => {
    const {counts, create} = fixture()
    const result = await inspectTools({connect: true, cwd, settings}, create)
    expect(result.complete).equal(false)
    expect(result.servers[0].status).equal('failed')
    expect(result.servers[0].toolCount).equal(null)
    expect(counts.connects).equal(0)
    expect(result.inspection?.operations.some((operation) => operation.status === 'denied')).equal(true)
  })

  it('allows explicit unrestricted discovery and enforces the source limit', async () => {
    const {counts, create} = fixture()
    const result = await inspectTools({connect: true, cwd, executionPolicy: 'unrestricted', settings}, create)
    expect(result.complete).equal(true)
    const limited = await inspectTools({connect: true, cwd, limits: {mcpServers: 0}, settings}, create)
    expect(limited.complete).equal(false)
    expect(counts.connects).equal(1)
  })

  it('stops discovery while approval is pending', async () => {
    const {counts, create} = fixture()
    const controller = new AbortController()
    const result = await inspectTools(
      {
        async approve() {
          controller.abort('user')
          return false
        },
        connect: true,
        cwd,
        settings,
        signal: controller.signal,
      },
      create,
    )
    expect(result.complete).equal(false)
    expect(result.inspection?.outcome).equal('cancelled')
    expect(counts.connects).equal(0)
  })

  it('closes a failed source, redacts its error and leaves later sources undiscovered', async () => {
    let closes = 0
    const result = await inspectTools(
      {
        connect: true,
        cwd,
        settings: {
          mcp: {
            servers: {
              first: {command: 'unused'},
              second: {command: 'unused'},
            },
          },
        },
      },
      () => ({
        async close() {
          closes++
        },
        async getTools() {
          throw new Error('fake-private-value')
        },
      }),
    )
    expect(closes).equal(1)
    expect(result.complete).equal(false)
    expect(result.servers.map((server) => server.status)).deep.equal(['failed', 'not-connected'])
    expect(JSON.stringify(result)).not.include('fake-private-value')
  })

  it('bounds a slow discovery and waits for cleanup to settle its work', async () => {
    let finish!: (tools: []) => void
    let closes = 0
    const result = await inspectTools({connect: true, cwd, limits: {cleanupMs: 1000, elapsedMs: 30}, settings}, () => ({
      async close() {
        closes++
        finish([])
      },
      getTools: () =>
        new Promise<[]>((resolve) => {
          finish = resolve
        }),
    }))
    expect(closes).equal(1)
    expect(result.complete).equal(false)
    expect(result.inspection?.outcome).equal('budget-exceeded')
    expect(result.inspection?.quiescence).equal(true)
  })

  it('does not report success when cleanup fails', async () => {
    let failure: unknown
    try {
      await inspectTools({connect: true, cwd, settings}, () => ({
        async close() {
          throw new Error('Cannot close fixture')
        },
        async getTools() {
          return []
        },
      }))
    } catch (error) {
      failure = error
    }

    expect(failure).to.have.property('name', 'RunExecutionError')
    expect(String(failure)).include('quiescence=false')
  })
})
