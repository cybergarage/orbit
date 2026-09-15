// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type {JournalRecord} from '../../../src/core/execution/journal.js'

import {coordinationPaths, inspectGraphRun, migrateSessionTranscriptV3, recoverSessionWriter, SessionRepository} from '../../../src/core/index.js'
import {parseSessionFile} from '../../../src/core/session/codec.js'
import {seedLegacyContext} from './legacy-context-fixture.js'
import {seedMaintenanceGraph} from './maintenance-graph-fixture.js'

const offline = {allWritersStopped: true, automaticRestartersDisabled: true, exclusiveStorageControl: true} as const
const encode = (records: unknown[]) => records.map((r) => JSON.stringify(r) + '\n').join('')

const read = (file: string): JournalRecord[] => fs.readFileSync(file, 'utf8').trimEnd().split('\n').map((line) => JSON.parse(line))
function copyDirectory(from: string, to: string): void {
  fs.mkdirSync(to, {recursive: true})
  for (const item of fs.readdirSync(from, {withFileTypes: true})) {
    const source = path.join(from, item.name)
    const target = path.join(to, item.name)
    if (item.isDirectory()) copyDirectory(source, target)
    else fs.copyFileSync(source, target)
  }
}

describe('Graph journal maintenance and migration', () => {
  let root: string
  let repo: SessionRepository
  let file: string
  let graphFile: string
  let runId: string

  beforeEach(async () => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-graph-maintenance-')))
    repo = new SessionRepository({rootDir: path.join(root, 'sessions')})
    repo.initializeStorage(offline)
    const session = repo.create({formatVersion: 2, id: 'fixture'})
    await seedLegacyContext(session, root)
    runId = await seedMaintenanceGraph(session, root)
    file = session.getFile()!
    graphFile = path.join(repo.journalRoot, 'fixture', runId, 'events.jsonl')
    await session.close()
  })

  afterEach(() => fs.rmSync(root, {force: true, recursive: true}))


  it('recovers and migrates v1/v2/v1 Runs without rewriting any journal, Skill or checkpoint', () => {
    const scope = repo.scope('fixture')
    const source = fs.readFileSync(file)
    const records = read(graphFile)
    const directory = path.dirname(path.dirname(graphFile))
    const snapshots = fs.readdirSync(directory).filter((name) => name !== 'key').map((name) => {
      const file = path.join(directory, name, 'events.jsonl')
      return {bytes: fs.readFileSync(file), file, version: read(file)[0].version}
    })
    expect(snapshots.map((s) => s.version).sort()).deep.equal([1, 1, 2])
    fs.writeFileSync(coordinationPaths(scope).guard, '')
    recoverSessionWriter(scope, offline)
    expect(migrateSessionTranscriptV3(scope, file, offline)).equal('migrated')
    expect(migrateSessionTranscriptV3(scope, file, offline, true)).equal('already-migrated')
    expect(fs.readFileSync(file + '.v2-backup').equals(source)).equal(true)
    const after = fs.readFileSync(file)
    expect(after.subarray(after.indexOf(10) + 1).equals(source.subarray(source.indexOf(10) + 1))).equal(true)
    const parsed = parseSessionFile(after.toString(), file)
    expect(parsed.entries.some((e) => e.type === 'skill_context')).equal(true)
    expect(parsed.entries.some((e) => e.type === 'compaction')).equal(true)
    expect(inspectGraphRun(records, {entries: parsed.entries.slice(1), formatVersion: 3, sessionId: 'fixture'}).transcript).equal('verified')
    for (const snapshot of snapshots) expect(fs.readFileSync(snapshot.file).equals(snapshot.bytes)).equal(true)
  })

  it('retains exact evidence across process death at every migration write, sync, rename and removal', function () {
    this.timeout(180_000)
    const saved = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-graph-baseline-'))
    const snapshot = path.join(saved, 'snapshot')
    copyDirectory(root, snapshot)
    const source = fs.readFileSync(file)
    const journal = fs.readFileSync(graphFile)
    const run = (stop: number) => spawnSync(process.execPath, ['test/core/execution/fixtures/graph-migration-interruption.mjs', repo.rootDir, file, String(stop)], {encoding: 'utf8', timeout: 15_000})
    try {
      const baseline = run(0)
      expect(baseline.error).equal(undefined)
      expect(baseline.status, baseline.stderr).equal(0)
      const {steps} = JSON.parse(baseline.stdout)
      expect(steps).greaterThan(20)
      for (let stop = 1; stop <= steps; stop++) {
        fs.rmSync(root, {force: true, recursive: true})
        copyDirectory(snapshot, root)
        const child = run(stop)
        expect(child.error, 'boundary ' + stop).equal(undefined)
        expect(child.signal, child.stderr).equal('SIGKILL')
        expect(JSON.parse(child.stdout).step).equal(stop)
        const scope = repo.scope('fixture')
        const {guard} = coordinationPaths(scope)
        const intent = path.join(repo.rootDir, '.coordination', 'fixture.migration.json')
        if (fs.existsSync(guard) || fs.existsSync(intent)) expect(() => repo.open(file)).to.throw()
        if (fs.existsSync(intent)) expect(() => recoverSessionWriter(scope, offline)).to.throw('migration-aware')
        const pending = fs.existsSync(intent) ? fs.readFileSync(intent) : undefined
        if ((fs.existsSync(guard) && fs.statSync(guard).size === 0) || (pending && pending.length === 0)) {
          expect(() => migrateSessionTranscriptV3(scope, file, offline, true)).to.throw()
          expect(fs.readFileSync(file).equals(source)).equal(true)
          if (pending) expect(fs.readFileSync(intent).equals(pending)).equal(true)
        } else {
          migrateSessionTranscriptV3(scope, file, offline, true)
          expect(fs.readFileSync(file + '.v2-backup').equals(source)).equal(true)
          const target = fs.readFileSync(file)
          expect(target.subarray(target.indexOf(10) + 1).equals(source.subarray(source.indexOf(10) + 1))).equal(true)
          expect(parseSessionFile(target.toString(), file).header.version).equal(3)
        }

        expect(fs.readFileSync(graphFile).equals(journal)).equal(true)
      }

      console.log('Graph migration SIGKILL boundaries verified:', steps)
    } finally {fs.rmSync(saved, {force: true, recursive: true})}
  })

  for (const outcome of ['cancelled', 'failed', 'budget-exceeded']) it('preserves a known ' + outcome + ' terminal during migration', () => {
    const records = read(graphFile)
    records.at(-1)!.data.outcome = outcome
    fs.writeFileSync(graphFile, encode(records))
    const entries = read(file) as unknown as {phase?: string; turnId?: string; type: string;}[]
    const terminalEvent = entries.find((e) => e.type === 'turn_event' && e.turnId === runId && e.phase === 'completed')!
    terminalEvent.phase = outcome === 'cancelled' ? 'cancelled' : 'failed'
    if (outcome !== 'cancelled') Object.assign(terminalEvent, {error: {message: 'Known failure', name: 'FixtureFailure'}})
    fs.writeFileSync(file, encode(entries))
    const original = fs.readFileSync(graphFile)
    migrateSessionTranscriptV3(repo.scope('fixture'), file, offline)
    expect(fs.readFileSync(graphFile).equals(original)).equal(true)
    expect(read(graphFile).at(-1)!.data.outcome).equal(outcome)
  })

  for (const status of ['succeeded', 'failed', 'unknown']) it('refuses an ordinary v1 result without dispatch evidence: ' + status, () => {
    const directory = path.dirname(path.dirname(graphFile))
    const ordinary = fs.readdirSync(directory).filter((name) => name !== 'key').map((name) => path.join(directory, name, 'events.jsonl')).find((file) => read(file)[0].version === 1)!
    const records = read(ordinary)
    const terminal = records.pop()!
    const result = {...terminal, data: {operationId: 'orphan', status}, eventId: 'orphan', kind: 'operation-result' as const}
    records.push(result, {...terminal, data: {...terminal.data, operations: [{id: 'orphan', status}]}, sequence: terminal.sequence + 1})
    fs.writeFileSync(ordinary, encode(records))
    const original = fs.readFileSync(ordinary)
    expect(() => recoverSessionWriter(repo.scope('fixture'), offline)).to.throw('operation evidence')
    expect(() => migrateSessionTranscriptV3(repo.scope('fixture'), file, offline)).to.throw('operation evidence')
    expect(fs.readFileSync(ordinary).equals(original)).equal(true)
  })

  const changes: Record<string, (records: JournalRecord[]) => void> = {
    'changed Graph message reference'(r) {r.find((e) => e.kind === 'graph-node-completed')!.data.messages = ['missing']},
    'changed Graph start position'(r) {r.find((e) => e.kind === 'graph-node-started')!.data.transcriptHighWater = 0},
    'failed cleanup'(r) {r.at(-1)!.data.cleanupErrors = ['close']},
    'failed recording'(r) {(r.at(-1)!.data.recording as {status: string}).status = 'failed'},
    'late settlement cannot upgrade an unknown original terminal'(r) {
      r.at(-1)!.data.outcome = 'incomplete'
      r.push({...r.at(-1)!, data: {operations: [], settled: true}, eventId: 'late', kind: 'late-settlement', sequence: r.length + 1})
    },
    'missing Graph terminal position'(r) {delete r.at(-1)!.data.transcriptHighWater},
    'missing operation output'(r) {
      const start = r.findIndex((e) => e.kind === 'graph-node-started')
      r.splice(start + 1, 0, {...r[start], data: {operationId: 'lost', variant: 'tool-call', visitId: r[start].data.visitId}, eventId: 'intent', kind: 'operation-intent'})
      for (const [i, e] of r.entries()) {e.sequence = i + 1}
    },
    'missing terminal'(r) {r.pop()},
    'mixed versions within a Run'(r) {r[1].version = 1},
    'out of range Graph position'(r) {r.at(-1)!.data.transcriptHighWater = 999_999},
    'recovered recording'(r) {(r.at(-1)!.data.recording as {status: string}).status = 'recovered'},
    'sequence gap'(r) {r[1].sequence++},
    'unknown complete record'(r) {r[1].kind = 'future' as never},
    'unknown original outcome'(r) {r.at(-1)!.data.outcome = 'incomplete'},
    'unknown terminal operation'(r) {r.at(-1)!.data.operations = [{id: 'lost', status: 'unknown'}]},
    'unresolved resources'(r) {r.at(-1)!.data.unresolved = ['child']},
    'unsettled resources'(r) {r.at(-1)!.data.quiescence = false},
    'wrong Run identity'(r) {r[1].runId = 'other'},
    'wrong Session identity'(r) {r[1].sessionId = 'other'},
  }
  for (const [name, change] of Object.entries(changes)) it('refuses ' + name + ' without clearing evidence or guard', () => {
    const records = read(graphFile)
    change(records)
    fs.writeFileSync(graphFile, encode(records))
    const scope = repo.scope('fixture')
    const {guard} = coordinationPaths(scope)
    fs.writeFileSync(guard, 'retained')
    const before = fs.readFileSync(file)
    const journal = fs.readFileSync(graphFile)
    expect(() => recoverSessionWriter(scope, offline)).to.throw()
    expect(() => migrateSessionTranscriptV3(scope, file, offline)).to.throw()
    expect(fs.readFileSync(guard, 'utf8')).equal('retained')
    expect(fs.readFileSync(file).equals(before)).equal(true)
    expect(fs.readFileSync(graphFile).equals(journal)).equal(true)
    expect(fs.existsSync(file + '.v2-backup')).equal(false)
  })

  for (const problem of ['torn journal', 'missing key', 'hard link', 'symlink', 'missing transcript', 'torn transcript', 'terminal phase'])
    it('preserves exclusion for ' + problem, () => {
      const scope = repo.scope('fixture')
      if (problem === 'torn journal') fs.appendFileSync(graphFile, '{')
      if (problem === 'missing key') fs.renameSync(path.join(path.dirname(path.dirname(graphFile)), 'key'), path.join(root, 'held-key'))
      if (problem === 'hard link') fs.linkSync(graphFile, path.join(root, 'held-journal'))
      if (problem === 'symlink') {fs.renameSync(graphFile, path.join(root, 'held-journal')); fs.symlinkSync(path.join(root, 'held-journal'), graphFile)}
      if (problem === 'missing transcript') fs.renameSync(file, file + '.held')
      if (problem === 'torn transcript') fs.appendFileSync(file, '{')
      if (problem === 'terminal phase') {
        const entries = read(file) as unknown as {phase?: string; turnId?: string; type: string;}[]
        entries.find((e) => e.type === 'turn_event' && e.turnId === runId && e.phase === 'completed')!.phase = 'cancelled'
        fs.writeFileSync(file, encode(entries))
      }

      fs.writeFileSync(coordinationPaths(scope).guard, 'retained')
      expect(() => recoverSessionWriter(scope, offline)).to.throw()
      expect(() => migrateSessionTranscriptV3(scope, file, offline)).to.throw()
      expect(fs.readFileSync(coordinationPaths(scope).guard, 'utf8')).equal('retained')
    })
})
