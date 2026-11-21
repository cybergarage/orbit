// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {createHash, randomUUID} from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type {
  AgentExecutionOptions,
  AgentOptions,
  BuiltinToolName,
  ExecutionPolicy,
  OperationPreparation,
  PreparedOperation,
  PreparedWorkspaceCommand,
  PreparedWorkspaceOperation,
  RunContext,
  ToolDefinition,
  ToolExecutionContext,
  ToolResult,
  WorkspaceCommandOutcome,
  WorkspaceCommandProfile,
  WorkspaceExecutor,
} from '../../../src/index.js'

import {recoveredRunSnapshot} from '../../../src/core/execution/run.js'
import {observationProvenance} from '../../../src/core/tools/observation-provenance.js'
import {
  createBuiltinTools,
  createReadTool,
  createWriteTool,
  executeManagedTool,
  executePrepared,
  MemoryExecutionJournal,
  OperationExecutor,
  RunSupervisor,
  ToolRegistry,
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

const commandProfile = (): WorkspaceCommandProfile => ({
  backend: 'synthetic-runner',
  id: 'read-only-fixture',
  maxResultBytes: 2048,
  network: 'none',
  revision: `sha256:${'a'.repeat(64)}`,
  timeoutMs: 5000,
  workspace: 'read-only',
})

describe('public OperationExecutor', () => {
  let root: string
  const supervisors: RunSupervisor[] = []

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-executor-')))
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

  it('binds the trusted command profile and exact budget, requires approval and records checked nonzero exit', async () => {
    const configured = commandProfile()
    const checks: PreparedWorkspaceCommand[] = []
    const calls: PreparedWorkspaceCommand[] = []
    const decisions: Readonly<PreparedOperation>[] = []
    const previews: Array<Record<string, unknown>> = []
    const [bash] = createBuiltinTools({include: ['bash']})
    const owner = start(
      async (run) => {
        const executor = new OperationExecutor(run, {
          policy: {
            ...policy,
            decide(operation) {
              decisions.push(operation)
              return 'allow'
            },
          },
          workspaceExecutor: {
            command: {
              async execute(prepared, signal) {
                expect(run.journal.records().at(-1)?.kind).equal('operation-intent')
                expect(signal.aborted).equal(false)
                calls.push(prepared)
                return {exitCode: 4, status: 'exited', stderr: 'fixture', stdout: '', text: 'checked exit'}
              },
              profile: configured,
              revalidate(prepared) {
                checks.push(prepared)
                return true
              },
            },
            async execute() {
              throw new Error('Generic dispatch must not run')
            },
            toolNames: ['bash'],
          },
        })
        Object.assign(configured, {timeoutMs: 1, workspace: 'read-write'})
        const result = await executor.executeTool(
          bash,
          {command: "printf 'fixture'", profile: {workspace: 'read-write'}, timeoutSeconds: 1.001},
          {callId: 'fixture', cwd: root, emitUpdate() {}, groupId: 'group', signal: run.signal},
        )
        expect(result.isError).equal(true)
        expect(result.details).include({exitCode: 4, timedOut: false})
        expect(observationProvenance(result)?.adapter).equal('workspace-command-bash-v1')
      },
      {
        async onApproval(request: Parameters<NonNullable<AgentExecutionOptions['onApproval']>>[0]) {
          previews.push(request.preview)
          await owner.supervisor.replyApproval(request.runId, {
            approve: true,
            digest: request.digest,
            requestId: request.id,
            responderScope: 'owner',
          })
        },
        responderScope: 'owner',
      },
    )
    const finished = await (await owner.handle).finished
    expect(finished.operations.map((entry) => entry.status)).deep.equal(['failed'])
    expect(checks.length).equal(2)
    expect(calls).deep.equal([checks[0]])
    const prepared = calls[0]
    expect(prepared).include({cwd: root, effect: 'command', target: root, timeoutMs: 1001})
    expect(prepared.input).deep.equal({command: "printf 'fixture'", timeoutSeconds: 1.001})
    expect(Object.isFrozen(prepared)).equal(true)
    expect(Object.isFrozen(prepared.profile)).equal(true)
    expect(previews[0]).include({cwd: root, timeoutSeconds: 1.001})
    expect(previews[0].commandProfile).deep.equal(commandProfile())
    expect(decisions[0].binding.command).deep.equal(prepared)
    expect(owner.journal.records().find((record) => record.kind === 'authorization-decided')?.data.digest).equal(
      owner.journal.records().find((record) => record.kind === 'operation-intent')?.data.digest,
    )
  })

  it('refuses stale, denied and over-budget command requests before dispatch, without fallback', async () => {
    const [bash] = createBuiltinTools({include: ['bash']})
    let checks = 0
    let approvals = 0
    let dispatches = 0
    const owner = start(
      async (run) => {
        const executor = new OperationExecutor(run, {
          policy,
          workspaceExecutor: {
            command: {
              async execute() {
                dispatches++
                return {status: 'unknown'}
              },
              profile: commandProfile(),
              revalidate() {
                return ++checks === 1
              },
            },
            async execute() {
              dispatches++
              return success
            },
            toolNames: ['bash'],
          },
        })
        const context = {callId: 'fixture', cwd: root, emitUpdate() {}, signal: run.signal}
        expect(
          (await executor.executeTool(bash, {command: 'printf fixture', timeoutSeconds: 6}, context)).isError,
        ).equal(true)
        expect((await executor.executeTool(bash, {command: 'printf fixture'}, context)).isError).equal(true)
        expect((await executor.executeTool(bash, {command: 'printf fixture'}, context)).isError).equal(true)
      },
      {
        async onApproval(request: Parameters<NonNullable<AgentExecutionOptions['onApproval']>>[0]) {
          await owner.supervisor.replyApproval(request.runId, {
            approve: ++approvals === 1,
            digest: request.digest,
            requestId: request.id,
            responderScope: 'owner',
          })
        },
        responderScope: 'owner',
      },
    )
    expect((await (await owner.handle).finished).operations.map((entry) => entry.status)).deep.equal([
      'invalid',
      'cancelled-before-start',
      'denied',
    ])
    expect(checks).equal(2)
    expect(dispatches).equal(0)
    expect(owner.journal.records().filter((record) => record.kind === 'operation-intent').length).equal(1)
  })

  it('retains unknown status on command timeout, and recovery does not execute it again', async () => {
    const [bash] = createBuiltinTools({include: ['bash']})
    let count = 0
    let signalSeen: AbortSignal | undefined
    const late = deferred<WorkspaceCommandOutcome>()
    const requestId = randomUUID()
    const owner = start(
      async (run) => {
        const executor = new OperationExecutor(run, {
          policy,
          workspaceExecutor: {
            command: {
              execute(_operation, signal) {
                count++
                signalSeen = signal
                return late.promise
              },
              profile: {...commandProfile(), timeoutMs: 20},
              revalidate: () => true,
            },
            async execute() {
              throw new Error('Do not fall back')
            },
            toolNames: ['bash'],
          },
        })
        return executor.executeTool(
          bash,
          {command: 'printf fixture'},
          {
            callId: 'fixture',
            cwd: root,
            emitUpdate() {},
            signal: run.signal,
          },
        )
      },
      {
        limits: {cleanupMs: 100},
        async onApproval(request: Parameters<NonNullable<AgentExecutionOptions['onApproval']>>[0]) {
          await owner.supervisor.replyApproval(request.runId, {
            approve: true,
            digest: request.digest,
            requestId: request.id,
            responderScope: 'owner',
          })
        },
        requestId,
        responderScope: 'owner',
      },
    )
    try {
      const handle = await owner.handle
      const result = await handle.finished
      expect(result.operations.map((entry) => entry.status)).deep.equal(['unknown'])
      expect(signalSeen?.aborted).equal(true)
      expect(
        recoveredRunSnapshot(result.runId, result.sessionId, owner.journal.records(), {level: 'memory', mode: 'memory'})
          .result?.operations[0]?.status,
      ).equal('unknown')
      const recoveredSupervisor = new RunSupervisor()
      supervisors.push(recoveredSupervisor)
      const recovered = await recoveredSupervisor.startRun({
        configuration: {},
        async execute() {
          count++
          throw new Error('Recovery must not dispatch')
        },
        input: {},
        journal: async () => owner.journal,
        requestId,
        sessionId: result.sessionId,
      })
      expect((await recovered.finished).operations[0]?.status).equal('unknown')
      expect(count).equal(1)
    } finally {
      late.resolve({exitCode: 0, status: 'exited', stderr: '', stdout: '', text: 'too late'})
    }
  }).timeout(10_000)

  it('routes all managed coding tools through the injected executor with approved, bounded input', async () => {
    const registry = new ToolRegistry()
    for (const builtin of createBuiltinTools({profile: 'coding'})) registry.register(builtin)
    const snapshot = registry.snapshot()
    const target = path.join(root, 'fixture.txt')
    await fs.writeFile(target, 'original fixture')
    const calls: PreparedWorkspaceOperation[] = []
    let approvals = 0
    const workspaceExecutor: WorkspaceExecutor = {
      async execute(operation, signal) {
        calls.push(operation)
        expect(Object.isFrozen(operation)).equal(true)
        expect(Object.isFrozen(operation.input)).equal(true)
        expect(operation.cwd).equal(root)
        expect(signal.aborted).equal(false)
        expect(operation).not.to.have.any.keys('environment', 'sessionId', 'authorization')
        if (operation.name === 'glob' && Array.isArray(operation.input.pattern))
          expect(Object.isFrozen(operation.input.pattern)).equal(true)
        if (operation.effect === 'write') {
          expect(operation.preimageSha256).equal(createHash('sha256').update('original fixture').digest('hex'))
          expect(operation.resultSha256).equal(createHash('sha256').update('changed fixture').digest('hex'))
        }

        return success
      },
    }
    const fixtures: Array<[BuiltinToolName, object]> = [
      ['bash', {command: 'printf fixture'}],
      ['read', {limit: 1, path: 'fixture.txt'}],
      ['write', {content: 'changed fixture', path: 'fixture.txt'}],
      ['edit', {newText: 'changed', oldText: 'original', path: 'fixture.txt'}],
      ['list', {}],
      ['glob', {pattern: ['*.txt']}],
      ['grep', {pattern: 'fixture'}],
    ]
    const owner = start(
      async (run) => {
        const executor = new OperationExecutor(run, {
          policy: {generation: 'inject-test', profile: 'workspace-confirm', roots: [root]},
          workspaceExecutor,
        })
        for (const [name, input] of fixtures) {
          // Exercise each prepared operation in one run, preserving mutation barriers.
          // eslint-disable-next-line no-await-in-loop
          const result = await executor.executeTool(snapshot.get(name)!, input, {
            callId: name,
            cwd: root,
            emitUpdate() {},
            signal: run.signal,
          })
          expect(result).deep.equal(success)
        }
      },
      {
        async onApproval(request: Parameters<NonNullable<AgentExecutionOptions['onApproval']>>[0]) {
          approvals++
          await owner.supervisor.replyApproval(request.runId, {
            approve: true,
            digest: request.digest,
            requestId: request.id,
            responderScope: 'owner',
          })
        },
        responderScope: 'owner',
      },
    )
    const run = await (await owner.handle).finished
    expect(run.operations.map((op) => op.status)).deep.equal(Array.from({length: 7}, () => 'succeeded'))
    expect(calls.map((call) => call.name)).deep.equal(fixtures.map(([name]) => name))
    expect(calls.map((call) => call.target)).deep.equal([root, target, target, target, root, root, root])
    expect(calls[1].input).deep.equal({limit: 1, path: target})
    expect(approvals).equal(3)
    expect(owner.journal.records().filter((record) => record.kind === 'operation-intent')).to.have.length(7)
    expect(await fs.readFile(target, 'utf8')).equal('original fixture')
  })

  it('routes only the frozen selection with the same approval and observation behavior', async () => {
    const target = path.join(root, 'scoped.txt')
    await fs.writeFile(target, 'local fixture')
    const calls: string[] = []
    const approvals: string[] = []
    const toolNames: Array<PreparedWorkspaceOperation['name']> = ['write', 'edit']
    const owner = start(
      async (run) => {
        const executor = new OperationExecutor(run, {
          policy: {generation: 'scoped-fixture', profile: 'workspace-confirm', roots: [root]},
          workspaceExecutor: {
            async execute(operation) {
              calls.push(operation.name)
              expect(run.journal.records().at(-1)?.kind).equal('operation-intent')
              return success
            },
            toolNames,
          },
        })
        toolNames.splice(0, 2, 'read')
        const context = {callId: 'fixture', cwd: root, emitUpdate() {}, groupId: 'group', signal: run.signal}
        const fixtures: Array<[BuiltinToolName, object, string]> = [
          ['read', {path: target}, 'local fixture'],
          ['list', {}, 'scoped.txt'],
          ['glob', {pattern: '*.txt'}, 'scoped.txt'],
          ['grep', {pattern: 'local'}, 'local fixture'],
          ['bash', {command: "printf '%s' 'local shell'"}, 'local shell'],
        ]
        for (const [name, input, expected] of fixtures) {
          const [tool] = createBuiltinTools({include: [name]})
          // Serialize calls so each intent/settlement is observable in order.
          // eslint-disable-next-line no-await-in-loop
          const result = await executor.executeTool(tool, input, {...context, callId: name})
          expect(JSON.stringify(result.content)).includes(expected)
          if (name === 'bash') expect(observationProvenance(result)?.adapter).equal('builtin-bash-v1')
        }

        const write = await executor.executeTool(
          createWriteTool(),
          {content: 'prepared fixture', path: target},
          context,
        )
        expect(write).deep.equal(success)
        expect(observationProvenance(write)).equal(undefined)
        const [edit] = createBuiltinTools({include: ['edit']})
        const edited = await executor.executeTool(edit, {newText: 'prepared', oldText: 'local', path: target}, context)
        expect(edited).deep.equal(success)
        expect(observationProvenance(edited)).equal(undefined)
      },
      {
        async onApproval(request: Parameters<NonNullable<AgentExecutionOptions['onApproval']>>[0]) {
          approvals.push(String(request.preview.name))
          await owner.supervisor.replyApproval(request.runId, {
            approve: true,
            digest: request.digest,
            requestId: request.id,
            responderScope: 'owner',
          })
        },
        responderScope: 'owner',
      },
    )
    const finished = await (await owner.handle).finished
    expect(finished.operations.map((operation) => operation.status)).deep.equal(
      Array.from({length: 7}).fill('succeeded'),
    )
    expect(approvals).deep.equal(['bash', 'write', 'edit'])
    expect(calls).deep.equal(['write', 'edit'])
    expect(await fs.readFile(target, 'utf8')).equal('local fixture')
  })

  it('an empty selection is the existing local-only route', async () => {
    const target = path.join(root, 'local.txt')
    const owner = start(async (run) => {
      const executor = new OperationExecutor(run, {
        policy,
        workspaceExecutor: {
          async execute() {
            throw new Error('No managed tool is selected')
          },
          toolNames: [],
        },
      })
      await executor.executeTool(
        createWriteTool(),
        {content: 'local', path: target},
        {
          callId: 'local',
          cwd: root,
          emitUpdate() {},
          signal: run.signal,
        },
      )
    })
    expect((await (await owner.handle).finished).outcome).equal('completed')
    expect(await fs.readFile(target, 'utf8')).equal('local')
  })

  it('rejects an invalid or duplicated trusted tool selection before dispatch', async () => {
    const owner = start(async (run) => {
      for (const toolNames of [['write', 'write'], ['unknown'], true]) {
        const workspaceExecutor = {execute: async () => success, toolNames} as unknown as WorkspaceExecutor
        expect(() => new OperationExecutor(run, {policy, workspaceExecutor})).to.throw(
          'Invalid workspace executor tool names',
        )
      }
    })
    expect((await (await owner.handle).finished).outcome).equal('completed')
  })

  it('does not dispatch denied or stale writes or out-of-scope reads to the workspace executor', async () => {
    const target = path.join(root, 'fixture.txt')
    await fs.writeFile(target, 'original fixture')
    let calls = 0
    const workspaceExecutor: WorkspaceExecutor = {
      async execute() {
        calls++
        return success
      },
      toolNames: ['read', 'write'],
    }
    const owner = start(
      async (run) => {
        const executor = new OperationExecutor(run, {
          policy: {generation: 'inject-test', profile: 'workspace-confirm', roots: [root]},
          workspaceExecutor,
        })
        const context = {callId: 'fixture', cwd: root, emitUpdate() {}, signal: run.signal}
        await executor.executeTool(createReadTool(), {path: path.dirname(root)}, context)
        await executor.executeTool(createWriteTool(), {content: 'change', path: target}, context)
        await executor.executeTool(createWriteTool(), {content: 'denied', path: target}, context)
      },
      {
        async onApproval(request: Parameters<NonNullable<AgentExecutionOptions['onApproval']>>[0]) {
          const approve = (await fs.readFile(target, 'utf8')) === 'original fixture'
          if (approve) await fs.writeFile(target, 'owner changed fixture')
          await owner.supervisor.replyApproval(request.runId, {
            approve,
            digest: request.digest,
            requestId: request.id,
            responderScope: 'owner',
          })
        },
        responderScope: 'owner',
      },
    )
    expect((await (await owner.handle).finished).operations.map((op) => op.status)).deep.equal([
      'invalid',
      'cancelled-before-start',
      'denied',
    ])
    expect(calls).equal(0)
    expect(await fs.readFile(target, 'utf8')).equal('owner changed fixture')
  })

  it('does not delegate similarly named custom tools or change the default handler', async () => {
    let calls = 0
    const file = path.join(root, 'original.txt')
    await fs.writeFile(file, 'local file fixture')
    const custom = definition(async () => ({
      binding: {},
      effect: 'read',
      async execute() {
        return success
      },
      preview: {},
      revalidate: async () => true,
      targets: [file],
    }))
    custom.spec.name = 'read'
    const fixture = start(async (run) => {
      const context = {callId: 'fixture', cwd: root, emitUpdate() {}, signal: run.signal}
      const injected = new OperationExecutor(run, {
        policy,
        workspaceExecutor: {
          async execute() {
            calls++
            return success
          },
          toolNames: ['read'],
        },
      })
      const local = new OperationExecutor(run, {policy})
      expect(await injected.executeTool(custom, {}, context)).deep.equal(success)
      const result = await local.executeTool(createReadTool(), {path: file}, context)
      expect(result.content).deep.equal([{text: 'local file fixture', type: 'text'}])
    })
    expect((await (await fixture.handle).finished).outcome).equal('completed')
    expect(calls).equal(0)
  })

  it('rejects oversized workspace requests before dispatch and treats uncertain dispatch as unknown without fallback', async () => {
    const destination = path.join(root, 'not-created.txt')
    let calls = 0
    const fixture = start(async (run) => {
      const executor = new OperationExecutor(run, {
        policy,
        workspaceExecutor: {
          async execute() {
            calls++
            throw new Error('Fixture settlement unavailable')
          },
          toolNames: ['write'],
        },
      })
      const context = {callId: 'fixture', cwd: root, emitUpdate() {}, signal: run.signal}
      await executor.executeTool(createWriteTool(), {content: 'a'.repeat(1024 * 1024), path: destination}, context)
      await executor.executeTool(createWriteTool(), {content: 'fixture', path: destination}, context)
    })
    const handle = await fixture.handle
    const result = await handle.finished
    try {
      expect(result.outcome).equal('incomplete')
      expect(result.operations.map((op) => op.status)).deep.equal(['invalid', 'unknown'])
      expect(calls).equal(1)
      expect(await fs.stat(destination).catch(() => {})).equal(undefined)
    } finally {
      await fixture.supervisor.reconcileRun(handle.id, {
        confirmedStopped: true,
        operations: [{id: result.operations.at(-1)!.id, status: 'failed'}],
      })
    }
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
