// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {randomUUID} from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type {
  AgentExecutionOptions,
  AgentOptions,
  ExecutionPolicy,
  OperationPreparation,
  PreparedOperation,
  RunContext,
  ToolDefinition,
  ToolExecutionContext,
  ToolResult,
} from '../../../src/index.js'

import {
  executeManagedTool,
  executePrepared,
  MemoryExecutionJournal,
  OperationExecutor,
  RunSupervisor,
} from '../../../src/index.js'

const policy: ExecutionPolicy = {generation: 'test', profile: 'unrestricted', roots: []}
const success: ToolResult = {content: [{text: 'done', type: 'text'}]}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return {promise, resolve}
}

function operation(run: RunContext, cwd: string, execute: OperationPreparation['execute'], server?: string) {
  const preparation: OperationPreparation = {
    binding: server ? {server} : {},
    effect: server ? 'mcp' : 'command',
    execute,
    preview: {command: 'fixture'},
    revalidate: async () => true,
    targets: [],
  }
  const descriptor: PreparedOperation = {
    binding: preparation.binding,
    cwd,
    effect: preparation.effect,
    id: randomUUID(),
    input: {},
    name: server ?? 'fixture',
    preview: preparation.preview,
    runId: run.id,
    sessionId: run.options.sessionId,
    targets: preparation.targets,
    variant: server ? 'mcp-startup' : 'tool-call',
    version: 1,
  }
  return {descriptor, preparation}
}

function definition(prepare: NonNullable<ToolDefinition['prepare']>): ToolDefinition {
  return {
    async execute() {
      throw new Error('Prepared execution must be used')
    },
    input: {jsonSchema: {}, parse: (input) => input},
    prepare,
    scheduling: 'serial',
    source: {id: 'fixture', kind: 'custom'},
    spec: {description: 'Fixture', inputSchema: {}, name: 'fixture'},
  }
}

