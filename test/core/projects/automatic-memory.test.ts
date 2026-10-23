// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable no-await-in-loop -- Sequential retries and catalog writes are the behavior under test. */
import {expect} from 'chai'
import {randomUUID} from 'node:crypto'

import type {ProjectExtractionJob} from '../../../src/core/projects/types.js'

import {AutomaticProjectMemory, containsMemorySecret, extractionCandidates} from '../../../src/core/projects/automatic-memory.js'
import {catalogDigest} from '../../../src/core/projects/engine.js'
import {selectProjectMemory} from '../../../src/core/projects/memory-context.js'
import {MemoryProjectStore} from '../../../src/core/projects/memory-store.js'

async function fixture() {
  const pairId = randomUUID()
  const projectId = randomUUID()
  const sessionId = randomUUID()
  const store = new MemoryProjectStore()
  await store.mutate(projectId, {
    directory: null,
    expectedRevision: 0,
    id: projectId,
    kind: 'create',
    name: 'Knowledge',
  })
  await store.mutate(randomUUID(), {
    expectedRevision: 0,
    kind: 'membership',
    pairId,
    projectId,
    sessionId,
    unavailable: false,
  })
  const messages = [
    {digest: catalogDigest('message'), id: randomUUID(), role: 'user', text: 'Use PostgreSQL for the catalog.'},
  ]
  const job: ProjectExtractionJob = {
    attempt: 0,
    id: randomUUID(),
    inputTokens: 0,
    membershipRevision: 1,
    messages,
    outputTokens: 0,
    pairId,
    projectId,
    revision: 0,
    runId: randomUUID(),
    sessionId,
    sourceDigest: catalogDigest(messages),
    state: 'pending',
  }
  await store.mutate(job.id, {entries: [], expectedRevision: 0, generation: 0, job, kind: 'extraction'})
  const response = JSON.stringify({
    candidates: [
      {
        body: messages[0].text,
        condition: 'Catalog',
        importance: 3,
        kind: 'decision',
        messageId: messages[0].id,
        quote: messages[0].text,
        title: 'Database',
      },
    ],
  })
  return {job: (await store.query({id: job.id, kind: 'extraction'}))!, response, store}
}

const validate = async (_job: ProjectExtractionJob, apply?: () => Promise<void>) => {
  await apply?.()
  return true
}

