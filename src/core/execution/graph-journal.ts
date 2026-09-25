// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {GraphDescriptor, GraphProfile} from '../processor/graph-definition.js'
import type {JournalRecord} from './journal.js'

import {graphIdentity, graphProfile, validateGraphDescriptor} from '../processor/graph-definition.js'
import {hasProjectGraphContext} from '../projects/memory-journal.js'

const digest = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)
const integer = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0
const graphKinds = new Set(['graph-bound', 'graph-node-completed', 'graph-node-started', 'graph-transition'])
export function validateGraphRecord(entries: JournalRecord[], record: JournalRecord): void {
  const run = entries.filter((item) => item.runId === record.runId)
  if (record.version === 3 && record.kind === 'run-admitted') {
    if (!digest(record.data.requestDigest)) throw new Error('Project admission requires a submitted request digest')
    return
  }

  if (record.version === 3 && record.kind === 'project-context') return
  if (record.version === 1 || (record.version === 3 && !hasProjectGraphContext(run))) {
    if (
      graphKinds.has(record.kind) ||
      record.data.visitId !== undefined ||
      record.data.graph !== undefined ||
      (record.kind === 'run-ready' && record.data.transcriptHighWater !== undefined)
    )
      throw new Error('Graph evidence requires journal v2')
    return
  }

  const bound = run.find((item) => item.kind === 'graph-bound')
  const ready = run.find((item) => item.kind === 'run-ready')
  const starts = run.filter((item) => item.kind === 'graph-node-started')
  const started = starts.at(-1)
  const completed = run.find(
    (item) => item.kind === 'graph-node-completed' && item.data.visitId === started?.data.visitId,
  )
  const transition = run.find((item) => item.kind === 'graph-transition' && item.data.visitId === started?.data.visitId)
  const {data} = record
  if (
    ['graph-node-completed', 'graph-node-started', 'graph-transition', 'operation-intent'].includes(record.kind) &&
    run.some((item) => item.kind === 'stop-requested')
  )
    throw new Error('Graph dispatch after stop')
  if (record.kind === 'run-admitted') {
    if (!digest(data.requestDigest)) throw new Error('Graph admission requires a submitted request digest')
    return
  }

  if (record.kind === 'graph-bound') {
    if (bound || ready || starts.length > 0 || run.some((item) => item.kind === 'operation-intent'))
      throw new Error('Duplicate or late graph binding')
    const profile = graphProfile(data.profile as GraphProfile)
    const descriptor = data.descriptor as unknown as GraphDescriptor
    validateGraphDescriptor(descriptor, profile)
    if (data.turnId !== record.runId || data.graph !== graphIdentity(descriptor) || !digest(data.configuration))
      throw new Error('Invalid graph binding identity')
    return
  }

  if (record.kind === 'run-ready') {
    if (!bound || !integer(data.transcriptHighWater) || !digest(data.catalog))
      throw new Error('Graph ready requires synchronized binding')
    return
  }

  if (graphKinds.has(record.kind) && (!bound || !ready || data.graph !== bound.data.graph))
    throw new Error('Graph action before readiness or identity mismatch')
  const descriptor = bound?.data.descriptor as unknown as GraphDescriptor | undefined
  const profile = bound?.data.profile as GraphProfile | undefined
  if (record.kind === 'graph-node-started') {
    const previous = [...run].reverse().find((item) => item.kind === 'graph-transition')
    const destination = starts.length === 0 ? descriptor!.entry : previous?.data.destination
    if (started && !transition) throw new Error('Concurrent or unfinished graph visit')
    if (
      data.nodeId !== destination ||
      !descriptor!.nodes.some((node) => node.id === data.nodeId) ||
      data.visit !== starts.length + 1 ||
      starts.length >= profile!.maxNodeVisits
    )
      throw new Error('Invalid graph visit path or limit')
    if (
      typeof data.visitId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,160}$/u.test(data.visitId) ||
      starts.some((item) => item.data.visitId === data.visitId) ||
      !digest(data.inputDigest) ||
      !integer(data.transcriptHighWater)
    )
      throw new Error('Invalid graph invocation identity')
    const counters = data.budget as Record<string, unknown>
    const previousBudget = started?.data.budget as Record<string, unknown> | undefined
    const limits = run[0].data.limits as Record<string, unknown>
    if (
      !counters ||
      Object.keys(counters).sort().join(',') !== 'modelCalls,toolRequests,toolRounds' ||
      Object.entries(counters).some(
        ([key, value]) =>
          !integer(value) ||
          Number(value) < Number(previousBudget?.[key] ?? 0) ||
          (limits[key] !== 'unlimited' && (!integer(limits[key]) || Number(value) > Number(limits[key]))),
      )
    )
      throw new Error('Invalid Graph shared budget evidence')
    const high = [...run].reverse().find((item) => ['graph-node-completed', 'run-ready'].includes(item.kind))!.data
      .transcriptHighWater
    if (data.transcriptHighWater !== high) throw new Error('Graph start references unacknowledged transcript')
    return
  }

  if (record.kind === 'graph-node-completed') {
    if (
      !started ||
      completed ||
      data.visitId !== started.data.visitId ||
      data.nodeId !== started.data.nodeId ||
      !digest(data.outputDigest) ||
      !['failed', 'succeeded'].includes(String(data.outcome))
    )
      throw new Error('Unmatched graph completion')
    if (
      !integer(data.transcriptHighWater) ||
      Number(data.transcriptHighWater) < Number(started.data.transcriptHighWater) ||
      !Array.isArray(data.messages) ||
      data.messages.some((id) => typeof id !== 'string') ||
      new Set(data.messages).size !== data.messages.length
    )
      throw new Error('Invalid graph transcript evidence')
    const operations = run
      .filter((item) => item.kind === 'operation-result' && item.data.visitId === data.visitId)
      .map((item) => item.data.operationId)
    if (!Array.isArray(data.operations) || JSON.stringify(operations) !== JSON.stringify(data.operations))
      throw new Error('Graph operation references mismatch')
    if (
      run.some(
        (item) =>
          item.kind === 'operation-intent' &&
          item.data.visitId === data.visitId &&
          !operations.includes(item.data.operationId),
      )
    )
      throw new Error('Graph completion with unresolved effect')
    return
  }

  if (record.kind === 'graph-transition') {
    const edge = descriptor!.edges.find((item) => item.id === data.edgeId)
    if (
      !completed ||
      transition ||
      data.visitId !== completed.data.visitId ||
      data.outputDigest !== completed.data.outputDigest ||
      !edge ||
      edge.from !== completed.data.nodeId ||
      edge.to !== data.destination ||
      edge.label !== data.label
    )
      throw new Error('Invalid graph transition')
    return
  }

  if (record.kind === 'operation-intent' || record.kind === 'operation-result') {
    if (!bound) throw new Error('Graph operations require bound definition')
    if (data.visitId === undefined) {
      const intent = run.find((item) => item.kind === 'operation-intent' && item.data.operationId === data.operationId)
      if (
        ready ||
        (record.kind === 'operation-intent' && data.variant !== 'mcp-startup') ||
        (intent && intent.data.variant !== 'mcp-startup')
      )
        throw new Error('Missing operation visit')
    } else if (!ready || !started || completed || data.visitId !== started.data.visitId)
      throw new Error('Operation outside active graph visit')
    if (record.kind === 'operation-result') {
      const intent = run.find((item) => item.kind === 'operation-intent' && item.data.operationId === data.operationId)
      if (
        !['cancelled-before-start', 'denied', 'failed', 'invalid', 'succeeded', 'unknown'].includes(
          String(data.status),
        ) ||
        (['failed', 'succeeded', 'unknown'].includes(String(data.status)) && !intent) ||
        (intent && intent.data.visitId !== data.visitId)
      )
        throw new Error('Invalid graph operation outcome')
    }
  }

  if (record.kind === 'run-terminal') {
    const successful = data.outcome === 'completed'
    const declared = data.reason === 'graph-declared-failure'
    if (successful || declared) {
      const terminal = descriptor?.terminals.find((item) => item.id === transition?.data.destination)
      if (
        !bound ||
        !ready ||
        !completed ||
        !transition ||
        !terminal ||
        terminal.outcome !== (successful ? 'completed' : 'failed') ||
        (declared && data.outcome !== 'failed')
      )
        throw new Error('Graph terminal lacks a complete declared path')
    }
  }
}
