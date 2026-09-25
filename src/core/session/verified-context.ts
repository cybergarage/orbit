// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {RunContext} from '../execution/run.js'
import type {SessionEntry} from './entries.js'
import type {ContextProjectionEntry} from './interrupted-context.js'
import type {Session} from './session.js'

import {canonicalJSON} from '../execution/journal.js'
import {Message, MessageType} from '../message/index.js'
import {validateSkillEntries} from '../skills/record.js'
import {checkpointPrefix, persistedContextMessage, sourceDigest, validateCompactionEntries} from './compaction.js'
import {SessionContextBuilder} from './context-builder.js'
import {
  INTERRUPTED_TOOL_NOTICE,
  parseContextProjection,
  projectInterruptedMessages,
  validateContextProjectionEntries,
  VerifiedContextError,
  verifyInterruptedCorrespondence,
} from './interrupted-context.js'

export type InterruptionPolicy = {mode: 'disabled'} | {mode: 'verified-not-dispatched'; revision: 1}
export const DEFAULT_PROJECTION_LIMITS = Object.freeze({
  calls: 128,
  metadataBytes: 1024 * 1024,
  rawBytes: 64 * 1024 * 1024,
})
const pinned = new WeakMap<RunContext, {prefix: SessionEntry[]; source: string}>()
export function parseInterruptionPolicy(value: unknown): InterruptionPolicy {
  const p = value as InterruptionPolicy
  if (
    !p ||
    (p.mode !== 'disabled' && p.mode !== 'verified-not-dispatched') ||
    (p.mode === 'disabled'
      ? Object.keys(p).join(',') !== 'mode'
      : p.revision !== 1 || Object.keys(p).sort().join(',') !== 'mode,revision')
  )
    throw new VerifiedContextError('unsupported-interruption-policy')
  return structuredClone(p)
}

function enabled(policy: InterruptionPolicy): boolean {
  if (policy.mode === 'disabled') return false
  if (policy.mode !== 'verified-not-dispatched' || policy.revision !== 1)
    throw new VerifiedContextError('unsupported-interruption-policy')
  return true
}

/** Called only after exact replay resolution and before model, MCP or Graph preparation. */
export async function preflightInterruptedContext(
  session: Session,
  run: RunContext,
  policy: InterruptionPolicy,
): Promise<void> {
  const entries = session.getEntries()
  if (!enabled(policy)) {
    if (entries.some((e) => e.type === 'context_projection'))
      throw new VerifiedContextError('verified-context-required')
    return
  }

  if (session.formatVersion !== 3) throw new VerifiedContextError('transcript-v3-migration-required')
  await proof(session, run)
  run.check()
  pinned.set(run, {prefix: structuredClone(entries), source: canonicalJSON(entries)})
}

async function proof(session: Session, run: RunContext) {
  const pending = (async () => {
    if (!session.hasManagedLease() || !run.journal.verifyContextEvidence)
      throw new VerifiedContextError('context-evidence-ownership-required')
    const entries = structuredClone(session.getEntries())
    if (Buffer.byteLength(canonicalJSON(entries)) > DEFAULT_PROJECTION_LIMITS.rawBytes)
      throw new VerifiedContextError('context-evidence-limit')
    validateContextProjectionEntries(entries, session.getId(), session.formatVersion)
    validateCompactionEntries(entries, session.getId(), session.formatVersion)
    validateSkillEntries(entries, session.getId(), session.formatVersion)
    if (
      sourceDigest(entries.filter((e) => e.type === 'message').map((e) => e.message)) !==
      sourceDigest(session.getConversationMessages().map((message) => persistedContextMessage(message)))
    )
      throw new VerifiedContextError('context-message-entry-mismatch')
    const pin = pinned.get(run)
    if (pin && canonicalJSON(entries.slice(0, pin.prefix.length)) !== pin.source)
      throw new VerifiedContextError('context-source-changed')
    let sourceBytes = 0
    try {
      await session.synchronize(run.journal.level)
      sourceBytes = await session.verifyContextSource(DEFAULT_PROJECTION_LIMITS.rawBytes)
    } catch (error) {
      run.recordingFailed = true
      run.requestStop('recording-failed')
      throw error
    }

    const records = await run.journal.verifyContextEvidence(DEFAULT_PROJECTION_LIMITS.rawBytes - sourceBytes)
    if (canonicalJSON(session.getEntries()) !== canonicalJSON(entries))
      throw new VerifiedContextError('context-source-changed')
    const result = verifyInterruptedCorrespondence({
      digestCall: (id) => run.journal.digest(id),
      entries,
      formatVersion: session.formatVersion,
      records,
      sessionId: session.getId(),
    })
    if (result.calls.length > DEFAULT_PROJECTION_LIMITS.calls) throw new VerifiedContextError('context-notice-limit')
    for (const entry of entries) {
      if (entry.type !== 'context_projection') continue
      for (const evidence of entry.evidence) {
        const current = result.evidence.find((e) => e.runId === evidence.runId)
        if (!current || canonicalJSON(current) !== canonicalJSON(evidence))
          throw new VerifiedContextError('context-projection-evidence-changed')
      }
    }

    return {...result, entries}
  })()
  return run.wait('context-evidence', pending)
}