describe('Automatic Project knowledge', () => {
  it('applies once, records provenance and freezes reuse', async () => {
    const {job, response, store} = await fixture()
    let calls = 0
    const runner = new AutomaticProjectMemory(
      store,
      async () => {
        calls++
        return {text: response}
      },
      validate,
    )
    await runner.process(job)
    await runner.process((await store.query({id: job.id, kind: 'extraction'}))!)
    expect(calls).equals(1)
    const catalog = await store.query({
      kind: 'snapshot',
      pairId: job.pairId,
      projectId: job.projectId,
      sessionId: job.sessionId,
    })
    const snapshot = selectProjectMemory(catalog, {captureId: randomUUID(), execution: 'agent', request: 'catalog'})
    expect(snapshot.entries).length(1)
    expect(snapshot.entries[0].sources[0].messageId).equals(job.messages[0].id)
    expect((await store.query({id: job.projectId, kind: 'automation'}))?.inputTokens).equals(4096)
  })
  for (const output of ['broken', 'x'.repeat(17_000)])
    it('contains malformed or excessive output', async () => {
      const {job, store} = await fixture()
      await new AutomaticProjectMemory(store, async () => ({text: output}), validate).process(job)
      expect(await store.query({kind: 'memories', projectId: job.projectId})).length(0)
      expect((await store.query({id: job.id, kind: 'extraction'}))?.state).equals('failed')
    })

  it('revalidates source after inference', async () => {
    const {job, response, store} = await fixture()
    let checks = 0
    await new AutomaticProjectMemory(
      store,
      async () => ({text: response}),
      async (_job, apply) => {
        if (++checks > 1) return false
        await apply?.()
        return true
      },
    ).process(job)
    expect(await store.query({kind: 'memories', projectId: job.projectId})).length(0)
  })

  it('discards final validation rejection and retains reported usage without retry inference', async () => {
    const f = await fixture()
    let calls = 0
    const runner = new AutomaticProjectMemory(f.store, async () => {calls++; return {inputTokens: 100, outputTokens: 20, text: f.response}}, async (_job, apply) => !apply)
    await runner.process(f.job)
    const job = (await f.store.query({id: f.job.id, kind: 'extraction'}))!
    expect(job).include({observedInputTokens: 100, observedOutputTokens: 20, state: 'discarded'})
    await runner.process(job)
    expect(calls).equals(1)
    expect(await f.store.query({kind: 'memories', projectId: f.job.projectId})).length(0)
    await f.store.close()
  })

  it('discards oversized input before reserving a model call instead of occupying the queue forever', async () => {
    const f = await fixture()
    const message = {...f.job.messages[0], text: '界'.repeat(6000)}
    const job = {...f.job, id: randomUUID(), messages: [message], revision: 0, sourceDigest: catalogDigest([message])}
    await f.store.mutate(job.id, {entries: [], expectedRevision: 0, generation: 0, job, kind: 'extraction'})
    let calls = 0
    const runner = new AutomaticProjectMemory(f.store, async () => {calls++; return {text: f.response}}, async () => true)
    await runner.process((await f.store.query({id: job.id, kind: 'extraction'}))!)
    expect((await f.store.query({id: job.id, kind: 'extraction'}))?.state).equals('discarded')
    expect(calls).equals(0)
    expect((await f.store.query({kind: 'automation-status', projectId: job.projectId})).queue.pending).equals(1)
    await f.store.close()
  })

  it('bounds retries and reserves failed usage', async () => {
    const {job, store} = await fixture()
    let calls = 0
    const runner = new AutomaticProjectMemory(
      store,
      async () => {
        calls++
        throw new Error('Unavailable')
      },
      validate,
    )
    for (let i = 0; i < 5; i++) await runner.process((await store.query({id: job.id, kind: 'extraction'}))!)
    expect(calls).equals(3)
    expect((await store.query({id: job.projectId, kind: 'automation'}))?.inputTokens).equals(12_288)
  })

  it('ranks Japanese relevance above freshness', async () => {
    const {job, store} = await fixture()
    for (const [title, body] of [
      ['Storage', '保存先は PostgreSQL を利用する'],
      ['Theme', '画面は青色にする'],
    ])
      await store.mutate(randomUUID(), {
        entry: {body, edited: false, id: randomUUID(), projectId: job.projectId, retired: false, sources: [], title},
        expectedRevision: 0,
        kind: 'memory',
      })
    const catalog = await store.query({
      kind: 'snapshot',
      pairId: job.pairId,
      projectId: job.projectId,
      sessionId: job.sessionId,
    })
    expect(
      selectProjectMemory(catalog, {captureId: randomUUID(), execution: 'agent', request: '保存先を確認'}).entries[0]
        .title,
    ).equals('Storage')
  })

  it('holds conflicting decisions with different titles and untargeted natural corrections', async () => {
    for (const kind of ['decision', 'correction'] as const) {
      const {job, response, store} = await fixture()
      await store.mutate(randomUUID(), {entry: {body: 'Use PostgreSQL.', edited: false,
        id: randomUUID(), projectId: job.projectId, retired: false, sources: [], title: 'Database'}, expectedRevision: 0, kind: 'memory'})
      const output = JSON.parse(response)
      output.candidates[0] = {...output.candidates[0], body: 'Use SQLite.', kind, title: 'Storage choice'}
      const message = {...job.messages[0], text: 'Correction: use SQLite instead of PostgreSQL for the catalog.'}
      output.candidates[0].quote = message.text
      const next = {...job, id: randomUUID(), messages: [message], revision: 0, sourceDigest: catalogDigest([message])}
      await store.mutate(next.id, {entries: [], expectedRevision: 0, generation: 0, job: next, kind: 'extraction'})
      await new AutomaticProjectMemory(store, async () => ({text: JSON.stringify(output)}), validate).process((await store.query({id: next.id, kind: 'extraction'}))!)
      const entries = await store.query({kind: 'memories', projectId: job.projectId})
      expect(entries.find((item) => item.body === 'Use SQLite.')?.automatic?.pending).equals(true)
      expect(entries.find((item) => item.body === 'Use PostgreSQL.')?.retired).equals(false)
      await store.close()
    }
  })

  it('selects a related old item beyond the first sixteen within the extractor input budget', async () => {
    const {job, store} = await fixture()
    for (let index = 0; index < 20; index++) await store.mutate(randomUUID(), {entry: {body: `Orchard ${index}`, edited: false, id: randomUUID(), projectId: job.projectId, retired: false, sources: [], title: `Unrelated ${index}`}, expectedRevision: 0,
      kind: 'memory'})
    const target = 'ffffffff-ffff-4fff-afff-ffffffffffff'
    await store.mutate(randomUUID(), {entry: {body: 'Use PostgreSQL for the catalog.', edited: false,
      id: target, projectId: job.projectId, retired: false, sources: [], title: 'Database'}, expectedRevision: 0, kind: 'memory'})
    let selected: string[] = []
    const message = {...job.messages[0], text: 'Correction: use SQLite instead of PostgreSQL for the catalog.'}
    const next = {...job, id: randomUUID(), messages: [message], revision: 0, sourceDigest: catalogDigest([message])}
    await store.mutate(next.id, {entries: [], expectedRevision: 0, generation: 0, job: next, kind: 'extraction'})
    await new AutomaticProjectMemory(store, async (input) => {
      selected = JSON.parse(input).existing.map((item: {id: string}) => item.id)
      return {text: JSON.stringify({candidates:[{body:'Use SQLite for the catalog.',condition:'',importance:3,kind:'correction',
        messageId:message.id,quote:message.text,supersedes:selected.find(id => id === target),title:'Storage choice'}]})}
    }, validate).process((await store.query({id:next.id,kind:'extraction'}))!)
    expect((await store.query({id:target,kind:'memory'}))?.retired).equals(true)
    expect(selected).includes(target)
    expect(selected.length).at.most(16)
    await store.close()
  })

  it('normalizes an unconditional null from the synthetic local-model trial', async () => {
    const {job, response} = await fixture()
    const output = JSON.parse(response)
    output.candidates[0].condition = null
    expect(extractionCandidates(job, JSON.stringify(output))[0].automatic?.condition).equals('')
  })

  it('serializes concurrent claims and applies one candidate', async () => {
    const {job, response, store} = await fixture()
    let calls = 0
    const runner = new AutomaticProjectMemory(store, async () => {calls++; return {text: response}}, validate)
    const outcomes = await Promise.allSettled([runner.process(job), runner.process(job)])
    expect(outcomes.filter((item) => item.status === 'fulfilled')).length(1)
    expect(calls).equals(1)
    expect(await store.query({kind: 'memories', projectId: job.projectId})).length(1)
  })

  it('retains tombstones across another run with the same candidate', async () => {
    const {job, response, store} = await fixture()
    const runner = new AutomaticProjectMemory(store, async () => ({text: response}), validate)
    await runner.process(job)
    const prior = (await store.query({kind: 'memories', projectId: job.projectId}))[0]
    const entry = {automatic: prior.automatic, body: prior.body, edited: prior.edited, id: prior.id, projectId: prior.projectId, retired: true, sources: prior.sources, title: prior.title}
    await store.mutate(randomUUID(), {entry: {...entry, retired: true}, expectedRevision: prior.revision, kind: 'memory'})
    const next = {...job, id: randomUUID(), revision: 0, runId: randomUUID()}
    await store.mutate(next.id, {entries: [], expectedRevision: 0, generation: 0, job: next, kind: 'extraction'})
    await runner.process((await store.query({id: next.id, kind: 'extraction'}))!)
    expect((await store.query({id: prior.id, kind: 'memory'}))?.retired).equals(true)
    expect(await store.query({kind: 'memories', projectId: job.projectId, retired: false})).length(0)
  })

  it('refuses over-budget inference and cross-Project membership', async () => {
    const {job, store} = await fixture()
    await store.mutate(randomUUID(), {config: {enabled: true,
      id: job.projectId, inputTokens: 0, maxInputTokens: 1, maxOutputTokens: 1, outputTokens: 0, revision: 0}, expectedRevision: 0, kind: 'automation'})
    let calls = 0
    const results = await Promise.allSettled([new AutomaticProjectMemory(store, async () => {calls++; return {text: '{}'}}, validate).process(job)])
    expect(results[0].status).equals('rejected')
    expect(calls).equals(0)
    const changed = {...job, id: randomUUID(), projectId: randomUUID(), revision: 0}
    const invalid = await Promise.allSettled([store.mutate(changed.id, {entries: [], expectedRevision: 0, generation: 0, job: changed, kind: 'extraction'})])
    expect(invalid[0].status).equals('rejected')
  })

  it('records reported usage independently from upper reservations and enforces a lifetime call cap', async () => {
    const {job, response, store} = await fixture()
    await store.mutate(randomUUID(), {config: {enabled: true,
      id: job.projectId, inputTokens: 0, maxCalls: 1, maxInputTokens: 100_000, maxOutputTokens: 16_000, outputTokens: 0, revision: 0}, expectedRevision: 0, kind: 'automation'})
    let calls = 0
    const runner = new AutomaticProjectMemory(store, async () => {calls++; return {inputTokens: 123, outputTokens: 45, text: response}}, validate)
    await runner.process(job)
    const status = await store.query({kind: 'automation-status', projectId: job.projectId})
    expect(status.config).include({calls: 1, inputTokens: 4096, observedInputTokens: 123, observedOutputTokens: 45, outputTokens: 1024})
    const next = {...job, id: randomUUID(), revision: 0, runId: randomUUID()}
    await store.mutate(next.id, {entries: [], expectedRevision: 0, generation: 0, job: next, kind: 'extraction'})
    const results = await Promise.allSettled([runner.process((await store.query({id: next.id, kind: 'extraction'}))!)])
    expect(results[0].status).equals('rejected')
    expect(calls).equals(1)
  })

  it('settles reported usage after stopping in-flight work without applying knowledge or starting another call', async () => {
    const {job, response, store} = await fixture()
    let calls = 0
    const runner = new AutomaticProjectMemory(store, async () => {
      calls++
      const config = (await store.query({id: job.projectId, kind: 'automation'}))!
      await store.mutate(randomUUID(), {config: {...config, enabled: false}, expectedRevision: config.revision, kind: 'automation'})
      return {inputTokens: 100, outputTokens: 20, text: response}
    }, validate)
    await runner.process(job)
    const status = await store.query({kind: 'automation-status', projectId: job.projectId})
    expect(status.config).include({calls: 1, enabled: false, inputTokens: 4096, observedInputTokens: 100, observedOutputTokens: 20, outputTokens: 1024})
    expect(status.entries).length(0)
    expect(status.jobs[0].state).equals('failed')
    const retry = await Promise.allSettled([runner.process(status.jobs[0])])
    expect(retry[0].status).equals('rejected')
    expect(calls).equals(1)
    await store.close()
  })

  it('pauses learning on reported usage overruns and retains the observed discrepancy', async () => {
    const {job, response, store} = await fixture()
    await new AutomaticProjectMemory(store, async () => ({inputTokens: 5000, outputTokens: 45, text: response}), validate).process(job)
    const status = await store.query({kind: 'automation-status', projectId: job.projectId})
    expect(status.config).include({calls: 1, enabled: false, inputTokens: 4096, observedInputTokens: 5000})
    expect(status.jobs[0].state).equals('discarded')
    expect(status.entries).length(0)
  })

  it('records known usage even when output validation fails and never refunds unknown usage', async () => {
    const {job, store} = await fixture()
    await new AutomaticProjectMemory(store, async () => ({inputTokens: 100, outputTokens: 20, text: 'invalid'}), validate).process(job)
    const status = await store.query({kind: 'automation-status', projectId: job.projectId})
    expect(status.config).include({inputTokens: 4096, observedInputTokens: 100, observedOutputTokens: 20, outputTokens: 1024})
    expect(status.jobs[0].state).equals('failed')
  })

  it('applies explicit corrections while preserving the old frozen revision', async () => {
    const {job, response, store} = await fixture()
    await new AutomaticProjectMemory(store, async () => ({text: response}), validate).process(job)
    const old = (await store.query({kind: 'memories', projectId: job.projectId}))[0]
    const frozen = structuredClone(old)
    const messages = [{digest: catalogDigest('correction'), id: randomUUID(), role: 'user', text: 'Correction: use SQLite instead.'}]
    const next = {...job, id: randomUUID(), messages, revision: 0, runId: randomUUID(), sourceDigest: catalogDigest(messages)}
    await store.mutate(next.id, {entries: [], expectedRevision: 0, generation: 0, job: next, kind: 'extraction'})
    const text = JSON.stringify({candidates: [{body: 'Use SQLite instead.', condition: 'Catalog', importance: 3, kind: 'correction', messageId: messages[0].id,
      quote: messages[0].text, supersedes: old.id, title: 'Database'}]})
    await new AutomaticProjectMemory(store, async () => ({text}), validate).process((await store.query({id: next.id, kind: 'extraction'}))!)
    expect((await store.query({id: old.id, kind: 'memory'}))?.retired).equals(true)
    expect((await store.query({kind: 'memories', projectId: job.projectId, retired: false}))[0].body).equals('Use SQLite instead.')
    expect(frozen.body).equals(old.body)
    expect(frozen.revision).equals(1)
  })

  it('suppresses credentials', () => {
    expect(containsMemorySecret('api_key: private-value')).equals(true)
    expect(containsMemorySecret('パスワード： private')).equals(true)
    expect(containsMemorySecret('Run tests locally')).equals(false)
  })
})
