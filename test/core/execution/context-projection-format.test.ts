// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {Message, MessageType, Session, SessionContextBuilder, SessionRepository} from '../../../src/core/index.js'
import {encodeSessionEntry, parseSessionFile} from '../../../src/core/session/codec.js'
import {persistedContextMessage, sourceDigest} from '../../../src/core/session/compaction.js'
import {
  interruptedCalls,
  parseContextProjection,
  projectInterruptedMessages,
  projectionSourceDigest,
} from '../../../src/core/session/interrupted-context.js'
import {migrateSessionTranscriptV3} from '../../../src/core/session/migration.js'

function fixture(count = 1) {
  const session = new Session({formatVersion: 3, metadata: {id: 'fixture', rootMessageId: 'root'}})
  session.recordTurnContext({
    cwd: '/fixture',
    maxToolIterations: 2,
    model: 'fixture',
    provider: 'ollama',
    turnId: 'old',
  })
  session.recordTurnEvent({phase: 'started', turnId: 'old'})
  session.appendMessages(
    [
      new Message(MessageType.Assistant, {
        id: 'assistant',
        payload: {toolCalls: Array.from({length: count}, (_, i) => ({arguments: {}, id: 'call-' + i, name: 'write'}))},
      }),
    ],
    {turnId: 'old'},
  )
  session.recordTurnEvent({phase: 'cancelled', turnId: 'old'})
  session.recordTurnContext({
    cwd: '/fixture',
    maxToolIterations: 2,
    model: 'fixture',
    provider: 'ollama',
    turnId: 'new',
  })
  session.recordTurnEvent({phase: 'started', turnId: 'new'})
  session.appendMessages([new Message(MessageType.User, {content: 'continue', id: 'user'})], {turnId: 'new'})
  const entries = session.getEntries()
  const calls = interruptedCalls(entries)
  const projection = parseContextProjection({
    calls,
    derivedDigest: sourceDigest(
      projectInterruptedMessages(entries, calls).map((message) => persistedContextMessage(message)),
    ),
    evidence: [{digest: 'a'.repeat(64), highWater: 3, runId: 'old', terminalId: 'terminal'}],
    id: 'projection',
    previousCompactionId: null,
    revision: 1,
    sessionId: 'fixture',
    sourceDigest: projectionSourceDigest(entries),
    sourceHeadId: 'user',
    timestamp: new Date().toISOString(),
    turnId: 'new',
    type: 'context_projection',
  })
  const header = {
    cwd: '/fixture',
    id: 'fixture',
    rootMessageId: 'root',
    timestamp: new Date().toISOString(),
    type: 'session' as const,
    version: 3 as const,
  }
  return {entries, header, projection}
}

describe('context projection format (structural evidence only)', () => {
  it('decodes a valid historical record above the current producer call limit', () => {
    const {entries, header, projection} = fixture(129)
    const raw = [header, ...entries, projection].map((entry) => encodeSessionEntry(entry)).join('')
    expect(parseSessionFile(raw, 'past-format').recovered).equal(false)
    expect(projection.calls.length).equal(129)
  })

  it('retains the fixed 4 MiB revision ceiling independently of the 1 MiB producer limit', () => {
    const {projection} = fixture()
    const limit = 4 * 1024 * 1024
    projection.id += 'x'.repeat(limit - Buffer.byteLength(JSON.stringify(projection)))
    expect(Buffer.byteLength(JSON.stringify(projection))).equal(limit)
    expect(parseContextProjection(projection).id).equal(projection.id)
    expect(() => parseContextProjection({...projection, id: projection.id + 'x'})).to.throw()
  })

  it('reads v3 without granting synchronous model access', () => {
    const {entries, header, projection} = fixture()
    const raw = [header, ...entries, projection].map((entry) => encodeSessionEntry(entry)).join('')
    const parsed = parseSessionFile(raw, 'memory')
    expect(parsed.recovered).to.equal(false)
    const session = new Session({
      entries: parsed.entries.slice(1),
      formatVersion: 3,
      metadata: {id: 'fixture', rootMessageId: 'root'},
    })
    expect(() => new SessionContextBuilder().build(session)).to.throw('verified-context-required')
    expect(session.getEntries().at(-1)?.type).to.equal('context_projection')
  })
  for (const version of [1, 2])
    it('rejects a complete projection record in v' + version + ' even without final newline', () => {
      const {entries, header, projection} = fixture()
      const raw =
        JSON.stringify({...header, version}) +
        '\n' +
        [...entries, projection]
          .map((entry) => encodeSessionEntry(entry))
          .join('')
          .trimEnd()
      expect(() => parseSessionFile(raw, 'old')).to.throw('invalid-context-projection-position')
    })

  it('rejects altered source, derived digest, ancestry, ordering and unknown fields', () => {
    for (const patch of [
      {sourceDigest: 'b'.repeat(64)},
      {derivedDigest: 'b'.repeat(64)},
      {previousCompactionId: 'missing'},
      {sourceHeadId: 'missing'},
      {turnId: 'old'},
      {extra: true},
    ]) {
      const {entries, header, projection} = fixture()
      const raw = [header, ...entries, {...projection, ...patch}].map((e) => JSON.stringify(e) + '\n').join('')
      expect(() => parseSessionFile(raw, 'changed')).to.throw()
    }
  })

  it('keeps incomplete final JSON distinct from unknown complete records', () => {
    const {entries, header} = fixture()
    const prefix = [header, ...entries].map((entry) => encodeSessionEntry(entry)).join('')
    expect(parseSessionFile(prefix + '{"type":"context_projection",', 'torn').recovered).to.equal(true)
    expect(() => parseSessionFile(prefix + '{"type":"unknown"}', 'complete')).to.throw('Unsupported session entry')
  })

  it('preserves complete data bytes and old backups during v2-to-v3 migration', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-v3-'))
    const repository = new SessionRepository({rootDir: path.join(root, 'sessions')})
    try {
      repository.initializeStorage({
        allWritersStopped: true,
        automaticRestartersDisabled: true,
        exclusiveStorageControl: true,
      })
      const session = repository.create({formatVersion: 2})
      session.appendMessages([new Message(MessageType.User, {content: 'text\r\nBOM \uFEFF'})])
      const file = session.getFile()!
      const id = session.getId()
      await session.close()
      const source = fs.readFileSync(file)
      fs.writeFileSync(file + '.v1-backup', 'older backup')
      const scope = repository.scope(id)
      const offline = {
        allWritersStopped: true,
        automaticRestartersDisabled: true,
        exclusiveStorageControl: true,
      } as const
      expect(migrateSessionTranscriptV3(scope, file, offline)).to.equal('migrated')
      const target = fs.readFileSync(file)
      expect(target.subarray(target.indexOf(10) + 1).equals(source.subarray(source.indexOf(10) + 1))).to.equal(true)
      expect(fs.readFileSync(file + '.v2-backup').equals(source)).to.equal(true)
      expect(fs.readFileSync(file + '.v1-backup', 'utf8')).to.equal('older backup')
      expect(migrateSessionTranscriptV3(scope, file, offline)).to.equal('already-migrated')
      expect(fs.readFileSync(file).equals(target)).to.equal(true)
    } finally {
      fs.rmSync(root, {force: true, recursive: true})
    }
  })
})
