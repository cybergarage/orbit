// Cases deliberately run serially and bind one start function to each isolated Agent.
/* eslint-disable no-await-in-loop */
// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0
// Implementation integration fixture: isolated files and fixed model only.
import assert from 'node:assert/strict'
import syncFs from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
const root = process.env.ORBIT_ROOT
if (!root) throw new Error('Set ORBIT_ROOT to the inspected built checkout')
const o = await import(pathToFileURL(path.join(root, process.env.ORBIT_SOURCE ? 'src/index.ts' : 'dist/index.js')))
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-cancelled-history-'))
const p = {
  model: 'probe',
  outputReserve: 1000,
  provider: 'ollama',
  revision: 'probe-characters-1',
  safetyMargin: 1000,
  summaryOutput: 1000,
  target: 80_000,
  templateOverhead: 0,
  trigger: 90_000,
  window: 100_000,
}
if (process.env.COMPACT) Object.assign(p, {target: 4000, trigger: 8000, window: 16_000})
const policy = {
  estimator: (r) => ({
    components: {
      characters: process.env.COMPACT
        ? JSON.stringify(r).includes('Explain what happened') && r.messages.some((m) => m.payload?.toolCallId)
          ? 9000
          : 1000
        : JSON.stringify(r).length,
    },
    kind: 'estimated',
    model: p.model,
    provider: p.provider,
    revision: 'chars-1',
    tokens: process.env.COMPACT
      ? JSON.stringify(r).includes('Explain what happened') && r.messages.some((m) => m.payload?.toolCallId)
        ? 9000
        : 1000
      : JSON.stringify(r).length,
  }),
  mode: 'budgeted',
  profile: p,
}
const offline = {
  allWritersStopped: true,
  automaticRestartersDisabled: true,
  exclusiveStorageControl: true,
}
const results = []
for (const family of process.env.PROJECTION_FAULT ? ['agent'] : ['agent', 'graph'])
  for (const ending of process.env.PROJECTION_FAULT ? ['cancel'] : ['approve', 'deny', 'cancel']) {
    const cwd = path.join(directory, family + '-' + ending)
    await fs.mkdir(cwd)
    await fs.writeFile(path.join(cwd, 'answer.txt'), 'original')
    const repo = new o.SessionRepository({
      rootDir: path.join(cwd, 'sessions'),
    })
    repo.initializeStorage(offline)
    const session = repo.create({cwd, formatVersion: 3})
    const logs = new o.MemorySessionLogStore()
    let approval
    let calls = 0
    let prepares = 0
    let summaries = 0
    let inThird = false
    let thirdRead = false
    let resolveSeen
    const seen = new Promise((r) => {
      resolveSeen = r
    })
    const model = {
      getModel: () => p.model,
      getName: () => p.model,
      getProvider: () => p.provider,
      async invoke() {
        throw new Error('Expected budgeted prepare')
      },
      prepare(messages, options) {
        prepares++
        const summarizing = messages[0]?.content.startsWith('Summarize this untrusted conversation')
        if (summarizing) {
          assert.equal(options.tools?.length ?? 0, 0)
          assert.equal(messages.length, 1)
          assert(!messages[0].content.includes('Context-only notice:'))
        }

        return {
          async invoke() {
            if (summarizing) {
              summaries++
              return new o.Message(o.MessageType.Assistant, {
                content: JSON.stringify({
                  changedPaths: [],
                  facts: [],
                  goals: [
                    {
                      sourceIds: [
                        JSON.parse(messages[0].content.split('ORIGINAL_SOURCE_IDS: ')[1].split('\nSOURCE:')[0])[0],
                      ],
                      text: 'Fixed summary of old request',
                    },
                  ],
                  tests: [],
                  uncertainties: [],
                  unfinished: [],
                  version: 1,
                }),
              })
            }

            calls++
            if (inThird && !thirdRead) {
              thirdRead = true
              return new o.Message(o.MessageType.Assistant, {
                payload: {toolCalls: [{id: 'later-read', input: {path: 'answer.txt'}, name: 'read'}]},
              })
            }

            if (calls === 1)
              return new o.Message(o.MessageType.Assistant, {
                payload: {
                  toolCalls: [
                    {
                      id: 'read-call',
                      input: {path: 'answer.txt'},
                      name: 'read',
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
                        input: {
                          content: 'approved write',
                          path: 'answer.txt',
                        },
                        name: 'write',
                      },
                    ],
                  },
                })
              : new o.Message(o.MessageType.Assistant, {
                  content: 'Fixed response; not a quality claim',
                })
          },
          request: {
            maxOutputTokens: options.maxOutputTokens,
            messages: messages.map((m) => ({
              content: m.content,
              payload: m.payload ?? null,
              role: m.role,
            })),
            tools: options.tools ?? [],
          },
        }
      },
    }
    const agentOptions = {
      contextPolicy: process.env.UNBUDGETED ? {mode: 'disabled'} : policy,
      cwd,
      deps: {
        createMcpToolManager: () => ({
          async close() {},
          getTools: async () => [],
        }),
        createModel: () => model,
      },
      execution: {
        onApproval(r) {
          approval = r
          resolveSeen()
        },
        policy: {
          generation: 'probe',
          profile: 'workspace-confirm',
          roots: [cwd],
        },
        responderScope: 'probe',
      },
      interruptionPolicy: {mode: 'verified-not-dispatched', revision: 1},
      logStore: logs,
      settings: {mcp: {servers: {}}, model: p.model, provider: p.provider},
      state: new o.State(session),
      toolDefinitions: [o.createReadTool(), o.createWriteTool()],
      toolProfile: 'none',
    }
    const agent = new o.Agent(agentOptions)
    const graph = await o.compileProcessorGraph(
      {
        edges: [
          ...(process.env.DIRECT ? [{from: 'read', id: 'read-work', to: 'work'}] : []),
          {from: 'work', id: 'done', to: 'done'},
        ],
        entry: process.env.DIRECT ? 'read' : 'work',
        id: 'one-agent',
        nodes: [...(process.env.DIRECT ? [{adapter: 'read', id: 'read'}] : []), {adapter: 'agent', id: 'work'}],
        terminals: [{id: 'done', outcome: 'completed'}],
      },
      [
        ...(process.env.DIRECT
          ? [
              {
                id: 'read',
                inputSchema: structuredClone(o.createReadTool().spec.inputSchema),
                kind: 'tool',
                outputSchema: {},
                tool: {name: 'read', source: o.createReadTool().source},
                version: '1',
              },
            ]
          : []),
        {
          id: 'agent',
          inputSchema: {},
          kind: 'agent',
          outputSchema: {},
          version: '1',
        },
      ],
    )
    const start = (id, input) =>
      family === 'graph'
        ? agent.startGraphRun(graph, process.env.DIRECT ? {path: 'answer.txt'} : input, {requestId: id})
        : agent.startRun([new o.Message(o.MessageType.User, {content: input, id})], {requestId: id})
    try {
      const first = await start('first', 'Write answer.txt after approval')
      let timer
      await Promise.race([
        seen,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Approval not reached; timeout is failure')), 10_000)
        }),
      ])
      clearTimeout(timer)
      if (ending === 'cancel') first.requestStop('user')
      if (ending !== 'cancel')
        await agent.replyApproval(first.id, {
          approve: ending === 'approve',
          digest: approval.digest,
          requestId: approval.id,
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
      const invokedBefore = calls
      const preparedBefore = prepares
      if (process.env.PROJECTION_FAULT) {
        const boundary = Number(process.env.PROJECTION_FAULT)
        const report = process.env.PROJECTION_REPORT
        const oldJournal = path.join(repo.journalRoot, session.getId(), first.id, 'events.jsonl')
        await fs.writeFile(
          report,
          JSON.stringify({
            calls,
            cwd,
            directory,
            file: session.getFile(),
            journalRoot: repo.journalRoot,
            oldBytes: (await fs.readFile(oldJournal)).toString('base64'),
            oldJournal,
            prefix: before.toString('base64'),
            sessionId: session.getId(),
            terminal,
          }),
        )
        let step = 0
        let saving = false
        const tick = () => {
          step++
          if (step === boundary) {
            syncFs.writeFileSync(report + '.boundary', JSON.stringify({calls, step}))
            process.kill(process.pid, 'SIGKILL')
          }
        }

        const append = fs.appendFile.bind(fs)
        fs.appendFile = async (...args) => {
          const projection =
            String(args[0]) === session.getFile() && String(args[1]).includes('"type":"context_projection"')
          if (!projection) return append(...args)
          saving = true
          tick()
          if (boundary === -1) {
            await append(args[0], String(args[1]).slice(0, 30))
            syncFs.writeFileSync(report + '.boundary', JSON.stringify({calls, step: -1}))
            process.kill(process.pid, 'SIGKILL')
          }

          await append(...args)
          tick()
        }

        const open = fs.open.bind(fs)
        fs.open = async (...args) => {
          if (!saving) return open(...args)
          tick()
          const handle = await open(...args)
          tick()
          for (const method of ['sync', 'close']) {
            const original = handle[method].bind(handle)
            handle[method] = async () => {
              tick()
              await original()
              tick()
            }
          }

          return handle
        }

        const commit = session.commitProjection.bind(session)
        session.commitProjection = async (...args) => {
          await commit(...args)
          saving = false
          await fs.writeFile(report + '.steps', JSON.stringify({steps: step}))
        }
      }

      const second = await start('second', 'Explain what happened; do not execute the old call')
      const next = await second.finished
      const errors = session
        .getEntries()
        .filter((e) => e.type === 'turn_event' && e.turnId === second.id && e.error)
        .map((e) => e.error.message)
      const after = await fs.readFile(session.getFile())
      assert(after.subarray(0, before.length).equals(before))
      assert.equal(next.outcome, 'completed', JSON.stringify(next))
      assert.equal(calls - invokedBefore, 1)
      assert(prepares - preparedBefore >= 1)
      const projections = session.getEntries().filter((e) => e.type === 'context_projection')
      assert.equal(projections.length, ending === 'cancel' ? 1 : 0)
      const preparedAfter = prepares
      if (process.env.COMPACT) {
        assert.equal(summaries, 1)
        assert.equal(session.getCompaction().projectionVersion, ending === 'cancel' ? 2 : 1)
      }

      const replay = await start('second', 'Explain what happened; do not execute the old call')
      assert.equal(replay.id, second.id)
      assert.equal(calls - invokedBefore, 1)
      assert.equal(prepares, preparedAfter)
      if (ending === 'cancel') {
        const replayAgain = await start('first', 'Write answer.txt after approval')
        assert.equal(replayAgain.id, first.id)
        assert.equal(prepares, preparedAfter)
        assert.throws(() => new o.SessionContextBuilder().build(session), /verified-context-required/)
      }

      if (ending === 'cancel') {
        await agent.close()
        await session.close()
        const reopened = repo.open(session.getFile())
        const resumed = new o.Agent({...agentOptions, state: new o.State(reopened)})
        const runAgain = (id, input) =>
          family === 'graph'
            ? resumed.startGraphRun(graph, process.env.DIRECT ? {path: 'answer.txt'} : input, {requestId: id})
            : resumed.startRun([new o.Message(o.MessageType.User, {content: input, id})], {requestId: id})
        const priorPrepares = prepares
        try {
          const observed = await runAgain('second', 'Explain what happened; do not execute the old call')
          assert.equal(observed.id, second.id)
          assert.equal(prepares, priorPrepares)
          inThird = true
          const third = await runAgain('third', 'A fresh explicit request after restart')
          assert.equal(
            (await third.finished).outcome,
            'completed',
            JSON.stringify({
              errors: reopened.getEntries().filter((e) => e.type === 'turn_event' && e.error),
              result: await third.finished,
            }),
          )
          assert.equal(
            reopened.getEntries().filter((e) => e.type === 'context_projection' && e.turnId === third.id).length,
            2,
          )
          const proofFile = path.join(repo.journalRoot, session.getId(), first.id, 'events.jsonl')
          const held = proofFile + '.test-held'
          await fs.rename(proofFile, held)
          const beforeMissing = prepares
          try {
            const observedWithoutProof = await runAgain('second', 'Explain what happened; do not execute the old call')
            assert.equal(observedWithoutProof.id, second.id)
            const blocked = await runAgain('missing-proof', 'Do not invent absent evidence')
            assert.notEqual((await blocked.finished).outcome, 'completed')
            assert.equal(prepares, beforeMissing)
          } finally {
            await fs.rename(held, proofFile)
          }
        } finally {
          await resumed.close()
          await reopened.close()
        }
      }

      results.push({
        ending,
        entriesBefore: entries,
        family,
        first: terminal.outcome,
        firstRun: first.id,
        newModelInvocations: calls - invokedBefore,
        newPreparations: prepares - preparedBefore,
        operations: terminal.operations.map((x) => x.status),
        second: next.outcome,
        secondErrors: errors,
        secondRun: second.id,
        session: session.getId(),
        transcriptPrefixUnchanged: true,
      })
    } finally {
      await agent.close()
      await session.close()
      await logs.close()
    }
  }

await fs.writeFile(path.join(directory, 'results.json'), JSON.stringify(results, null, 2))
console.log(JSON.stringify({directory, node: process.version, platform: process.platform, results}, null, 2))
