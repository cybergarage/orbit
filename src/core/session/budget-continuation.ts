// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {RunContext} from '../execution/run.js'
import type {ModelToolCall} from '../models/model.js'
import type {Session} from './session.js'

import {canonicalJSON, validateNext} from '../execution/journal.js'
import {RunContinuationError} from '../execution/run.js'
import {Message, MessageType} from '../message/index.js'
import {getToolCalls} from '../models/adapters/tools.js'
import {validateToolGroups} from './compaction.js'

export const BUDGET_NONDISPATCH_NOTICE =
  'This tool call was not executed because the run budget was exhausted. No tool output exists. Reassess the current user request before deciding on further actions.'

export function budgetToolResults(calls: readonly ModelToolCall[], continuedFrom?: string): Message[] {
  return calls.map(
    (call) =>
      new Message(MessageType.Tool, {
        payload: {
          input: call.input,
          isError: true,
          name: call.name,
          output: {content: [{text: BUDGET_NONDISPATCH_NOTICE, type: 'text'}], isError: true},
          toolCallId: call.id,
          ...(continuedFrom ? {budgetContinuation: {runId: continuedFrom, version: 1}} : {}),
        },
      }),
  )
}

function refuse(reason: string): never {
  throw new RunContinuationError(
    `Cannot continue this run: ${reason}. Keep this conversation and start a new chat if recovery is unavailable.`,
  )
}

/** Explicit append-only recovery, under the new Run's existing writer ownership. */
export async function continueBudgetRun(session: Session, run: RunContext, previousId: string): Promise<void> {
  if (!session.hasManagedLease() || !run.journal.verifyContextEvidence) refuse('verified storage is unavailable')
  const maxBytes = 64 * 1024 * 1024
  await run.wait(
    'budget-continuation',
    (async () => {
      const entries = session.getEntries()
      const source = canonicalJSON(entries)
      await session.synchronize(run.journal.level)
      const bytes = await session.verifyContextSource(maxBytes)
      if (bytes > maxBytes) refuse('history exceeds the recovery bound')
      const records = await run.journal.verifyContextEvidence!(maxBytes - bytes)
      const checked: typeof records = []
      for (const record of records) {
        if (record.sessionId !== session.getId()) refuse('journal identity differs')
        validateNext(checked, record)
        checked.push(record)
      }

      const prior = records.filter((r) => r.runId !== run.id)
      if (prior.at(-1)?.runId !== previousId) refuse('a newer run exists')
      const old = prior.filter((r) => r.runId === previousId)
      const terminal = old.find((r) => r.kind === 'run-terminal')?.data
      const recording = terminal?.recording as undefined | {status?: string}
      const operations = terminal?.operations as undefined | {status?: string}[]
      if (
        terminal?.outcome !== 'budget-exceeded' ||
        terminal.quiescence !== true ||
        recording?.status !== 'acknowledged' ||
        !Array.isArray(terminal.unresolved) ||
        terminal.unresolved.length > 0 ||
        !Array.isArray(terminal.cleanupErrors) ||
        terminal.cleanupErrors.length > 0 ||
        !Array.isArray(operations) ||
        operations.some(
          (o) => !o || !['cancelled-before-start', 'denied', 'failed', 'invalid', 'succeeded'].includes(o.status ?? ''),
        ) ||
        old.some((r) => r.kind === 'late-settlement' || r.kind === 'graph-bound')
      )
        refuse('the saved result does not prove a clean budget stop')
      if (terminal!.transcriptHighWater !== entries.length) refuse('the conversation changed after the stopped run')

      const messages = session.getConversationMessages()
      let missing: ModelToolCall[] = []
      try {
        validateToolGroups(messages)
      } catch {
        const last = entries.at(-1)
        const assistant = [...entries].reverse().find((e) => e.type === 'message')
        if (
          last?.type !== 'turn_event' ||
          last.turnId !== previousId ||
          last.phase !== 'cancelled' ||
          assistant?.type !== 'message' ||
          assistant.turnId !== previousId ||
          assistant.message.type !== 'assistant'
        )
          refuse('the incomplete history is not a final undispatched batch')
        missing = getToolCalls(messages.at(-1)!)
        if (
          missing.length === 0 ||
          missing.length > 128 ||
          new Set(missing.map((c) => c.id)).size !== missing.length ||
          missing.some((c) => !c.id)
        )
          refuse('the final tool identities are ambiguous')
        validateToolGroups(messages.slice(0, -1))
        if (
          missing.some((call) =>
            old.some((r) => r.kind === 'operation-intent' && r.data.call === run.journal.digest(call.id)),
          )
        )
          refuse('a missing tool result has an execution intent')
      }

      run.check()
      if (source !== canonicalJSON(session.getEntries())) refuse('history changed during verification')
      // Recheck storage immediately before appending; the originals stay byte-for-byte intact.
      await session.verifyContextSource(maxBytes)
      if (canonicalJSON(records) !== canonicalJSON(await run.journal.verifyContextEvidence!(maxBytes - bytes)))
        refuse('journal changed during verification')
      run.check()
      if (missing.length > 0) {
        try {
          session.appendMessages(budgetToolResults(missing, previousId), {turnId: run.id})
          await session.synchronize(run.journal.level)
          await session.verifyContextSource(maxBytes)
        } catch (error) {
          run.recordingFailed = true
          run.requestStop('recording-failed')
          throw error
        }
      }
    })(),
  )
}
