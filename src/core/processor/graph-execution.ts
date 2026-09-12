// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {randomUUID} from 'node:crypto'

import type {RunContext, RunHandle} from '../execution/run.js'
import type {Session} from '../session/index.js'
import type {ToolSnapshot} from '../tools/registry.js'
import type {CompiledProcessorGraph, GraphJSON} from './graph-definition.js'

import {enterGraphVisit, GraphDeclaredFailure, leaveGraphVisit} from '../execution/graph-state.js'
import {canonicalJSON, copyJSON} from '../execution/journal.js'
import {boundedGraphJSON, deepFreeze, graphBinding} from './graph-definition.js'

export interface GraphValue {
  graph: string
  value: GraphJSON
}
export interface GraphSnapshot {
  graph: string
  lastValue?: GraphJSON
  nodeId?: string
  outputDigest?: string
  recovered: boolean
  runId: string
  terminal?: string
  visitId?: string
  visits: number
}
export interface GraphInvocation {
  graph: CompiledProcessorGraph
  input: GraphJSON
  observe(snapshot: GraphSnapshot): void
}
export function validateGraphCatalog(graph: CompiledProcessorGraph, tools: ToolSnapshot, localOnly = false): void {
  for (const node of graph.descriptor.nodes) {
    graphBinding(graph, node.id)
    if (node.kind !== 'tool' || (localOnly && node.tool?.source.kind === 'mcp')) continue
    const definition = tools.get(node.tool!.name)
    if (
      !definition ||
      canonicalJSON(definition.source) !== canonicalJSON(node.tool!.source) ||
      canonicalJSON(definition.spec.inputSchema) !== canonicalJSON(node.inputSchema)
    )
      throw new Error('Graph tool catalog binding mismatch')
  }
}

export async function bindGraphJournal(invocation: GraphInvocation, run: RunContext): Promise<void> {
  const {graph} = invocation
  await run.record('graph-bound', {
    configuration: run.journal.digest(graph.configuration),
    descriptor: graph.descriptor,
    graph: graph.identity,
    profile: graph.profile,
    turnId: run.id,
  })
}

export async function graphSynchronize(run: RunContext, session: Session): Promise<number> {
  const pending = session.synchronize(run.journal.level)
  pending.catch(() => {
    run.recordingFailed = true
    run.requestStop('recording-failed')
  })
  return run.wait('graph-transcript-sync', pending)
}

export async function executeProcessorGraph(
  invocation: GraphInvocation,
  run: RunContext,
  session: Session,
  capabilities: {
    agent(input: GraphJSON, configuration: GraphJSON): Promise<GraphJSON>
    tool(name: string, input: GraphJSON): Promise<GraphJSON>
  },
): Promise<GraphValue> {
  const {graph} = invocation
  let nodeId = graph.descriptor.entry
  let value = invocation.input
  let visits = 0
  let highWater = Number(
    run.journal.records().find((record) => record.runId === run.id && record.kind === 'run-ready')?.data
      .transcriptHighWater,
  )
  let snapshot: GraphSnapshot = {graph: graph.identity, recovered: false, runId: run.id, visits}
  const observe = () => invocation.observe(copyJSON(snapshot))
  observe()
  for (;;) {
    run.check()
    if (visits >= graph.profile.maxNodeVisits) {
      run.requestStop('budget-exceeded')
      run.check()
    }

    const node = graph.descriptor.nodes.find((item) => item.id === nodeId)!
    const binding = graphBinding(graph, nodeId)
    const input = deepFreeze(boundedGraphJSON(value, graph.profile.valueBytes))
    if (!binding.input(input).valid) throw new Error('Invalid graph node input')
    const visitId = randomUUID()
    visits++
    snapshot = {...snapshot, nodeId, visitId, visits}
    observe()
    const messagesBefore = session.getMessages().length
    // Every visit is serial and begins only after its required acknowledgement.
    // eslint-disable-next-line no-await-in-loop
    await run.record('graph-node-started', {
      budget: {...run.budget},
      graph: graph.identity,
      inputDigest: run.journal.digest(input),
      nodeId,
      transcriptHighWater: highWater,
      visit: visits,
      visitId,
    })
    enterGraphVisit(run, visitId)
    let output: GraphJSON
    let label: string | undefined
    try {
      run.check()
      const invocationPromise = Promise.resolve().then(() => {
        run.check()
        if (node.kind === 'agent') return capabilities.agent(input, binding.configuration)
        if (node.kind === 'tool') {
          run.consume('toolRequests')
          return capabilities.tool(node.tool!.name, input)
        }

        return binding.invoke!(input, binding.configuration, {signal: run.signal})
      })
      // Ownership survives caller cancellation; no successor can race a pending callback.
      // eslint-disable-next-line no-await-in-loop
      const result = await run.wait(`graph-node:${visitId}`, invocationPromise)
      run.check()
      if (node.kind === 'router') {
        if (typeof result !== 'string') throw new Error('Graph router must return a declared label')
        label = result
        output = input
      } else output = boundedGraphJSON(result, graph.profile.valueBytes)
      if (!binding.output(output).valid) throw new Error('Invalid graph node output')
      const edge = graph.descriptor.edges.find((item) => item.from === nodeId && item.label === label)
      if (!edge) throw new Error('Undeclared graph route')
      if (run.operations.some((operation) => operation.status === 'unknown'))
        throw new Error('Graph has an unknown operation')
      // eslint-disable-next-line no-await-in-loop
      highWater = await graphSynchronize(run, session)
      run.check()
      const outputDigest = run.journal.digest(output)
      const operations = run.journal
        .records()
        .filter(
          (record) => record.runId === run.id && record.kind === 'operation-result' && record.data.visitId === visitId,
        )
        .map((record) => record.data.operationId)
      const outcome =
        node.kind === 'tool' &&
        run.operations.some((operation) => operations.includes(operation.id) && operation.status === 'failed')
          ? 'failed'
          : 'succeeded'
      // eslint-disable-next-line no-await-in-loop
      await run.record('graph-node-completed', {
        graph: graph.identity,
        messages: session
          .getMessages()
          .slice(messagesBefore)
          .map((message) => message.id),
        nodeId,
        operations,
        outcome,
        outputDigest,
        transcriptHighWater: highWater,
        visitId,
      })
      snapshot = {...snapshot, lastValue: output, outputDigest}
      observe()
      run.check()
      // eslint-disable-next-line no-await-in-loop
      await run.record('graph-transition', {
        destination: edge.to,
        edgeId: edge.id,
        graph: graph.identity,
        visitId,
        ...(label === undefined ? {} : {label}),
        outputDigest,
      })
      run.check()
      const terminal = graph.descriptor.terminals.find((item) => item.id === edge.to)
      if (terminal) {
        snapshot = {...snapshot, terminal: terminal.id}
        observe()
        if (terminal.outcome === 'failed') throw new GraphDeclaredFailure()
        return {graph: graph.identity, value: deepFreeze(output)}
      }

      value = output
      nodeId = edge.to
    } finally {
      leaveGraphVisit(run)
    }
  }
}

export function graphHandle(handle: RunHandle<GraphValue>): RunHandle<GraphValue> {
  return {
    finished: handle.finished,
    getSnapshot: () => handle.getSnapshot(),
    id: handle.id,
    requestStop: (reason) => handle.requestStop(reason),
    value() {
      const {result} = handle.getSnapshot()
      if (result?.outcome !== 'completed' || !result.quiescence || result.recording.status !== 'acknowledged') return
      const value = handle.value()
      return value === undefined ? undefined : copyJSON(value)
    },
  }
}
