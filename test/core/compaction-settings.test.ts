// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {Agent, MemorySessionLogStore, Message, MessageType, Session, State} from '../../src/core/index.js'
import {structuredSummaryAlgorithm} from '../../src/core/session/compaction-algorithm.js'
import {
  resolveCompactionComponents,
  validateCompactionComponents,
} from '../../src/core/session/compaction-components.js'
import {budgetedCompactionStrategy} from '../../src/core/session/compaction-strategy.js'
import {loadWorkspaceSettings, loadWorkspaceSettingsSync} from '../../src/core/settings.js'

const selected = {algorithm: 'structured-summary-v1', strategy: 'budgeted-suffix-v1'}
const profile = {
  model: 'fixture',
  outputReserve: 1000,
  provider: 'ollama',
  revision: 'settings-test',
  safetyMargin: 100,
  summaryOutput: 800,
  target: 1500,
  templateOverhead: 0,
  trigger: 2000,
  window: 20_000,
}

describe('Compaction settings', () => {
  let root: string
  let file: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-compaction-settings-'))
    await fs.mkdir(path.join(root, '.orbit'))
    file = path.join(root, '.orbit', 'settings.json')
  })

  afterEach(async () => {
    await fs.rm(root, {force: true, recursive: true})
  })

  for (const choices of [{}, {strategy: selected.strategy}, {algorithm: selected.algorithm}, selected]) {
    it(`loads independent selections ${JSON.stringify(choices)} through both loaders`, async () => {
      await fs.writeFile(file, JSON.stringify({contextPolicy: {mode: 'budgeted', profile, ...choices}}))
      const expected = {mode: 'budgeted', profile, ...selected}
      expect((await loadWorkspaceSettings(root)).contextPolicy).to.deep.equal(expected)
      expect(loadWorkspaceSettingsSync(root).contextPolicy).to.deep.equal(expected)
    })
  }

  for (const field of ['strategy', 'algorithm']) {
    for (const value of ['missing', '', 'toString', null, {}, 42]) {
      it(`rejects ${field} value ${JSON.stringify(value)} at configuration loading`, async () => {
        await fs.writeFile(file, JSON.stringify({contextPolicy: {[field]: value, mode: 'budgeted', profile}}))
        expect(() => loadWorkspaceSettingsSync(root)).to.throw(`Unknown compaction ${field}`)
        let error: unknown
        try {
          await loadWorkspaceSettings(root)
        } catch (error_) {
          error = error_
        }

        expect(String(error)).to.include(`Unknown compaction ${field}`)
      })
    }
  }

  for (const strategy of ['budgeted-suffix-v1', 'eocc-v1', 'sac-v1']) {
    for (const algorithm of ['structured-summary-v1', 'handoff-summary-v1']) {
      it(`loads built-in pair ${strategy}/${algorithm} independently of action mode`, async () => {
        await fs.writeFile(
          file,
          JSON.stringify({
            contextPolicy: {algorithm, mode: 'budgeted', profile, strategy},
            executionActionMode: 'single',
          }),
        )
        for (const settings of [await loadWorkspaceSettings(root), loadWorkspaceSettingsSync(root)]) {
          expect(settings.executionActionMode).to.equal('single')
          expect(settings.contextPolicy).to.include({algorithm, strategy})
        }
      })
    }
  }

  for (const executionActionMode of ['unknown', null, 1, {}]) {
    it(`rejects invalid action mode ${JSON.stringify(executionActionMode)}`, async () => {
      await fs.writeFile(file, JSON.stringify({executionActionMode}))
      expect(() => loadWorkspaceSettingsSync(root)).to.throw('Unknown execution action mode')
    })
  }

  it('rejects schema and cumulative-update incompatibility', () => {
    const components = resolveCompactionComponents(selected)
    expect(components.strategy).to.equal(budgetedCompactionStrategy)
    expect(components.algorithm).to.equal(structuredSummaryAlgorithm)
    expect(() =>
      validateCompactionComponents({...components, algorithm: {...components.algorithm, summarySchema: 'unsupported'}}),
    ).to.throw('Incompatible compaction components')
    expect(() =>
      validateCompactionComponents({
        ...components,
        algorithm: {...components.algorithm, supportsCumulativeUpdates: false},
      }),
    ).to.throw('Incompatible compaction components')
  })

  it('replaces the complete inherited policy and resolves omitted selections', async () => {
    await fs.writeFile(file, JSON.stringify({contextPolicy: {mode: 'budgeted', profile, ...selected}}))
    const child = path.join(root, 'child')
    await fs.mkdir(path.join(child, '.orbit'), {recursive: true})
    await fs.writeFile(
      path.join(child, '.orbit', 'settings.json'),
      JSON.stringify({
        contextPolicy: {algorithm: selected.algorithm, mode: 'budgeted', profile: {...profile, target: 1000}},
      }),
    )
    expect((await loadWorkspaceSettings(child)).contextPolicy).to.deep.equal({
      mode: 'budgeted',
      profile: {...profile, target: 1000},
      ...selected,
    })
  })

  it('uses file selections in Agent and keeps the active run fixed when caller settings change', async () => {
    await fs.writeFile(
      file,
      JSON.stringify({
        contextPolicy: {mode: 'budgeted', profile, ...selected},
        model: 'fixture',
        provider: 'ollama',
        tools: {profile: 'none'},
      }),
    )
    const session = new Session()
    const [source] = session.appendMessages([
      new Message(MessageType.User, {content: 'Investigate ' + 'x '.repeat(6000)}),
      new Message(MessageType.Assistant, {content: 'The test failed'}),
    ])
    let summaries = 0
    let calls = 0
    const store = new MemorySessionLogStore()
    const agent = new Agent({
      cwd: root,
      deps: {
        createModel: () => ({
          getModel: () => 'fixture',
          getName: () => 'fixture',
          getProvider: () => 'ollama',
          async invoke() {
            throw new Error('Use prepared input')
          },
          prepare(messages) {
            if (agent.contextPolicy.mode === 'budgeted') agent.contextPolicy.strategy = 'changed-during-run'
            return {
              async invoke() {
                calls++
                if (messages[0].content.startsWith('Summarize')) {
                  summaries++
                  return new Message(MessageType.Assistant, {
                    content: JSON.stringify({
                      changedPaths: [],
                      facts: [],
                      goals: [{sourceIds: [source.id], text: 'Continue investigation'}],
                      tests: [],
                      uncertainties: [],
                      unfinished: [],
                      version: 1,
                    }),
                  })
                }

                return new Message(MessageType.Assistant, {content: 'Done'})
              },
              request: {messages: messages.map((message) => message.content)},
            }
          },
        }),
      },
      logStore: store,
      state: new State(session),
      toolProfile: 'none',
    })
    try {
      expect(agent.contextPolicy).to.include(selected)
      expect(
        (await (await agent.startRun([new Message(MessageType.User, {content: 'Continue'})])).finished).outcome,
      ).to.equal('completed')
      expect(summaries).to.equal(1)
      expect(session.getCompaction()).to.not.be.undefined
      const priorCalls = calls
      let error: unknown
      try {
        await agent.startRun([new Message(MessageType.User, {content: 'Again'})])
      } catch (error_) {
        error = error_
      }

      expect(String(error)).to.include('Unknown compaction strategy')
      expect(calls).to.equal(priorCalls)
    } finally {
      await agent.close()
      await store.close()
    }
  })
})
