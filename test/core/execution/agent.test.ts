// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type {Message as MessageValue, Model, ModelInvokeOptions} from '../../../src/core/index.js'

import {MemoryExecutionJournal} from '../../../src/core/execution/journal.js'
import {
  Agent,
  MemorySessionLogStore,
  Message,
  MessageType,
  SessionDeletionService,
  State,
  ToolProfile,
} from '../../../src/core/index.js'
import {createMcpToolManager} from '../../../src/core/mcp.js'
import {SessionRepository} from '../../session-storage-fixture.js'

function model(
  invoke: (messages: MessageValue[], options?: Partial<ModelInvokeOptions>) => Promise<MessageValue>,
): Model {
  return {getModel: () => 'test-model', getName: () => 'model', getProvider: () => 'ollama', invoke}
}

function call(name: string, input: unknown) {
  return new Message(MessageType.Assistant, {payload: {toolCalls: [{id: 'call', input, name}]}})
}

function user() {
  return [new Message(MessageType.User, {content: 'test request'})]
}

// These tests exercise the managed Agent path, not direct invocation of a built-in tool.
describe('managed coding Agent integration', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-managed-agent-'))
  })

  afterEach(async () => {
    await fs.rm(root, {force: true, recursive: true})
  })

  it('denies a write without UI while allowing the model to report the denial', async () => {
    let calls = 0
    const agent = new Agent({
      cwd: root,
      deps: {
        createModel: () =>
          model(async () =>
            ++calls === 1
              ? call('write', {content: 'new', path: 'answer.txt'})
              : new Message(MessageType.Assistant, {content: 'denied'}),
          ),
      },
      logStore: new MemorySessionLogStore(),
      toolProfile: ToolProfile.Coding,
    })
    try {
      const handle = await agent.startRun(user())
      const result = await handle.finished
      expect(result.outcome).equal('completed')
      expect(result.operations[0].status).equal('denied')
      expect(
        await fs.access(path.join(root, 'answer.txt')).then(
          () => true,
          () => false,
        ),
      ).equal(false)
    } finally {
      await agent.close()
    }
  })

  it('rejects an invalid call without asking or dispatching', async () => {
    let calls = 0
    let approvals = 0
    const agent = new Agent({
      cwd: root,
      deps: {
        createModel: () =>
          model(async () =>
            ++calls === 1 ? call('write', {path: 42}) : new Message(MessageType.Assistant, {content: 'invalid'}),
          ),
      },
      execution: {
        onApproval() {
          approvals++
        },
        responderScope: 'test',
      },
      logStore: new MemorySessionLogStore(),
      toolProfile: ToolProfile.Coding,
    })
    try {
      const result = await (await agent.startRun(user())).finished
      expect(result.operations[0].status).equal('invalid')
      expect(approvals).equal(0)
    } finally {
      await agent.close()
    }
  })

  it('binds the prepared write and rechecks a changed preimage after approval', async () => {
    const file = path.join(root, 'answer.txt')
    await fs.writeFile(file, 'before')
    let calls = 0
    const agent = new Agent({
      cwd: root,
      deps: {
        createModel: () =>
          model(async () =>
            ++calls === 1
              ? call('write', {content: 'new', path: 'answer.txt'})
              : new Message(MessageType.Assistant, {content: 'changed'}),
          ),
      },
      execution: {
        async onApproval(request) {
          await fs.writeFile(file, 'other author')
          await agent.replyApproval(request.runId, {
            approve: true,
            digest: request.digest,
            requestId: request.id,
            responderScope: 'test',
          })
        },
        responderScope: 'test',
      },
      logStore: new MemorySessionLogStore(),
      toolProfile: ToolProfile.Coding,
    })
    try {
      const result = await (await agent.startRun(user())).finished
      expect(result.operations[0].status).equal('cancelled-before-start')
      expect(await fs.readFile(file, 'utf8')).equal('other author')
    } finally {
      await agent.close()
    }
  })

  it('freezes model input before asking and stores only keyed operation metadata', async () => {
    const input = {content: 'private-patch', path: 'answer.txt'}
    let calls = 0
    const journal = new MemoryExecutionJournal('session')
    const agent = new Agent({
      cwd: root,
      deps: {
        createModel: () =>
          model(async () =>
            ++calls === 1 ? call('write', input) : new Message(MessageType.Assistant, {content: 'done'}),
          ),
      },
      execution: {
        journalFactory: async () => journal,
        async onApproval(request) {
          input.content = 'tampered'
          input.path = '../escape.txt'
          await agent.replyApproval(request.runId, {
            approve: true,
            digest: request.digest,
            requestId: request.id,
            responderScope: 'test',
          })
        },
        responderScope: 'test',
      },
      logStore: new MemorySessionLogStore(),
      state: new State(new (await import('../../../src/core/session/session.js')).Session({metadata: {id: 'session'}})),
      toolProfile: ToolProfile.Coding,
    })
    try {
      expect((await (await agent.startRun(user())).finished).outcome).equal('completed')
      expect(await fs.readFile(path.join(root, 'answer.txt'), 'utf8')).equal('private-patch')
      expect(JSON.stringify(journal.records())).not.contains('private-patch')
    } finally {
      await agent.close()
    }
  })

  it('returns a normally finished failing target test to the model and completes', async () => {
    let calls = 0
    let targetResult: unknown
    const agent = new Agent({
      cwd: root,
      deps: {
        createModel: () =>
          model(async (messages) => {
            if (++calls === 1) return call('bash', {command: 'printf target-test-failed; exit 1'})
            targetResult = messages.at(-1)?.payload
            return new Message(MessageType.Assistant, {content: 'Test failed; further work is needed'})
          }),
      },
      execution: {policy: {generation: 'test', profile: 'unrestricted', roots: [root]}},
      logStore: new MemorySessionLogStore(),
      toolProfile: ToolProfile.Coding,
    })
    try {
      const result = await (await agent.startRun(user())).finished
      expect(result.outcome).equal('completed')
      expect(result.operations[0].status).equal('failed')
      expect(JSON.stringify(targetResult)).contains('target-test-failed')
      expect(calls).equal(2)
    } finally {
      await agent.close()
    }
  })

  it('orders durable admission, MCP startup approval, catalog and first model call', async () => {
    const repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
    const session = repository.create({cwd: root, id: 'session'})
    const order: string[] = []
    let journal: import('../../../src/core/execution/journal.js').ExecutionJournal | undefined
    const agent = new Agent({
      cwd: root,
      deps: {
        createMcpToolManager: (settings, options) =>
          createMcpToolManager(settings.mcp, {
            ...options,
            clientFactory: () => ({
              async callTool() {
                throw new Error('Unused')
              },
              async close() {
                order.push('close')
              },
              async connect() {
                order.push('connect')
              },
              async listTools() {
                order.push('catalog')
                return {tools: []}
              },
            }),
            transportFactory: () => ({}) as never,
          }),
        createModel: () =>
          model(async () => {
            order.push('model')
            expect(journal?.records().some((record) => record.kind === 'run-ready')).equal(true)
            return new Message(MessageType.Assistant, {content: 'done'})
          }),
      },
      execution: {
        async journalFactory() {
          journal = await (
            await import('../../../src/core/execution/journal.js')
          ).FileExecutionJournal.open('session', {
            lease: session.acquireWriterLease(),
            root: repository.journalRoot,
          })
          return journal
        },
        async onApproval(request) {
          order.push('approval')
          expect(journal?.records()[0].kind).equal('run-admitted')
          await agent.replyApproval(request.runId, {
            approve: true,
            digest: request.digest,
            requestId: request.id,
            responderScope: 'test',
          })
        },
        responderScope: 'test',
      },
      logStore: new MemorySessionLogStore(),
      settings: {mcp: {servers: {example: {command: 'fake-mcp'}}}},
      state: new State(session),
    })
    try {
      const result = await (await agent.startRun(user())).finished
      expect(result.recording).deep.equal({level: 'file-and-directory-sync', mode: 'file', status: 'acknowledged'})
      expect(order).deep.equal(['approval', 'connect', 'catalog', 'model', 'close'])
      expect(journal?.records().find((record) => record.kind === 'run-terminal')?.data.transcriptHighWater).greaterThan(
        0,
      )
    } finally {
      await agent.close()
      await session.close()
    }
  })

  it('does not start an MCP process when startup is denied', async () => {
    let connects = 0
    let models = 0
    const agent = new Agent({
      cwd: root,
      deps: {
        createMcpToolManager: (settings, options) =>
          createMcpToolManager(settings.mcp, {
            ...options,
            clientFactory() {
              connects++
              throw new Error('Forbidden')
            },
            transportFactory: () => ({}) as never,
          }),
        createModel: () =>
          model(async () => {
            models++
            return new Message(MessageType.Assistant, {content: 'unexpected'})
          }),
      },
      logStore: new MemorySessionLogStore(),
      settings: {mcp: {servers: {example: {command: 'fake-mcp'}}}},
    })
    try {
      expect((await (await agent.startRun(user())).finished).outcome).equal('failed')
      expect(connects).equal(0)
      expect(models).equal(0)
    } finally {
      await agent.close()
    }
  })

  it('resumes partial deletion while retaining a minimal marker and preventing ID reuse', async () => {
    const repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
    const session = repository.create({cwd: root, id: 'session'})
    await session.close()
    const logs = new MemorySessionLogStore()
    const original = logs.deleteSession.bind(logs)
    let attempts = 0
    logs.deleteSession = async (id) => {
      if (++attempts === 1) throw new Error('Injected log deletion failure')
      return original(id)
    }

    const service = new SessionDeletionService(repository, logs)
    await service.delete('session').then(
      () => {
        throw new Error('Unexpected deletion success')
      },
      () => {},
    )
    expect(await repository.findById('session')).not.equal(undefined)
    expect(() => repository.create({id: 'session'})).throws('deletion is recorded')
    expect(await service.delete('session')).includes({id: 'session'})
    const marker = JSON.parse(await fs.readFile(path.join(repository.journalRoot, 'deletions/session.json'), 'utf8'))
    expect(marker).deep.equal({sessionId: 'session', state: 'completed', version: 1})
  })

  it('connects a real stdio MCP child, validates calls and closes the child', async () => {
    const fixture = path.join(root, 'mcp.cjs')
    await fs.writeFile(
      fixture,
      `const fs = require('node:fs'); const readline = require('node:readline'); fs.writeFileSync(process.argv[2], String(process.pid)); readline.createInterface({input: process.stdin}).on('line', (line) => { const request = JSON.parse(line); if (request.id === undefined) return; const result = request.method === 'initialize' ? {protocolVersion: '2025-03-26', capabilities: {tools: {}}, serverInfo: {name: 'fixture', version: '1'}} : request.method === 'tools/list' ? {tools: [{name: 'ping', inputSchema: {type: 'object', properties: {text: {type: 'string'}}, required: ['text'], additionalProperties: false}}]} : {content: [{type: 'text', text: 'pong'}]}; process.stdout.write(JSON.stringify({jsonrpc: '2.0', id: request.id, result}) + '\\n'); });`,
    )
    let calls = 0
    let approvals = 0
    const agent = new Agent({
      cwd: root,
      deps: {
        createModel: () =>
          model(async () =>
            ++calls === 1
              ? call('fixture__ping', {text: 'hello'})
              : new Message(MessageType.Assistant, {content: 'done'}),
          ),
      },
      execution: {
        async onApproval(request) {
          approvals++
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
      settings: {mcp: {servers: {fixture: {args: [fixture, path.join(root, 'pid')], command: process.execPath}}}},
    })
    try {
      const result = await (await agent.startRun(user())).finished
      expect(result.outcome).equal('completed')
      expect(result.operations.map((operation) => operation.status)).deep.equal(['succeeded', 'succeeded'])
      expect(approvals).equal(2)
      const pid = Number(await fs.readFile(path.join(root, 'pid'), 'utf8'))
      expect(() => process.kill(pid, 0)).throws()
    } finally {
      await agent.close()
    }
  })

  it('bounds noncooperative MCP initialization and attempts independent close', async () => {
    let finish!: () => void
    let closes = 0
    let models = 0
    const connecting = new Promise<void>((resolve) => {
      finish = resolve
    })
    const agent = new Agent({
      cwd: root,
      deps: {
        createMcpToolManager: (settings, options) =>
          createMcpToolManager(settings.mcp, {
            ...options,
            clientFactory: () => ({
              callTool: async () => ({}),
              async close() {
                closes++
              },
              connect: async () => connecting,
              listTools: async () => ({tools: []}),
            }),
            transportFactory: () => ({}) as never,
          }),
        createModel: () =>
          model(async () => {
            models++
            return new Message(MessageType.Assistant, {content: 'unexpected'})
          }),
      },
      execution: {
        limits: {cleanupMs: 15, mcpStartupMs: 10},
        policy: {generation: 'test', profile: 'unrestricted', roots: [root]},
      },
      logStore: new MemorySessionLogStore(),
      settings: {mcp: {servers: {fixture: {command: 'fake-mcp'}}}},
    })
    const result = await (await agent.startRun(user())).finished
    expect(result.outcome).equal('incomplete')
    expect(models).equal(0)
    expect(closes).equal(1)
    finish()
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20)
    })
    await agent.supervisor.reconcileRun(result.runId, {
      confirmedStopped: true,
      operations: result.operations.map((operation) => ({id: operation.id, status: 'failed'})),
    })
    await agent.close()
  })

  it('isolates optional observers and keeps a borrowed store open', async () => {
    let closes = 0
    const store = new MemorySessionLogStore()
    store.close = async () => {
      closes++
    }

    const logger = {
      child() {
        throw new Error('observer failure')
      },
      debug() {},
      error() {},
      fatal() {},
      info() {
        throw new Error('observer failure')
      },
      isDebugEnabled: () => false,
      setDebugEnabled() {},
      trace() {},
      warn() {},
    }
    const agent = new Agent({
      cwd: root,
      deps: {createModel: () => model(async () => new Message(MessageType.Assistant, {content: 'done'}))},
      logger,
      logStore: store,
    })
    expect((await (await agent.startRun(user())).finished).outcome).equal('completed')
    const first = agent.close()
    expect(agent.close()).equal(first)
    await first
    expect(closes).equal(0)
    expect(agent.getObserverFailureCount()).greaterThan(0)
  })

  it('rejects a changed symlink after the intent acknowledgement', async () => {
    const file = path.join(root, 'answer.txt')
    const other = path.join(root, 'other.txt')
    await fs.writeFile(file, 'before')
    await fs.writeFile(other, 'keep')
    class Journal extends MemoryExecutionJournal {
      protected override async persist(record: import('../../../src/core/execution/journal.js').JournalRecord) {
        if (record.kind === 'operation-intent') {
          await fs.unlink(file)
          await fs.symlink(other, file)
        }
      }
    }
    let calls = 0
    const agent = new Agent({
      cwd: root,
      deps: {
        createModel: () =>
          model(async () =>
            ++calls === 1
              ? call('write', {content: 'replace', path: 'answer.txt'})
              : new Message(MessageType.Assistant, {content: 'changed'}),
          ),
      },
      execution: {
        journalFactory: async (session) => new Journal(session.getId()),
        policy: {generation: 'test', profile: 'unrestricted', roots: [root]},
      },
      logStore: new MemorySessionLogStore(),
      toolProfile: ToolProfile.Coding,
    })
    try {
      const result = await (await agent.startRun(user())).finished
      expect(result.operations[0].status).equal('cancelled-before-start')
      expect(await fs.readFile(other, 'utf8')).equal('keep')
    } finally {
      await agent.close()
    }
  })

  it('requires explicit legacy permission and validates MCP arguments before confirmation', async () => {
    let customCalls = 0
    const definition = {
      async execute() {
        customCalls++
        return {content: []}
      },
      input: {jsonSchema: {type: 'object'}, parse: (value: unknown) => value},
      scheduling: 'serial' as const,
      source: {id: 'legacy', kind: 'custom' as const},
      spec: {description: 'fixture', inputSchema: {type: 'object'}, name: 'legacy'},
    }
    for (const legacy of [false, true]) {
      let calls = 0
      const agent = new Agent({
        cwd: root,
        deps: {
          createModel: () =>
            model(async () =>
              ++calls === 1 ? call('legacy', {}) : new Message(MessageType.Assistant, {content: 'done'}),
            ),
        },
        execution: legacy
          ? {allowLegacyTools: true, policy: {generation: 'legacy', profile: 'unrestricted', roots: [root]}}
          : {},
        logStore: new MemorySessionLogStore(),
        toolDefinitions: [definition],
      })
      try {
        // Each policy uses a separate owner and must finish before the next case.
        // eslint-disable-next-line no-await-in-loop
        const result = await (await agent.startRun(user())).finished
        expect(result.outcome).equal(legacy ? 'completed' : 'failed')
      } finally {
        // eslint-disable-next-line no-await-in-loop
        await agent.close()
      }
    }

    expect(customCalls).equal(1)
    let modelCalls = 0
    let remoteCalls = 0
    let approvals = 0
    const agent = new Agent({
      cwd: root,
      deps: {
        createMcpToolManager: (settings, options) =>
          createMcpToolManager(settings.mcp, {
            ...options,
            clientFactory: () => ({
              async callTool() {
                remoteCalls++
                return {content: []}
              },
              async close() {},
              async connect() {},
              async listTools() {
                return {
                  tools: [
                    {
                      inputSchema: {properties: {value: {type: 'number'}}, required: ['value'], type: 'object'},
                      name: 'number',
                    },
                  ],
                }
              },
            }),
            transportFactory: () => ({}) as never,
          }),
        createModel: () =>
          model(async () =>
            ++modelCalls === 1
              ? call('schemafixture__number', {value: 'invalid'})
              : new Message(MessageType.Assistant, {content: 'invalid arguments'}),
          ),
      },
      execution: {
        async onApproval(request) {
          approvals++
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
      settings: {mcp: {servers: {schemafixture: {command: 'fixture'}}}},
    })
    try {
      const result = await (await agent.startRun(user())).finished
      expect(result.outcome).equal('completed')
      expect(result.operations.at(-1)?.status).equal('invalid')
      expect(remoteCalls).equal(0)
      expect(approvals).equal(1)
    } finally {
      await agent.close()
    }
  })
})
