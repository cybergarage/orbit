// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import type {SessionEntry} from '../../../src/core/session/entries.js'

import {MemoryExecutionJournal} from '../../../src/core/execution/journal.js'
import {Message, MessageType} from '../../../src/core/message/index.js'
import {getToolResult} from '../../../src/core/models/adapters/tools.js'
import {persistedContextMessage} from '../../../src/core/session/compaction.js'
import {
  INTERRUPTED_TOOL_NOTICE,
  interruptedCalls,
  projectInterruptedMessages,
  verifyInterruptedCorrespondence,
} from '../../../src/core/session/interrupted-context.js'

const timestamp = '2026-09-14T00:00:00.000Z'
function assistant(id: string, callId = 'call'): SessionEntry {
  return {
    message: persistedContextMessage(
      new Message(MessageType.Assistant, {
        content: '',
        id,
        payload: {toolCalls: [{arguments: {path: 'test.txt'}, id: callId, name: 'write'}]},
        timestamp,
      }),
    ),
    timestamp,
    turnId: 'old',
    type: 'message',
  }
}

function raw(): SessionEntry[] {
  return [assistant('assistant'), {phase: 'cancelled', timestamp, turnId: 'old', type: 'turn_event'}]
}

async function evidence(entries = raw(), extra = false) {
  const journal = new MemoryExecutionJournal('session')
  await journal.append('old', 'run-admitted', {
    level: 'memory',
    mode: 'memory',
    requestDigest: journal.digest('request'),
    requestId: 'request',
  })
  await journal.append('old', 'run-ready', {catalog: 'catalog'})
  if (extra) {
    await journal.append('old', 'operation-intent', {
      call: journal.digest('call'),
      operationId: 'operation',
      variant: 'tool-call',
    })
    await journal.append('old', 'operation-result', {operationId: 'operation', status: 'cancelled-before-start'})
  }

  await journal.append('old', 'run-terminal', {
    cleanupErrors: [],
    operations: [],
    outcome: 'cancelled',
    quiescence: true,
    recording: {status: 'acknowledged'},
    transcriptHighWater: entries.length,
    unresolved: [],
  })
  return {
    digestCall: (id: unknown) => journal.digest(id),
    entries,
    formatVersion: 2 as const,
    records: journal.records(),
    sessionId: 'session',
  }
}

describe('interrupted context correspondence (not runtime authorization)', () => {
  it('derives deterministic error notices while retaining raw messages and cancellation', async () => {
    const options = await evidence()
    const before = JSON.stringify(options.entries)
    const proof = verifyInterruptedCorrespondence(options)
    const projected = projectInterruptedMessages(options.entries, proof.calls)
    expect(projected).to.have.length(2)
    expect(getToolResult(projected[1])).to.deep.equal({
      isError: true,
      name: 'write',
      output: INTERRUPTED_TOOL_NOTICE,
      toolCallId: 'call',
    })
    expect(projected[1].id).to.equal(projectInterruptedMessages(options.entries, proof.calls)[1].id)
    expect(JSON.stringify(options.entries)).to.equal(before)
    expect(options.records.at(-1)?.data.outcome).to.equal('cancelled')
  })

  it('rejects an intent even when later validation prevented dispatch', async () => {
    const options = await evidence(raw(), true)
    expect(() => verifyInterruptedCorrespondence(options)).to.throw('missing-result-has-intent')
  })

  it('rejects IDs reused in different assistant groups', async () => {
    const entries = [assistant('one'), assistant('two'), raw()[1]]
    const awaitOptions = await evidence(entries)
    expect(() => verifyInterruptedCorrespondence(awaitOptions)).to.throw('ambiguous-tool-call-id')
  })

  it('retains a real denied response without synthesizing output', () => {
    const entries = raw()
    entries.splice(1, 0, {
      message: persistedContextMessage(
        new Message(MessageType.Tool, {
          content: 'denied',
          id: 'denied',
          payload: {isError: true, name: 'write', output: 'denied', toolCallId: 'call'},
          timestamp,
        }),
      ),
      timestamp,
      turnId: 'old',
      type: 'message',
    })
    expect(interruptedCalls(entries)).to.deep.equal([])
    expect(projectInterruptedMessages(entries, []).map((m) => m.id)).to.deep.equal(['assistant', 'denied'])
  })

  it('rejects mismatched and duplicate real results', () => {
    const entry: SessionEntry = {
      message: persistedContextMessage(
        new Message(MessageType.Tool, {content: 'x', payload: {name: 'wrong', output: 'x', toolCallId: 'call'}}),
      ),
      timestamp,
      turnId: 'old',
      type: 'message',
    }
    expect(() => interruptedCalls([assistant('one'), entry])).to.throw('unmatched-tool-result')
  })
  for (const patch of [
    {outcome: 'incomplete'},
    {quiescence: false},
    {recording: {status: 'failed'}},
    {unresolved: ['io']},
    {cleanupErrors: ['close']},
    {operations: [{id: 'op', status: 'unknown'}]},
  ])
    it('refuses ineligible terminal ' + JSON.stringify(patch), async () => {
      const options = await evidence()
      Object.assign(options.records.at(-1)!.data, patch)
      expect(() => verifyInterruptedCorrespondence(options)).to.throw()
    })
})