export interface VerifiedModelContext {
  all: Message[]
  messages: Message[]
  notices: Message[]
  projectionIds: string[]
}
/** Returns an owned verified view. Pure record parsing alone never reaches this path. */
export async function prepareInterruptedContext(
  session: Session,
  run: RunContext,
  policy: InterruptionPolicy,
): Promise<VerifiedModelContext> {
  if (!enabled(policy))
    return {
      all: session.getConversationMessages(),
      messages: new SessionContextBuilder().build(session).messages,
      notices: [],
      projectionIds: [],
    }
  if (!pinned.has(run)) throw new VerifiedContextError('context-preflight-required')
  const checked = await proof(session, run)
  run.check()
  if (checked.calls.length === 0)
    return {
      all: session.getConversationMessages(),
      messages: new SessionContextBuilder().build(session).messages,
      notices: [],
      projectionIds: [],
    }
  const all = projectInterruptedMessages(checked.entries, checked.calls)
  const currentSource = sourceDigest(
    session.getConversationMessages().map((message) => persistedContextMessage(message)),
  )
  const currentHead = session.getLastMessageId()
  const currentCheckpoint = session.getCompaction()?.id ?? null
  let projection = [...session.getEntries()]
    .reverse()
    .find(
      (e): e is ContextProjectionEntry =>
        e.type === 'context_projection' &&
        e.turnId === run.id &&
        e.sourceDigest === currentSource &&
        e.sourceHeadId === currentHead &&
        e.previousCompactionId === currentCheckpoint,
    )
  if (!projection) {
    projection = parseContextProjection({
      calls: checked.calls,
      derivedDigest: sourceDigest(all.map((message) => persistedContextMessage(message))),
      evidence: checked.evidence,
      id: run.id + '-context-' + session.getEntries().length,
      previousCompactionId: session.getCompaction()?.id ?? null,
      revision: 1,
      sessionId: session.getId(),
      sourceDigest: sourceDigest(session.getConversationMessages().map((message) => persistedContextMessage(message))),
      sourceHeadId: session.getLastMessageId(),
      timestamp: new Date().toISOString(),
      turnId: run.id,
      type: 'context_projection',
    })
    if (Buffer.byteLength(canonicalJSON(projection)) > DEFAULT_PROJECTION_LIMITS.metadataBytes)
      throw new VerifiedContextError('context-projection-metadata-limit')
    const save = session.commitProjection(projection, run.journal.level)
    save.catch(() => {
      run.recordingFailed = true
      run.requestStop('recording-failed')
    })
    await run.wait('context-projection-save', save)
    run.check()
  }

  const checkpoint = session.getCompaction()
  const selected = checkpoint ? all.slice(all.findIndex((m) => m.id === checkpoint.firstRetainedId)) : all
  const summary = checkpoint ? checkpointPrefix(checkpoint, all) : []
  const notices = [
    new Message(MessageType.User, {
      content: INTERRUPTED_TOOL_NOTICE + '\n' + JSON.stringify(checked.calls),
      id: projection.id + '-notice',
      timestamp: projection.timestamp,
    }),
  ]
  return {all, messages: [...summary, ...notices, ...selected], notices, projectionIds: [projection.id]}
}

export async function reverifyInterruptedContext(session: Session, run: RunContext): Promise<void> {
  await proof(session, run)
  run.check()
}