describe('public OperationExecutor', () => {
  let root: string
  const supervisors: RunSupervisor[] = []

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-executor-'))
  })

  afterEach(async () => {
    await Promise.all(supervisors.splice(0).map((supervisor) => supervisor.close()))
    await fs.rm(root, {force: true, recursive: true})
  })
  function start(execute: (run: RunContext) => Promise<unknown>, extra = {}) {
    const supervisor = new RunSupervisor()
    supervisors.push(supervisor)
    const sessionId = randomUUID()
    const journal = new MemoryExecutionJournal(sessionId)
    return {
      handle: supervisor.startRun({
        configuration: {},
        async execute(run) {
          await run.ready([])
          return execute(run)
        },
        input: {},
        journal: async () => journal,
        requestId: randomUUID(),
        sessionId,
        ...extra,
      }),
      journal,
      supervisor,
    }
  }

  it('exports reusable Agent execution settings without changing the option shape', () => {
    const execution: AgentExecutionOptions = {limits: {toolRequests: 3}, policy}
    const options: AgentOptions = {execution}
    expect(options.execution).equal(execution)
  })

  for (const legacy of [false, true]) {
    it(`preserves preparation, approval, intent and settlement with ${legacy ? 'legacy functions' : 'the executor'}`, async () => {
      const order: string[] = []
      const runPolicy: ExecutionPolicy = {generation: 'test', profile: 'workspace-confirm', roots: [root]}
      const fixture = start(
        async (run) => {
          const tool = definition(async () => {
            order.push('prepare')
            return {
              binding: {},
              effect: 'command',
              async execute() {
                order.push('execute')
                expect(run.journal.records().at(-1)?.kind).equal('operation-intent')
                return success
              },
              preview: {command: 'fixture'},
              revalidate: async () => true,
              targets: [],
            }
          })
          const context: ToolExecutionContext = {callId: 'call', cwd: root, emitUpdate() {}, signal: run.signal}
          const options = {
            onToolSettled() {
              order.push('settled')
            },
            policy: runPolicy,
          }
          const result = legacy
            ? await executeManagedTool(run, tool, {}, context, options)
            : await new OperationExecutor(run, options).executeTool(tool, {}, context)
          expect(result).deep.equal(success)
        },
        {
          async onApproval(request: Parameters<NonNullable<AgentExecutionOptions['onApproval']>>[0]) {
            order.push('approve')
            await fixture.supervisor.replyApproval(request.runId, {
              approve: true,
              digest: request.digest,
              requestId: request.id,
              responderScope: 'owner',
            })
          },
          responderScope: 'owner',
        },
      )
      const handle = await fixture.handle
      expect((await handle.finished).operations[0].status).equal('succeeded')
      expect(order).deep.equal(['prepare', 'approve', 'execute', 'settled'])
    })
  }

  it('denies effects when approval is unavailable', async () => {
    let dispatched = false
    const fixture = start(async (run) => {
      const {descriptor, preparation} = operation(run, root, async () => {
        dispatched = true
        return success
      })
      await new OperationExecutor(run, {
        policy: {...policy, profile: 'workspace-confirm', roots: [root]},
      }).executePrepared(descriptor, preparation)
    })
    expect((await (await fixture.handle).finished).operations[0].status).equal('denied')
    expect(dispatched).equal(false)
  })

  for (const server of [undefined, 'shared-mcp']) {
    it(`shares ${server ? 'MCP identity' : 'overlapping workspace'} ownership across new and legacy callers`, async () => {
      const acquired = deferred<void>()
      const release = deferred<void>()
      const owner = start(async (run) => {
        const {descriptor, preparation} = operation(
          run,
          root,
          async () => {
            acquired.resolve()
            return success
          },
          server,
        )
        await new OperationExecutor(run, {policy}).executePrepared(descriptor, preparation)
        await release.promise
      })
      const ownerHandle = await owner.handle
      try {
        await Promise.race([
          acquired.promise,
          ownerHandle.finished.then((result) => {
            throw new Error(result.reason)
          }),
        ])
        const tryLegacy = async () => {
          let dispatched = false
          const other = start(async (run) => {
            const cwd = server ? `${root}-other` : path.join(root, 'child')
            const {descriptor, preparation} = operation(
              run,
              cwd,
              async () => {
                dispatched = true
                return success
              },
              server,
            )
            await executePrepared(run, descriptor, preparation, policy)
          })
          return {dispatched: () => dispatched, result: await (await other.handle).finished}
        }

        const conflict = await tryLegacy()
        expect(conflict.result.operations[0].status).equal('cancelled-before-start')
        expect(conflict.dispatched()).equal(false)
        release.resolve()
        await ownerHandle.finished
        const afterRelease = await tryLegacy()
        expect(afterRelease.result.operations[0].status).equal('succeeded')
        expect(afterRelease.dispatched()).equal(true)
      } finally {
        release.resolve()
        await ownerHandle.finished
      }
    })
  }

  it('retains unknown effects across executors until explicit reconciliation', async () => {
    let operationId = ''
    const owner = start(async (run) => {
      const {descriptor, preparation} = operation(run, root, async () => {
        throw new Error('Response lost')
      })
      operationId = descriptor.id
      await new OperationExecutor(run, {policy}).executePrepared(descriptor, preparation)
    })
    const ownerHandle = await owner.handle
    expect((await ownerHandle.finished).outcome).equal('incomplete')
    try {
      const other = start(async (run) => {
        const {descriptor, preparation} = operation(run, root, async () => success)
        await executePrepared(run, descriptor, preparation, policy)
      })
      expect((await (await other.handle).finished).operations[0].status).equal('cancelled-before-start')
    } finally {
      await owner.supervisor.reconcileRun(ownerHandle.id, {
        confirmedStopped: true,
        operations: [{id: operationId, status: 'failed'}],
      })
    }

    const retry = start(async (run) => {
      const {descriptor, preparation} = operation(run, root, async () => success)
      await new OperationExecutor(run, {policy}).executePrepared(descriptor, preparation)
    })
    expect((await (await retry.handle).finished).operations[0].status).equal('succeeded')
  })

  it('refuses retained executors and compatibility calls before preparation after terminal completion', async () => {
    let executor!: OperationExecutor
    let context!: RunContext
    const fixture = start(async (run) => {
      context = run
      executor = new OperationExecutor(run, {policy})
    })
    await (
      await fixture.handle
    ).finished
    const before = fixture.journal.records().length
    let preparations = 0
    const tool = definition(async () => {
      preparations++
      throw new Error('Must not prepare')
    })
    const toolContext = {callId: 'late', cwd: root, emitUpdate() {}, signal: context.signal}
    const {descriptor, preparation} = operation(context, root, async () => success)
    const calls = [
      () => executor.executeTool(tool, {}, toolContext),
      () => executor.executePrepared(descriptor, preparation),
      () => executeManagedTool(context, tool, {}, toolContext, {policy}),
      () => executePrepared(context, descriptor, preparation, policy),
    ]
    for (const call of calls) {
      // Exercise each API separately against the same terminal Run.
      // eslint-disable-next-line no-await-in-loop
      const result = await call().then(
        () => {},
        (error: Error) => error,
      )
      expect(result?.message).equal('already-terminal')
    }

    expect(preparations).equal(0)
    expect(fixture.journal.records()).length(before)
  })
})
