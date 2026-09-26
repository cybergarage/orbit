// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {z} from 'zod'

import type {OperationalMetrics} from '../../src/core/metrics.js'
import type {Model} from '../../src/core/models/model.js'

import {startMetricsServer} from '../../src/apps/metrics/server.js'
import {Agent} from '../../src/core/agent.js'
import {executePrepared} from '../../src/core/execution/authorization.js'
import {MemoryExecutionJournal} from '../../src/core/execution/journal.js'
import {RunSupervisor} from '../../src/core/execution/run.js'
import {PrometheusOperationalMetrics} from '../../src/core/metrics.js'
import {Message, MessageType, OperatorType, tool} from '../../src/core/models/index.js'

describe('Prometheus operational metrics', () => {
  it('counts each admitted Run once at its final outcome, including duplicate requests', async () => {
    const metrics = new PrometheusOperationalMetrics()
    const supervisor = new RunSupervisor(metrics)
    const options = {
      configuration: {},
      async execute(run: import('../../src/core/execution/run.js').RunContext) {
        await run.ready([])
        return 1
      },
      input: {content: 'same'},
      journal: async () => new MemoryExecutionJournal('session'),
      requestId: 'first',
      sessionId: 'session',
    }
    const [first, duplicate] = await Promise.all([supervisor.startRun(options), supervisor.startRun(options)])
    expect(first.id).equal(duplicate.id)
    expect((await first.finished).outcome).equal('completed')
    const failed = await supervisor.startRun({
      ...options,
      async execute() {
        throw new Error('failure without private details in metrics')
      },
      input: {content: 'failure'},
      requestId: 'second',
    })
    expect((await failed.finished).outcome).equal('failed')
    const body = await metrics.render()
    expect(body).contains('orbit_runs_active 0')
    expect(body).contains('orbit_runs_total{outcome="completed"} 1')
    expect(body).contains('orbit_runs_total{outcome="failed"} 1')
    expect(body).contains('orbit_run_duration_seconds_count{outcome="completed"} 1')
    expect(body).not.contains('session')
    expect(body).not.contains('failure without private details')
    await supervisor.close()
  })

  it('settles cancelled, budget-exceeded, and incomplete Runs without leaving active gauges', async () => {
    const metrics = new PrometheusOperationalMetrics()
    const supervisor = new RunSupervisor(metrics)
    const base = {
      configuration: {},
      input: {},
      journal: async () => new MemoryExecutionJournal('session'),
      sessionId: 'session',
    }
    const budget = await supervisor.startRun({
      ...base,
      async execute(run) {
        await run.ready([])
        run.consume('modelCalls')
      },
      limits: {modelCalls: 0},
      requestId: 'budget',
    })
    expect((await budget.finished).outcome).equal('budget-exceeded')

    const cancelled = await supervisor.startRun({
      ...base,
      async execute(run) {
        await run.ready([])
        await run.wait(
          'cooperative',
          new Promise<void>((resolve) => {
            run.signal.addEventListener('abort', () => resolve(), {once: true})
          }),
        )
      },
      requestId: 'cancelled',
    })
    cancelled.requestStop()
    expect((await cancelled.finished).outcome).equal('cancelled')

    let finish!: () => void
    const pending = new Promise<void>((resolve) => {
      finish = resolve
    })
    let started!: () => void
    const dispatched = new Promise<void>((resolve) => {
      started = resolve
    })
    const incomplete = await supervisor.startRun({
      ...base,
      async execute(run) {
        await run.ready([])
        started()
        await run.wait('noncooperative', pending)
      },
      limits: {cleanupMs: 10},
      requestId: 'incomplete',
    })
    await dispatched
    incomplete.requestStop()
    expect((await incomplete.finished).outcome).equal('incomplete')
    const body = await metrics.render()
    for (const outcome of ['budget-exceeded', 'cancelled', 'incomplete'])
      expect(body).contains(`orbit_runs_total{outcome="${outcome}"} 1`)
    expect(body).contains('orbit_runs_active 0')
    finish()
    await supervisor.close()
  })

  it('counts model retries and dispatched tools while omitting missing usage', async () => {
    const metrics = new PrometheusOperationalMetrics()
    let calls = 0
    const search = tool(({query}: {query: string}) => `found:${query}`, {
      description: 'Search',
      name: 'search',
      schema: z.object({query: z.string()}),
    })
    const agent = new Agent({
      deps: {
        createModel: (): Model => ({
          getModel: () => 'test-model',
          getName: () => OperatorType.Model,
          getProvider: () => 'ollama',
          async invoke() {
            calls++
            if (calls === 1) throw new TypeError('fetch failed')
            if (calls === 2)
              return new Message(MessageType.Assistant, {
                payload: {
                  response: {durationMs: 10, model: 'test-model', provider: 'ollama', usage: {inputTokens: 7}},
                  toolCalls: [{id: 'call-1', input: {query: 'orbit'}, name: 'search'}],
                },
              })
            return new Message(MessageType.Assistant, {content: 'done'})
          },
        }),
      },
      execution: {allowLegacyTools: true, policy: {generation: 'test', profile: 'unrestricted', roots: []}},
      metrics,
      tools: [search],
    })
    try {
      const response = await agent.invoke([new Message(MessageType.User, {content: 'search'})])
      expect(response.content).equal('done')
      const body = await metrics.render()
      expect(body).contains('orbit_model_requests_total{outcome="failed"} 1')
      expect(body).contains('orbit_model_requests_total{outcome="completed"} 2')
      expect(body).contains('orbit_tool_calls_total{outcome="completed"} 1')
      expect(body).contains('orbit_model_tokens_total{direction="input"} 7')
      expect(body).not.contains('direction="output"')
      expect(body).not.contains('test-model')
      expect(body).not.contains('search')
    } finally {
      await agent.close()
    }
  })

  it('keeps observer exceptions outside the Run outcome', async () => {
    const observer: OperationalMetrics = {
      modelRequest() {
        throw new Error('metrics broken')
      },
      runAdmitted() {
        throw new Error('metrics broken')
      },
      runSettled() {
        throw new Error('metrics broken')
      },
      toolCall() {
        throw new Error('metrics broken')
      },
    }
    let failures = 0
    const supervisor = new RunSupervisor(observer, () => failures++)
    const handle = await supervisor.startRun({
      configuration: {},
      async execute(run) {
        await run.ready([])
        return 1
      },
      input: {},
      journal: async () => new MemoryExecutionJournal('session'),
      requestId: 'first',
      sessionId: 'session',
    })
    expect((await handle.finished).outcome).equal('completed')
    expect(failures).equal(2)
    await supervisor.close()
  })

  it('excludes denied tools and counts an actual dispatch even when it fails', async () => {
    const metrics = new PrometheusOperationalMetrics()
    const supervisor = new RunSupervisor(metrics)
    const outcomes: string[] = []
    for (const [requestId, decision] of [
      ['denied', 'deny'],
      ['dispatched', 'allow'],
    ] as const) {
      // eslint-disable-next-line no-await-in-loop
      const handle = await supervisor.startRun({
        configuration: {},
        async execute(run) {
          await run.ready([])
          return executePrepared(
            run,
            {
              binding: {},
              cwd: process.cwd(),
              effect: 'command',
              id: requestId,
              input: {},
              name: 'test',
              preview: {},
              runId: run.id,
              sessionId: 'session',
              targets: [],
              variant: 'tool-call',
              version: 1,
            },
            {
              binding: {},
              effect: 'command',
              async execute() {
                return {content: [], isError: true}
              },
              preview: {},
              revalidate: async () => true,
              targets: [],
            },
            {decide: () => decision, generation: 'test', profile: 'unrestricted', roots: []},
            false,
            (outcome) => outcomes.push(outcome),
          )
        },
        input: {},
        journal: async () => new MemoryExecutionJournal('session'),
        requestId,
        sessionId: 'session',
      })
      // eslint-disable-next-line no-await-in-loop
      await handle.finished
    }

    expect(outcomes).deep.equal(['failed'])
    expect(await metrics.render()).contains('orbit_runs_active 0')
    await supervisor.close()
  })

  it('serves only the loopback metrics route with an isolated registry', async () => {
    const first = new PrometheusOperationalMetrics()
    const second = new PrometheusOperationalMetrics()
    first.runAdmitted()
    const server = await startMetricsServer(first, 0)
    try {
      // Node 20 supports fetch; the lint rule still marks it experimental.
      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      const response = await fetch(server.url)
      expect(response.status).equal(200)
      expect(response.headers.get('content-type')).equal(first.contentType)
      expect(await response.text()).contains('orbit_runs_active 1')
      expect(await second.render()).contains('orbit_runs_active 0')
      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      expect((await fetch(server.url.replace('/metrics', '/'))).status).equal(404)
      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      expect((await fetch(server.url, {method: 'POST'})).status).equal(404)
    } finally {
      await server.close()
    }
  })
})
