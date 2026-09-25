// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type {McpClient} from '../../../src/core/mcp.js'

import {Agent, DEFAULT_RUN_LIMITS, MemorySessionLogStore, Message, MessageType} from '../../../src/core/index.js'
import {createMcpToolManager} from '../../../src/core/mcp.js'

const user = [new Message(MessageType.User, {content: 'exercise MCP'})]

describe('managed MCP catalog and remote outcomes', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-mcp-contract-'))
  })

  afterEach(async () => {
    await fs.rm(root, {force: true, recursive: true})
  })

  function fixture(schema: Record<string, unknown>, input: unknown, remote?: McpClient['callTool']) {
    const counts = {approvals: 0, calls: 0, closes: 0, models: 0}
    const agent = new Agent({
      cwd: root,
      deps: {
        createMcpToolManager: (settings, options) =>
          createMcpToolManager(settings.mcp, {
            ...options,
            clientFactory: () => ({
              async callTool(...args) {
                counts.calls++
                return remote ? remote(...args) : {content: []}
              },
              async close() {
                counts.closes++
              },
              async connect() {},
              async listTools() {
                return {tools: [{inputSchema: schema, name: 'check'}]}
              },
            }),
            transportFactory: () => ({}) as never,
          }),
        createModel: () => ({
          getModel: () => 'fixture',
          getName: () => 'model',
          getProvider: () => 'ollama',
          async invoke() {
            return ++counts.models === 1
              ? new Message(MessageType.Assistant, {
                  payload: {toolCalls: [{id: 'call', input, name: 'fixture__check'}]},
                })
              : new Message(MessageType.Assistant, {content: 'done'})
          },
        }),
      },
      execution: {
        async onApproval(request) {
          counts.approvals++
          await agent.replyApproval(request.runId, {
            approve: true,
            digest: request.digest,
            requestId: request.id,
            responderScope: 'owner',
          })
        },
        responderScope: 'owner',
      },
      logStore: new MemorySessionLogStore(),
      settings: {mcp: {servers: {fixture: {command: 'test-transport'}}}},
    })
    return {agent, counts}
  }

  const unsupported: Record<string, unknown>[] = [
    {$schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object'},
    {$schema: 'https://example.invalid/schema', type: 'object'},
    {$schema: 7, type: 'object'},
    {properties: {value: {$schema: 'http://json-schema.org/draft-07/schema#', type: 'string'}}, type: 'object'},
    {properties: {value: {format: 'made-up', type: 'string'}}, type: 'object'},
    {$ref: '#/$defs/value', type: 'object'},
    {properties: {value: {format: 'email', type: 'string'}}, type: 'object'},
    {additionalProperties: {unevaluatedProperties: false}, type: 'object'},
    {allOf: [{properties: {value: {$dynamicRef: '#value'}}}], type: 'object'},
    {properties: {value: {items: [{format: 'email', type: 'string'}], type: 'array'}}, type: 'object'},
  ]
  for (const [index, schema] of unsupported.entries()) {
    it(`rejects unsupported catalog vocabulary ${index + 1} before model exposure`, async () => {
      const {agent, counts} = fixture(schema, {})
      try {
        const result = await (await agent.startRun(user)).finished
        expect(result.outcome).not.equal('completed')
        expect(counts.models).equal(0)
        expect(counts.calls).equal(0)
        expect(counts.approvals).equal(1)
        expect(counts.closes).equal(1)
        await agent.supervisor.reconcileRun(result.runId, {
          confirmedStopped: true,
          operations: result.operations.map(({id}) => ({id, status: 'failed'})),
        })
      } finally {
        await agent.close()
      }
    })
  }

  for (const [input, valid] of [
    [{target: 'https://example.invalid/resource'}, true],
    [{target: 'data:text/plain,isolated'}, true],
    [{target: 'relative/path'}, false],
    [{target: 'https://example.invalid/with space'}, false],
    [{target: 12}, false],
    [{}, false],
  ] as const) {
    it(`validates Draft 7 URI input ${JSON.stringify(input)} without weakening operation approval`, async () => {
      const schema = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        additionalProperties: false,
        properties: {target: {format: 'uri', type: 'string'}},
        required: ['target'],
        type: 'object',
      }
      const {agent, counts} = fixture(schema, input)
      try {
        const result = await (await agent.startRun(user)).finished
        expect(result.outcome).equal('completed')
        expect(counts.calls).equal(valid ? 1 : 0)
        expect(counts.approvals).equal(valid ? 2 : 1)
        expect(result.operations.at(-1)?.status).equal(valid ? 'succeeded' : 'invalid')
      } finally {
        await agent.close()
      }
    })
  }

  const schema = {
    additionalProperties: false,
    allOf: [{not: {required: ['forbidden']}}],
    anyOf: [{properties: {mode: {const: 'a'}}}, {required: ['label']}],
    oneOf: [{properties: {mode: {const: 'a'}}}, {properties: {mode: {const: 'b'}}}],
    properties: {
      label: {maxLength: 4, minLength: 2, pattern: '^[a-z]+$', type: 'string'},
      mode: {enum: ['a', 'b']},
      values: {items: {maximum: 3, minimum: 1, type: 'integer'}, maxItems: 2, minItems: 1, type: 'array'},
    },
    required: ['mode', 'values'],
    type: 'object',
  }
  for (const [index, input] of [
    {mode: 'a', values: [1, 3]},
    {label: 'ok', mode: 'b', values: [2]},
    {mode: 'a', values: [0]},
    {mode: 'a', values: [1, 2, 3]},
    {mode: 'b', values: [1]},
    {label: 'BAD', mode: 'b', values: [1]},
    {forbidden: true, mode: 'a', values: [1]},
  ].entries()) {
    it(`validates supported nested catalog constraints for input ${index + 1}`, async () => {
      const {agent, counts} = fixture(schema, input)
      try {
        const result = await (await agent.startRun(user)).finished
        expect(result.outcome).equal('completed')
        expect(counts.calls).equal(index < 2 ? 1 : 0)
        expect(counts.approvals).equal(index < 2 ? 2 : 1)
        expect(result.operations.at(-1)?.status).equal(index < 2 ? 'succeeded' : 'invalid')
      } finally {
        await agent.close()
      }
    })
  }

  it('keeps a remote timeout unknown until explicit reconciliation and never retries it', async () => {
    let timeout: number | undefined
    const {agent, counts} = fixture({type: 'object'}, {}, async (_params, _schema, options) => {
      timeout = options?.timeout
      throw new Error('Simulated remote timeout after possible effect')
    })
    try {
      const handle = await agent.startRun(user, {requestId: 'same-request'})
      const result = await handle.finished
      expect(result.outcome).equal('incomplete')
      expect(result.quiescence).equal(false)
      expect(result.operations.at(-1)?.status).equal('unknown')
      expect(timeout).within(1, DEFAULT_RUN_LIMITS.elapsedMs)
      expect(counts.calls).equal(1)
      expect(counts.models).equal(1)
      expect((await agent.startRun(user, {requestId: 'same-request'})).id).equal(handle.id)
      expect(counts.calls).equal(1)
      await agent.supervisor.reconcileRun(result.runId, {
        confirmedStopped: true,
        operations: result.operations.map(({id}) => ({id, status: 'succeeded'})),
      })
      expect(agent.supervisor.getRun(result.runId)?.quarantined).equal(false)
      expect(result.operations.at(-1)?.status).equal('unknown')
    } finally {
      await agent.close()
    }
  })

  it('bounds an actual stdio call after a possible effect without redispatch', async () => {
    const script = path.join(root, 'slow-mcp.cjs')
    const effect = path.join(root, 'effect')
    const pidFile = path.join(root, 'pid')
    await fs.writeFile(
      script,
      `
      const fs = require('node:fs');
      fs.writeFileSync(process.argv[3], String(process.pid));
      require('node:readline').createInterface({input: process.stdin}).on('line', (line) => {
        const request = JSON.parse(line);
        if (request.id === undefined) return;
        const reply = (result) => process.stdout.write(JSON.stringify({jsonrpc: '2.0', id: request.id, result}) + '\\n');
        if (request.method === 'initialize') reply({protocolVersion: '2025-03-26', capabilities: {tools: {}}, serverInfo: {name: 'slow', version: '1'}});
        else if (request.method === 'tools/list') reply({tools: [{name: 'slow', inputSchema: {type: 'object'}}]});
        else { fs.appendFileSync(process.argv[2], 'once\\n'); setTimeout(() => reply({content: []}), 5000); }
      });
    `,
    )
    let models = 0
    const agent = new Agent({
      cwd: root,
      deps: {
        createModel: () => ({
          getModel: () => 'fixture',
          getName: () => 'model',
          getProvider: () => 'ollama',
          async invoke() {
            models++
            return new Message(MessageType.Assistant, {
              payload: {toolCalls: [{id: 'slow', input: {}, name: 'fixture__slow'}]},
            })
          },
        }),
      },
      execution: {
        limits: {cleanupMs: 5000, elapsedMs: 1500},
        policy: {generation: 'fixture', profile: 'unrestricted', roots: [root]},
      },
      logStore: new MemorySessionLogStore(),
      settings: {mcp: {servers: {fixture: {args: [script, effect, pidFile], command: process.execPath}}}},
    })
    try {
      const result = await (await agent.startRun(user)).finished
      expect(result.outcome).equal('incomplete')
      expect(result.operations.at(-1)?.status).equal('unknown')
      expect(models).equal(1)
      expect(await fs.readFile(effect, 'utf8')).equal('once\n')
      const pid = Number(await fs.readFile(pidFile, 'utf8'))
      expect(() => process.kill(pid, 0)).throws()
      await agent.supervisor.reconcileRun(result.runId, {
        confirmedStopped: true,
        operations: result.operations.map(({id}) => ({id, status: 'succeeded'})),
      })
      expect(result.quiescence).equal(false)
      expect(agent.supervisor.getRun(result.runId)?.quarantined).equal(false)
    } finally {
      await agent.close()
    }
  })
})
