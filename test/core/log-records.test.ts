// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {FileSessionLogStore} from '../../src/core/logs/file-store.js'
import {normalizeLogRecord} from '../../src/core/logs/records.js'
import {StoreSessionLoggerFactory} from '../../src/core/logs/session-logger.js'

const historical = () => ({
  fields: {eventType: 'turn.started', status: 'unknown'},
  id: 'historical',
  iteration: 0,
  level: 'info',
  message: 'Synthetic event',
  runId: 'run-1',
  sessionId: 'session-1',
  timestamp: '2026-11-14T00:00:00.000Z',
})
const current = () => ({
  category: 'lifecycle',
  correlation: {runId: 'run-2', sessionId: 'session-1'},
  eventType: 'turn.completed',
  fields: {status: 'unknown'},
  id: 'current',
  level: 'info',
  message: 'Synthetic event',
  timestamp: '2026-11-14T00:01:00.000Z',
})

describe('Structural log compatibility', () => {
  it('projects tagged and untagged historical records without inventing success or losing extensions', () => {
    const extra = {approved: false, status: 'unknown', values: [null, 1]}
    for (const tag of [{}, {version: 1}]) {
      const value = {...historical(), ...tag, extra}
      const bytes = JSON.stringify(value)
      const record = normalizeLogRecord(value)
      expect(record).include({category: 'lifecycle', eventType: 'turn.started', version: 2})
      expect(record.correlation).deep.equals({iteration: 0, runId: 'run-1', sessionId: 'session-1', turnId: 'run-1'})
      expect(record).property('extra').deep.equals(extra)
      expect(record.fields).deep.equals({status: 'unknown'})
      expect(record).not.have.property('outcome')
      expect(JSON.stringify(value)).equals(bytes)
    }
  })

  it('retains current structure, extensions and observed denial without depending on a tag', () => {
    for (const tag of [{}, {version: 2}]) {
      const value = {...current(), ...tag, extra: {future: true}, outcome: 'denied'}
      expect(normalizeLogRecord(value)).deep.equals({...value, version: 2})
    }

    const value = historical()
    delete (value.fields as {eventType?: string}).eventType
    expect(normalizeLogRecord(value).eventType).equals('synthetic.event')
  })

  it('preserves optional unknown observations rather than changing them to success', () => {
    const value = {...current(), extra: {approved: false}, outcome: 'unknown', usage: {inputTokens: null}, version: 2}
    expect(normalizeLogRecord(value)).deep.equals(value)
  })

  it('never downgrades damaged current records into the historical projection', () => {
    for (const key of ['category', 'correlation', 'eventType']) {
      const value: Record<string, unknown> = current()
      delete value[key]
      expect(() => normalizeLogRecord(value)).throws('current log structure')
    }

    const emptyCurrent = {...historical(), version: 2}
    expect(() => normalizeLogRecord(emptyCurrent)).throws('identifier')
    for (const value of [historical(), current()])
      for (const version of [null, '1', 3]) expect(() => normalizeLogRecord({...value, version})).throws('identifier')
    expect(normalizeLogRecord({...current(), version: 1})).property('version', 2)
  })

  it('refuses malformed shared and current required fields', () => {
    for (const patch of [{fields: []}, {level: 1}, {id: null}, {timestamp: 2}, {message: false}, {correlation: []}])
      expect(() => normalizeLogRecord({...current(), ...patch})).throws()
    for (const value of [null, [], 'event']) expect(() => normalizeLogRecord(value)).throws()
  })

  it('retains historical extension collisions and the original unknown state', () => {
    const value = {...historical(), category: 'unknown', correlation: {future: false}, eventType: null, version: 1}
    const record = normalizeLogRecord(value)
    expect(record.category).equals('lifecycle')
    expect(record.eventType).equals('turn.started')
    expect(record.fields.historicalRecord).deep.equals(value)
    expect(() => normalizeLogRecord({...value, version: 2})).throws('current log structure')
  })

  it('keeps usage and duration values emitted by the existing writer readable', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-writer-logs-'))
    const store = new FileSessionLogStore({rootDir: root})
    try {
      const logger = new StoreSessionLoggerFactory(store).forSession('session-1')
      logger.info({durationMs: -1, usage: {inputTokens: -1, outputTokens: Number.NaN}}, 'Synthetic usage')
      await store.flush('session-1')
      const records = (await store.list('session-1')).data
      expect(records).length(1)
      expect(records[0].usage).deep.equals({inputTokens: -1, outputTokens: null})
      expect(records[0]).not.have.property('durationMs')
    } finally {
      await store.close()
      await fs.rm(root, {force: true, recursive: true})
    }
  })

  it('queries mixed partitions and cursors without changing any saved bytes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-structural-logs-'))
    const directory = path.join(root, 'session-1')
    const file = path.join(directory, 'events.jsonl')
    await fs.mkdir(directory)
    const raw = [
      {...historical(), version: 1},
      {...current(), version: 2},
      {...current(), extra: {status: 'unknown'}, id: 'additive'},
    ]
      .map((record) => JSON.stringify(record) + '\n')
      .join('')
    await fs.writeFile(file, raw)
    const store = new FileSessionLogStore({rootDir: root})
    try {
      expect((await store.list('session-1')).data.map((record) => record.id)).deep.equals([
        'historical',
        'current',
        'additive',
      ])
      const first = await store.list('session-1', {after: 'historical', limit: 1})
      expect(first.data[0].id).equals('current')
      const rest = await store.list('session-1', {after: first.next})
      expect(rest.data.map((record) => record.id)).deep.equals(['additive'])
      expect(rest.data[0]).property('extra').deep.equals({status: 'unknown'})
      expect(await fs.readFile(file, 'utf8')).equals(raw)
    } finally {
      await store.close()
      await fs.rm(root, {force: true, recursive: true})
    }
  })
})
