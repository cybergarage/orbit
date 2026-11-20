// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {createHash} from 'node:crypto'

import {getToolResult, stringifyToolResult} from '../dist/core/models/adapters/tools.js'
import {toolResultText} from '../dist/core/tools/definition.js'
import {rankCandidates} from './project-memory-ingestion-study-core.mjs'

export const digest = (text) => createHash('sha256').update(text).digest('hex')
const preHeading = 'Untrusted retrieved evidence:\n'
const preSeparator = '\n\nQuestion: '

/** Observe one isolated Agent arm. No part of this observer feeds data back to search or the model. */
export function traceArm(env, arm) {
  const searches = []
  const wireRequests = []
  const outcomes = {providerFailures: [], providerStops: []}
  const original = {prepare: env.memory.prepare, query: env.store.query, search: env.memory.search}
  let current
  let invocation
  let match
  env.store.query = async function (q) {
    const value = await original.query.call(this, q)
    if (q.kind === 'snapshot' && current)
      current.ranked = rankCandidates(value.entries, current.query).map(({entry, overlap}) => ({id: entry.id, overlap}))
    return value
  }

  env.memory.prepare = async function (...args) {
    const value = await original.prepare.apply(this, args)
    if (current) {
      current.preparedIds = value.entries.map(({id}) => id)
      current.exclusions = value.exclusions
    }

    return value
  }

  env.memory.search = async function (sessionId, projectId, input, signal) {
    const record = {arm, limit: input.limit ?? 6, query: input.query, returnedIds: []}
    searches.push(record)
    current = record
    match = record
    try {
      const result = await original.search.call(this, sessionId, projectId, input, signal)
      record.returnedIds = result.results.map(({id}) => id)
      record.resultDigest = digest(JSON.stringify(result))
      record.truncated = result.truncated
      return result
    } catch (error) {
      record.failure = error instanceof Error ? error.name : 'unknown'
      throw error
    } finally {
      current = undefined
    }
  }

  return {
    close() {
      env.memory.prepare = original.prepare
      env.memory.search = original.search
      env.store.query = original.query
    },
    coreInvocation(messages, round) {
      invocation = {
        round,
        tools: messages.flatMap((message) => {
          const result = getToolResult(message)
          return result?.name === 'project_memory_search'
            ? [{callId: result.toolCallId, hash: digest(stringifyToolResult(result))}]
            : []
        }),
      }
    },
    preResult(result) {
      if (result && match) match.transportDigest = digest(JSON.stringify(result))
    },
    providerFailure(error) {
      outcomes.providerFailures.push({kind: error instanceof Error ? error.name : 'unknown', round: invocation?.round})
    },
    providerStop(reason) {
      if (reason !== undefined) outcomes.providerStops.push({reason, round: invocation?.round})
    },
    result: {outcomes, searches, wireRequests},
    runFinished(result) {
      outcomes.terminal = {outcome: result.outcome, reason: result.reason, stopRequest: result.stopRequest ?? null}
    },
    toolResult(callId, result) {
      if (match) {
        match.callId = callId
        match.transportDigest = digest(toolResultText(result))
        match = undefined
      }
    },
    wire(messages, route) {
      const seenTools = new Set()
      const evidence = []
      for (const message of messages) {
        if (message.role === 'tool' && message.tool_name === 'project_memory_search') {
          const hash = digest(message.content)
          const expected = invocation?.tools.find((item) => item.hash === hash && !seenTools.has(item.callId))
          if (expected) seenTools.add(expected.callId)
          const hit = searches.find(
            (item) => item.callId === expected?.callId && item.transportDigest === hash && expected,
          )
          evidence.push({callId: expected?.callId ?? null, idMatch: Boolean(hit), returnedIds: hit?.returnedIds ?? []})
        }

        if (arm === 'pre' && message.role === 'user' && message.content.startsWith(preHeading)) {
          const end = message.content.indexOf(preSeparator, preHeading.length)
          const hash = end === -1 ? '' : digest(message.content.slice(preHeading.length, end))
          const hit = searches.find((item) => item.transportDigest === hash)
          evidence.push({callId: null, idMatch: Boolean(hit), returnedIds: hit?.returnedIds ?? []})
        }
      }

      const mark = {evidence, replyReturned: null, round: invocation?.round, route}
      wireRequests.push(mark)
      return mark
    },
    wireFinished(mark, replyReturned) {
      mark.replyReturned = replyReturned
    },
  }
}

export function deliveredIds(trace) {
  const seen = trace.wireRequests
    .filter(({replyReturned, route}) => route === 'ollama' && replyReturned === true)
    .flatMap(({evidence}) => evidence.flatMap(({idMatch, returnedIds}) => (idMatch ? returnedIds : [])))
  return [...new Set(seen)]
}
