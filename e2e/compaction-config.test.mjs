// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0
import {expect} from 'chai'

import {compactionArms, compactionMetrics, experimentPolicy} from './compaction-config.mjs'

describe('Compaction evaluation configuration', () => {
  it('holds budgets constant across all enabled arms', () => {
    for (const arm of Object.keys(compactionArms)) {
      const policy = experimentPolicy({arm, model: 'fixture'})
      if (arm === 'fha') expect(policy).to.deep.equal({mode: 'disabled'})
      else
        expect(policy.profile).to.include({
          outputReserve: 2048,
          summaryOutput: 2048,
          target: 8192,
          trigger: 12_288,
          window: 16_384,
        })
    }
  })

  it('rejects unknown arms and impossible handoff budgets', () => {
    expect(() => experimentPolicy({arm: 'other'})).to.throw('Unknown compaction experiment arm')
    expect(() => experimentPolicy({arm: 'sac', window: 8000})).to.throw('Invalid compaction experiment budgets')
  })

  it('includes summary usage and marks partial usage instead of inventing missing tokens', () => {
    const events = [
      {type: 'model.request.started'},
      {data: {usage: {inputTokens: 100, outputTokens: 20}}, type: 'model.response.completed'},
      {type: 'context.summary.started'},
      {type: 'model.request.started'},
      {data: {usage: {inputTokens: 50, outputTokens: 10}}, type: 'model.response.completed'},
      {type: 'context.compaction.completed'},
    ]
    expect(compactionMetrics(events)).to.include({
      billedCostUSD: null,
      cacheTokens: null,
      compactions: 1,
      inputTokens: 150,
      outputTokens: 30,
      peakInputTokens: 100,
      summaryAttempts: 1,
      usageComplete: true,
    })
    expect(compactionMetrics([...events, {type: 'model.request.started'}]).usageComplete).to.equal(false)
    expect(compactionMetrics([]).peakInputTokens).to.equal(null)
  })
})
