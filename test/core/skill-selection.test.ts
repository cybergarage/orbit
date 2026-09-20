// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type {Model, SkillIO} from '../../src/core/index.js'
import type {SessionEntry} from '../../src/core/session/entries.js'

import {
  Agent,
  MemorySessionLogStore,
  Message,
  MessageType,
  Session,
  Skill,
  SkillCatalog,
  State,
} from '../../src/core/index.js'
import {encodeSessionEntry, parseSessionFile} from '../../src/core/session/codec.js'
import {skillId} from '../../src/core/skills/catalog.js'
import {
  parseSkillSource,
  SKILL_RECORD_BYTES,
  SKILL_RECORD_SNAPSHOTS,
  skillDigest,
} from '../../src/core/skills/parser.js'
import {parseSkillEntry, validateSkillEntries} from '../../src/core/skills/record.js'

const source = (name = 'review', body = 'SKILL_SENTINEL: inspect the target tests.') =>
  `---\nname: ${name}\ndescription: "Review tests: carefully"\n---\n${body}\n`
async function write(root: string, name = 'review', content = source(name)) {
  const dir = path.join(root, name)
  await fs.mkdir(dir, {recursive: true})
  await fs.writeFile(path.join(dir, 'SKILL.md'), content)
  return path.join(dir, 'SKILL.md')
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return {promise, resolve}
}

const parse = (extra: string) =>
  parseSkillSource(`---\nname: review\ndescription: Inspect tests\n${extra}\n---\nbody`)

