// Research diagnostic only: reproduces current behavior with isolated files.
// Does not implement context projection or alter the book application.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {pathToFileURL} from 'node:url'
const root = process.env.ORBIT_ROOT
if (!root) throw new Error('Set ORBIT_ROOT to the inspected built checkout')
const o = await import(pathToFileURL(path.join(root, 'dist/index.js')))
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-cancelled-history-'))
const p = {
  provider: 'ollama',
  model: 'probe',
  revision: 'probe-characters-1',
  window: 100000,
  outputReserve: 1000,
  safetyMargin: 1000,
  trigger: 90000,
  target: 80000,
  summaryOutput: 1000,
  templateOverhead: 0,
}
const policy = {
  mode: 'budgeted',
  profile: p,
  estimator: (r) => ({
    provider: p.provider,
    model: p.model,
    kind: 'estimated',
    revision: 'chars-1',
    tokens: JSON.stringify(r).length,
    components: {characters: JSON.stringify(r).length},
  }),
}
const offline = {
  allWritersStopped: true,
  automaticRestartersDisabled: true,
  exclusiveStorageControl: true,
}
const results = []
for (const family of ['agent', 'graph'])
  for (const ending of ['approve', 'deny', 'cancel']) {
    const cwd = path.join(directory, family + '-' + ending)
    await fs.mkdir(cwd)
    await fs.writeFile(path.join(cwd, 'answer.txt'), 'original')
    const repo = new o.SessionRepository({
      rootDir: path.join(cwd, 'sessions'),
    })
    repo.initializeStorage(offline)
    const session = repo.create({cwd, formatVersion: 2})
    const logs = new o.MemorySessionLogStore()
    let calls = 0,
      prepares = 0,
      approval,
      resolveSeen
    const seen = new Promise((r) => (resolveSeen = r))
    const model = {
      getModel: () => p.model,
      getName: () => p.model,
      getProvider: () => p.provider,
      invoke: async () => {
        throw Error('Expected budgeted prepare')
      },
      prepare(messages, options) {
        prepares++
        return {
          request: {
            messages: messages.map((m) => ({
              role: m.role,
              content: m.content,
              payload: m.payload ?? null,
            })),
            tools: options.tools ?? [],
            maxOutputTokens: options.maxOutputTokens,
          },
          invoke: async () => {
            calls++
            if (calls === 1)
              return new o.Message(o.MessageType.Assistant, {
                payload: {
                  toolCalls: [
                    {
                      id: 'read-call',
                      name: 'read',
                      input: {path: 'answer.txt'},
                    },
                  ],
                },
              })
            return calls === 2
              ? new o.Message(o.MessageType.Assistant, {
                  payload: {
                    toolCalls: [
                      {
                        id: 'probe-call',
                        name: 'write',
                        input: {
                          path: 'answer.txt',
                          content: 'approved write',
                        },
                      },
                    ],
                  },
                })
              : new o.Message(o.MessageType.Assistant, {
                  content: 'Fixed response; not a quality claim',
                })
          },
        }
      },
    }
    const agent = new o.Agent({
      cwd,
      state: new o.State(session),
      logStore: logs,
      settings: {provider: p.provider, model: p.model, mcp: {servers: {}}},
      toolProfile: 'none',
      toolDefinitions: [o.createReadTool(), o.createWriteTool()],
      contextPolicy: policy,
      deps: {
        createModel: () => model,
        createMcpToolManager: () => ({
          getTools: async () => [],
          close: async () => {},
        }),
      },
      execution: {
        responderScope: 'probe',
        policy: {
          generation: 'probe',
          profile: 'workspace-confirm',
          roots: [cwd],
        },
        onApproval: (r) => {
          approval = r
          resolveSeen()
        },
      },
    })
    const graph = await o.compileProcessorGraph(
      {
        id: 'one-agent',
        entry: 'work',
        nodes: [{id: 'work', adapter: 'agent'}],
        edges: [{id: 'done', from: 'work', to: 'done'}],
        terminals: [{id: 'done', outcome: 'completed'}],
      },
      [
        {
          id: 'agent',
          version: '1',
          kind: 'agent',
          inputSchema: {},
          outputSchema: {},
        },
      ],
    )
    const start = (id, input) =>
      family === 'graph'
        ? agent.startGraphRun(graph, input, {requestId: id})
        : agent.startRun([new o.Message(o.MessageType.User, {content: input, id})], {requestId: id})
    try {
      const first = await start('first', 'Write answer.txt after approval')
      let timer
      await Promise.race([
        seen,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error('Approval not reached; timeout is failure')), 10000)
        }),
      ])
      clearTimeout(timer)
      if (ending === 'cancel') first.requestStop('user')
      if (ending !== 'cancel')
        await agent.replyApproval(first.id, {
          approve: ending === 'approve',
          requestId: approval.id,
          digest: approval.digest,
          responderScope: 'probe',
        })
      const terminal = await first.finished
      assert.equal(terminal.quiescence, true)
      assert.equal(terminal.recording.status, 'acknowledged')
      assert.equal(terminal.recording.level, 'file-and-directory-sync')
      assert.equal(terminal.outcome, ending === 'cancel' ? 'cancelled' : 'completed')
      assert.equal(
        await fs.readFile(path.join(cwd, 'answer.txt'), 'utf8'),
        ending === 'approve' ? 'approved write' : 'original',
      )
      const before = await fs.readFile(session.getFile())
      const entries = session.getEntries().length
      const invokedBefore = calls,
        preparedBefore = prepares
      const second = await start('second', 'Explain what happened; do not execute the old call')
      const next = await second.finished
      const errors = session
        .getEntries()
        .filter((e) => e.type === 'turn_event' && e.turnId === second.id && e.error)
        .map((e) => e.error.message)
      const after = await fs.readFile(session.getFile())
      assert(after.subarray(0, before.length).equals(before))
      if (ending === 'cancel') {
        assert.equal(next.outcome, 'failed')
        assert.deepEqual(errors, ['Unresolved tool call group'])
        assert.equal(calls, invokedBefore)
        assert.equal(prepares, preparedBefore)
        assert.deepEqual(next.operations, [])
      } else {
        assert.equal(next.outcome, 'completed')
        assert.equal(calls - invokedBefore, 1)
        assert.equal(prepares - preparedBefore, 1)
      }
      results.push({
        family,
        ending,
        first: terminal.outcome,
        operations: terminal.operations.map((x) => x.status),
        second: next.outcome,
        secondErrors: errors,
        newModelInvocations: calls - invokedBefore,
        newPreparations: prepares - preparedBefore,
        transcriptPrefixUnchanged: true,
        entriesBefore: entries,
        session: session.getId(),
        firstRun: first.id,
        secondRun: second.id,
      })
    } finally {
      await agent.close()
      await session.close()
      await logs.close()
    }
  }
await fs.writeFile(path.join(directory, 'results.json'), JSON.stringify(results, null, 2))
console.log(JSON.stringify({node: process.version, platform: process.platform, directory, results}, null, 2))