describe('explicit run-scoped Skill selection', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-skills-')))
  })

  afterEach(async () => {
    await fs.rm(root, {force: true, recursive: true})
  })

  it('exports the catalog and preserves the permissive legacy parser', () => {
    expect(SkillCatalog).to.be.a('function')
    const legacy = new Skill({content: '---\nname: first\nname: second\ndescription: legacy\n---\nbody'})
    expect(legacy).to.be.instanceOf(Skill)
    expect(() => parseSkillSource('---\nname: first\nname: second\ndescription: legacy\n---\nbody')).to.throw()
  })

  it('parses quoted and block strings with BOM and CRLF without changing raw bytes', async () => {
    const raw =
      '\uFEFF---\r\nname: "review"\r\ndescription: |\r\n  Two lines\r\n  of description\r\n---\r\n  Inspect this.\r\n'
    await write(root, 'review', raw)
    const catalog = new SkillCatalog([{directory: root, id: 'local'}])
    const list = await catalog.list()
    expect(list.complete).to.equal(true)
    expect(list.candidates).to.have.length(1)
    expect(list.candidates[0]).not.to.have.property('source')
    const [snapshot] = await catalog.resolve(list.candidates)
    expect(snapshot.source).to.equal(raw)
    expect(snapshot.digest).to.equal(skillDigest(Buffer.from(raw)))
    expect(snapshot.body).to.equal('Inspect this.')
    expect(snapshot.description).to.equal('Two lines\nof description\n')
  })
  for (const metadata of [
    'name: review\ndescription: 1',
    'name: review\ndescription: yes\nextra: no',
    'name: review\nname: other\ndescription: text',
    'name: &id review\ndescription: *id',
    'name: !!str review\ndescription: text',
    'name: review\ndescription: !custom text',
    'name: review\ndescription: [nested]',
    'name: review\ndescription: {nested: text}',
    'name: review\ndescription: ""',
    'name: Bad--Name\ndescription: text',
    'name: review\ndescription: text\n...\nname: other',
  ])
    it('rejects unsupported metadata ' + JSON.stringify(metadata), () => {
      expect(() => parseSkillSource(`---\n${metadata}\n---\nbody`)).to.throw()
    })

  it('bounds descriptions by Unicode code points and rejects empty bodies', () => {
    expect(
      parseSkillSource(`---\nname: review\ndescription: ${'😀'.repeat(1024)}\n---\nbody`).description,
    ).to.have.length(2048)
    expect(() => parseSkillSource(`---\nname: review\ndescription: ${'😀'.repeat(1025)}\n---\nbody`)).to.throw()
    expect(() => parseSkillSource(source('review', ' '))).to.throw()
  })

  it('validates optional descriptive metadata without granting tool permissions', () => {
    expect(parse('license: MIT').license).to.equal('MIT')
    expect(parse(`compatibility: ${'😀'.repeat(500)}`).compatibility).to.have.length(1000)
    for (const extra of [
      'license: 1',
      'license: null',
      'license: " "',
      'license: [MIT]',
      'compatibility: false',
      'compatibility: ""',
      `compatibility: ${'😀'.repeat(501)}`,
      'license: MIT\nlicense: Apache-2.0',
      'license: &x MIT',
      'compatibility: !!str node',
      'allowed-tools: Bash',
    ])
      expect(() => parse(extra)).to.throw()
    expect(parse('license: |\n  See LICENSE\ncompatibility: Node.js').license).to.equal('See LICENSE\n')
  })

  it('preserves descriptive metadata through selection and rejects stale selection', async () => {
    const raw = source().replace(
      '---\nSKILL_SENTINEL',
      'license: MIT\ncompatibility: Requires Node.js\n---\nSKILL_SENTINEL',
    )
    const file = await write(root, 'review', raw)
    const catalog = new SkillCatalog([{directory: root, id: 'local'}])
    const list = await catalog.list()
    expect(list.complete).to.equal(true)
    expect(list.candidates[0]).to.include({compatibility: 'Requires Node.js', license: 'MIT'})
    expect(list.candidates[0]).not.to.have.property('body')
    const [snapshot] = await catalog.resolve(list.candidates)
    expect(snapshot).to.include({
      compatibility: 'Requires Node.js',
      license: 'MIT',
      projectionRevision: 'yaml-2.9.1-body-v2',
    })
    await fs.writeFile(file, raw.replace('MIT', 'Apache-2.0'))
    await assert.rejects(catalog.resolve(list.candidates))
  })

  it('keeps same-name roots distinct and rejects canonical aliases as a whole', async () => {
    await write(root)
    const second = path.join(root, 'second')
    await write(second)
    const catalog = new SkillCatalog([
      {directory: root, id: 'a'},
      {directory: second, id: 'b'},
    ])
    const list = await catalog.list()
    expect(list.candidates).to.have.length(2)
    expect(new Set(list.candidates.map((c) => c.id)).size).to.equal(2)
    await assert.rejects(
      new SkillCatalog([
        {directory: root, id: 'a'},
        {directory: root, id: 'b'},
      ]).list(),
      /aliases/,
    )
    expect(
      () =>
        new SkillCatalog([
          {directory: root, id: 'a'},
          {directory: second, id: 'a'},
        ]),
    ).to.throw()
  })

  it('reports absent roots and rejects symlinks, hard links, invalid UTF-8 and names', async () => {
    const file = await write(root)
    await fs.symlink(path.join(root, 'review'), path.join(root, 'linked'))
    await fs.mkdir(path.join(root, 'hard'))
    await fs.link(file, path.join(root, 'hard', 'SKILL.md'))
    await write(root, 'wrong', source('different'))
    await write(root, 'invalid')
    await fs.appendFile(path.join(root, 'invalid', 'SKILL.md'), Buffer.from([0xff]))
    const list = await new SkillCatalog([
      {directory: root, id: 'a'},
      {directory: path.join(root, 'absent'), id: 'missing'},
    ]).list()
    expect(list.candidates).to.deep.equal([])
    expect(list.complete).to.equal(false)
    expect(list.issues.join(' ')).to.include('Missing Skill root')
  })

  it('marks a listing incomplete when its only configured root is missing', async () => {
    const list = await new SkillCatalog([{directory: path.join(root, 'absent'), id: 'missing'}]).list()
    expect(list.complete).to.equal(false)
    expect(list.candidates).to.deep.equal([])
    expect(list.issues).to.deep.equal(['Missing Skill root: missing'])
  })

  it('requires relisting after content or byte-identical inode replacement', async () => {
    const file = await write(root)
    const catalog = new SkillCatalog([{directory: root, id: 'a'}])
    const old = (await catalog.list()).candidates
    await fs.writeFile(file + '.new', source())
    await fs.rename(file + '.new', file)
    await assert.rejects(catalog.resolve(old), /identity changed/)
    const refreshed = (await catalog.list()).candidates
    expect(refreshed[0].id).to.equal(old[0].id)
    expect((await catalog.resolve(refreshed))[0].source).to.equal(source())
    await fs.writeFile(file, source('review', 'Changed instructions'))
    await assert.rejects(catalog.resolve(refreshed), /changed/)
  })

  it('refuses a rebound configured root until relisting and gives it a new source ID', async () => {
    const a = path.join(root, 'a')
    const b = path.join(root, 'b')
    const alias = path.join(root, 'alias')
    await write(a)
    await write(b)
    await fs.symlink(a, alias)
    const catalog = new SkillCatalog([{directory: alias, id: 'same'}])
    const old = (await catalog.list()).candidates
    await fs.unlink(alias)
    await fs.symlink(b, alias)
    await assert.rejects(catalog.resolve(old), /binding changed/)
    const next = (await catalog.list()).candidates
    expect(next[0].id).not.to.equal(old[0].id)
    await catalog.resolve(next)
  })

  it('enforces listing and selection ceilings across invalid candidates', async () => {
    await write(root)
    await write(root, 'other')
    const small = new SkillCatalog([{directory: root, id: 'a'}], {fileBytes: 20, listingBytes: 30})
    const list = await small.list()
    expect(list.complete).to.equal(false)
    expect(list.candidates).to.deep.equal([])
    expect(list.issues.join(' ')).to.include('Skill listing byte limit exceeded')
    const fileLimited = await new SkillCatalog([{directory: root, id: 'a'}], {
      fileBytes: 20,
      listingBytes: 1000,
    }).list()
    expect(fileLimited.issues.join(' ')).to.include('Skill file byte limit exceeded')
    const catalog = new SkillCatalog([{directory: root, id: 'a'}], {selections: 1})
    const {candidates} = await catalog.list()
    await assert.rejects(catalog.resolve(candidates), /selection limit/)
    await assert.rejects(catalog.resolve([candidates[0], candidates[0]]), /duplicate/)
    const limited = await new SkillCatalog([{directory: root, id: 'a'}], {entries: 1}).list()
    expect(limited.complete).to.equal(false)
    expect(limited.candidates).to.have.length.at.most(1)
  })

  it('closes a descriptor that opens after cancellation', async () => {
    await write(root)
    const entered = deferred<void>()
    const release = deferred<void>()
    let closes = 0
    const io: SkillIO = {
      ...fs,
      async open(...args: Parameters<typeof fs.open>) {
        const handle = await fs.open(...args)
        entered.resolve()
        await release.promise
        const close = handle.close.bind(handle)
        handle.close = async () => {
          closes++
          await close()
        }

        return handle
      },
    }
    const catalog = new SkillCatalog([{directory: root, id: 'a'}], {}, io)
    const controller = new AbortController()
    const loading = catalog.list(controller.signal)
    const rejection = assert.rejects(loading, /cancelled/)
    await entered.promise
    controller.abort()
    release.resolve()
    await rejection
    expect(closes).to.equal(1)
  })

  it('retains a failed close for explicit cleanup retry and refuses reuse', async () => {
    await write(root)
    let attempts = 0
    const io: SkillIO = {
      ...fs,
      async open(...args: Parameters<typeof fs.open>) {
        const handle = await fs.open(...args)
        const close = handle.close.bind(handle)
        handle.close = async () => {
          if (++attempts === 1) throw new Error('Injected close failure')
          await close()
        }

        return handle
      },
    }
    const catalog = new SkillCatalog([{directory: root, id: 'a'}], {}, io)
    await assert.rejects(catalog.list(), /close failed/)
    await assert.rejects(catalog.list(), /cleanup/)
    await catalog.settle()
    expect(attempts).to.equal(2)
    expect((await catalog.list()).candidates).to.have.length(1)
  })

  async function fixture(optionalMetadata = false) {
    await write(
      root,
      'review',
      optionalMetadata
        ? source().replace('---\nSKILL_SENTINEL', 'license: MIT\ncompatibility: Requires Node.js\n---\nSKILL_SENTINEL')
        : source(),
    )
    await write(root, 'second')
    let reads = 0
    const io: SkillIO = {
      ...fs,
      async open(...args: Parameters<typeof fs.open>) {
        reads++
        return fs.open(...args)
      },
    }
    const catalog = new SkillCatalog([{directory: root, id: 'fixture'}], {}, io)
    const {candidates} = await catalog.list()
    const session = new Session({formatVersion: 2})
    const requests: string[][] = []
    const model: Model = {
      getModel: () => 'fixture',
      getName: () => 'fixture',
      getProvider: () => 'ollama',
      async invoke(messages) {
        expect(session.getSkillContexts().length).to.be.greaterThan(0)
        requests.push(messages.map((m) => m.content))
        return new Message(MessageType.Assistant, {content: 'Done'})
      },
    }
    const logs = new MemorySessionLogStore()
    const agent = new Agent({
      cwd: root,
      deps: {createModel: () => model},
      logStore: logs,
      settings: {model: 'fixture', provider: 'ollama'},
      skillCatalog: catalog,
      state: new State(session),
      toolProfile: 'none',
    })
    return {agent, candidates, catalog, logs, readCount: () => reads, requests, session}
  }

  it('applies a snapshot once per Run and replays without reading changed files', async () => {
    const f = await fixture()
    try {
      const input = [new Message(MessageType.User, {content: 'Inspect'})]
      const options = {requestId: 'skill-replay', skills: f.candidates}
      const first = await f.agent.startRun(input, options)
      expect((await first.finished).outcome).to.equal('completed')
      expect(f.requests[0].filter((s) => s.includes('SKILL_SENTINEL'))).to.have.length(2)
      expect(f.session.getConversationMessages().some((m) => m.content.includes('SKILL_SENTINEL'))).to.equal(false)
      const reads = f.readCount()
      await fs.writeFile(f.candidates[0].file, 'replaced')
      const replay = await f.agent.startRun(input, options)
      expect(replay.getSnapshot().runId).to.equal(first.getSnapshot().runId)
      expect(f.readCount()).to.equal(reads)
      await assert.rejects(f.agent.startRun(input, {...options, skills: [...f.candidates].reverse()}))
      expect(
        (await (await f.agent.startRun([new Message(MessageType.User, {content: 'Next'})])).finished).outcome,
      ).to.equal('completed')
      expect(f.requests[1].some((s) => s.includes('SKILL_SENTINEL'))).to.equal(false)
      expect(
        new Session({
          entries: f.session.getEntries(),
          formatVersion: 2,
          metadata: f.session.getMetadata(),
        }).getSkillContexts(),
      ).to.have.length(1)
    } finally {
      await f.agent.close()
      await f.logs.close()
    }
  })

  it('reopens legacy and descriptive projections and detects metadata tampering', async () => {
    const f = await fixture(true)
    try {
      await (
        await f.agent.startRun([new Message(MessageType.User, {content: 'Inspect'})], {skills: f.candidates})
      ).finished
      const record = f.session.getSkillContexts()[0]
      const current = record.skills.findIndex((s) => s.license === 'MIT')
      expect(current).to.be.greaterThan(-1)
      expect(record.skills.map((s) => s.projectionRevision)).to.include.members([
        'yaml-2.9.1-body-v1',
        'yaml-2.9.1-body-v2',
      ])
      const reopened = new Session({
        entries: f.session.getEntries(),
        formatVersion: 2,
        metadata: f.session.getMetadata(),
      })
      expect(reopened.getSkillContexts()[0].skills[current]).to.include({
        compatibility: 'Requires Node.js',
        license: 'MIT',
      })
      for (const field of ['license', 'compatibility'] as const) {
        const altered = structuredClone(record)
        altered.skills[current][field] = 'changed'
        expect(() => parseSkillEntry(altered)).to.throw('derivation')
        delete altered.skills[current][field]
        expect(() => parseSkillEntry(altered)).to.throw('derivation')
        const legacy = structuredClone(record)
        legacy.skills[1 - current][field] = 'injected'
        expect(() => parseSkillEntry(legacy)).to.throw('derivation')
      }

      const wrongRevision = structuredClone(record)
      wrongRevision.skills[current].projectionRevision = 'yaml-2.9.1-body-v1'
      expect(() => parseSkillEntry(wrongRevision)).to.throw('projection')
      expect(f.requests[0].some((s) => s.includes('Requires Node.js'))).to.equal(false)
    } finally {
      await f.agent.close()
      await f.logs.close()
    }
  })

  it('rejects altered body, metadata, revision, record identity and ordering on reopen', async () => {
    const f = await fixture()
    try {
      await (
        await f.agent.startRun([new Message(MessageType.User, {content: 'Inspect'})], {skills: f.candidates})
      ).finished
      const entries = f.session.getEntries()
      const record = f.session.getSkillContexts()[0]
      expect(record).not.to.equal(undefined)
      for (const field of ['body', 'description', 'projectionRevision', 'source', 'id', 'rootId'] as const) {
        const altered = structuredClone(record)
        altered.skills[0][field] = 'altered'
        expect(() => parseSkillEntry(altered)).to.throw()
      }

      for (const invalid of [
        [...entries, record],
        [...entries, entries.find((e) => e.type === 'turn_context')!],
        [...entries, entries.find((e) => e.type === 'turn_event' && e.phase === 'started')!],
        [record, ...entries.filter((e) => e.type !== 'skill_context')],
        [...entries.filter((e) => e.type !== 'skill_context'), record],
        entries.filter((e) => e.type !== 'turn_context'),
      ])
        expect(() => validateSkillEntries(invalid as SessionEntry[], f.session.getId(), 2)).to.throw()
      expect(() => validateSkillEntries(entries, f.session.getId(), 1)).to.throw()
      const oversized = JSON.stringify({...record, extra: 'x'.repeat(SKILL_RECORD_BYTES)})
      expect(() =>
        parseSessionFile(entries[0] ? encodeSessionEntry(entries[0]) + oversized + '\n' : '', 'fixture'),
      ).to.throw('4 MiB')
      expect(() => parseSkillEntry({...record, extra: 'x'.repeat(SKILL_RECORD_BYTES)})).to.throw('4 MiB')
      const tiny = new SkillCatalog([{directory: root, id: 'fixture'}], {fileBytes: 1, selections: 1})
      expect((await tiny.list()).complete).to.equal(false)
      expect(parseSkillEntry(record).skills).to.have.length(2)
      const snapshots = Array.from({length: SKILL_RECORD_SNAPSHOTS + 1}, (_, index) => {
        const skill = structuredClone(record.skills[0])
        skill.rootId = `root-${index}`
        skill.id = skillId(skill.rootId, skill.rootDirectory, skill.file)
        return skill
      })
      expect(parseSkillEntry({...record, skills: snapshots.slice(0, SKILL_RECORD_SNAPSHOTS)}).skills).to.have.length(
        SKILL_RECORD_SNAPSHOTS,
      )
      expect(() => parseSkillEntry({...record, skills: snapshots})).to.throw('snapshot limit')
    } finally {
      await f.agent.close()
      await f.logs.close()
    }
  })

  it('reports denied directory reads without acquiring a writer', async () => {
    await write(root)
    const io: SkillIO = {
      ...fs,
      async opendir() {
        throw new Error('EACCES fixture')
      },
    }
    const result = await new SkillCatalog([{directory: root, id: 'local'}], {}, io).list()
    expect(result.complete).to.equal(false)
    expect(result.issues.join(' ')).to.include('EACCES')
    expect(result.candidates).to.deep.equal([])
  })

  it('exercises the initial 128-candidate and 64-KiB file bounds', async () => {
    const base = source()
    await write(
      root,
      'review',
      source(
        'review',
        'x'.repeat(65_536 - Buffer.byteLength(base) + 'SKILL_SENTINEL: inspect the target tests.'.length),
      ),
    )
    const catalog = new SkillCatalog([{directory: root, id: 'local'}])
    const list = await catalog.list()
    expect(list.candidates[0].bytes).to.equal(65_536)
    expect((await catalog.resolve(list.candidates))[0].bytes).to.equal(65_536)
    await fs.appendFile(list.candidates[0].file, 'x')
    expect((await catalog.list()).candidates).to.have.length(0)
    await fs.rm(path.join(root, 'review'), {recursive: true})
    await Promise.all(Array.from({length: 129}, (_, i) => write(root, 'test-' + i)))
    const bounded = await catalog.list()
    expect(bounded.complete).to.equal(false)
    expect(bounded.candidates).to.have.length(128)
    expect(await catalog.resolve(bounded.candidates.slice(0, 4))).to.have.length(4)
    await assert.rejects(catalog.resolve(bounded.candidates.slice(0, 5)), /selection limit/)
  })
  for (const phase of ['read', 'close'])
    it('waits for cancelled ' + phase + ' to settle before releasing ownership', async () => {
      await write(root)
      let closes = 0;
        let delayed = false
      const entered = deferred<void>();
        const release = deferred<void>()
      const io: SkillIO = {
        ...fs,
        async open(...args: Parameters<typeof fs.open>) {
          const h = await fs.open(...args);
            const read = h.read.bind(h);
            const close = h.close.bind(h)
          if (delayed) {
            if (phase === 'read')
              h.read = async (...params: Parameters<typeof h.read>) => {
                entered.resolve()
                await release.promise
                return read(...params)
              }

            h.close = async () => {
              if (phase === 'close') {
                entered.resolve()
                await release.promise
              }

              await close()
              closes++
            }
          }

          return h
        },
      }
      const c = new SkillCatalog([{directory: root, id: 'root'}], {}, io);
        const list = await c.list()
      delayed = true
      const controller = new AbortController()
      const resolution = c.resolve(list.candidates, controller.signal);
        const rejection = assert.rejects(resolution, /cancelled/)
      await entered.promise
      controller.abort()
      let settled = false
      const cleanup = c.settle().then(() => {
        settled = true
      })
      await new Promise<void>((r) => {
        setImmediate(r)
      })
      expect(settled).to.equal(false)
      release.resolve()
      await rejection
      await cleanup
      expect(closes).to.equal(1)
    })

  it('charges failed read requests against the global listing byte ceiling', async () => {
    await write(root)
    await write(root, 'second')
    let requested = 0
    const io: SkillIO = {...fs, async open(...args: Parameters<typeof fs.open>) {
      const h = await fs.open(...args)
      h.read = async (...params: Parameters<typeof h.read>) => {
        if (!Buffer.isBuffer(params[0])) throw new Error('Expected bounded buffer read')
        requested += params[0].length
        throw new Error('Read outcome unconfirmed')
      }

      return h
    }}
    const result = await new SkillCatalog([{directory: root, id: 'fixture'}], {listingBytes: 10}, io).list()
    expect(result.complete).to.equal(false)
    expect(result.candidates).to.deep.equal([])
    expect(requested).to.equal(10)
  })

})
