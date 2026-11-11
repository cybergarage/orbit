// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import {experimentPolicy} from './compaction-config.mjs'
import {createEvaluationModel} from './evaluation-model.mjs'

describe('Evaluation provider selection', () => {
  it('requires an explicit supported provider, model and dedicated cloud key', () => {
    expect(() => createEvaluationModel({model: 'fixture', provider: 'unknown'})).to.throw('Unsupported')
    expect(() => createEvaluationModel({provider: 'openai'}, {})).to.throw('explicit')
    expect(() => createEvaluationModel({model: 'fixture', provider: 'openai'}, {})).to.throw('Missing')
  })
  for (const provider of ['openai', 'anthropic']) {
    it(`selects the explicit ${provider} model and matching compaction profile`, () => {
      const modelName = 'pinned-test-model'
      const selected = createEvaluationModel(
        {model: modelName, provider},
        {[`ORBIT_TEST_${provider.toUpperCase()}_API_KEY`]: 'fake-key'},
      )
      expect(selected.model.getProvider()).to.equal(provider)
      expect(selected.model.getModel()).to.equal(modelName)
      expect(experimentPolicy({arm: 'eocc', model: modelName, provider}).profile).to.include({
        model: modelName,
        provider,
      })
      selected.close()
    })
  }

  it('preserves the implicit Ollama worker configuration', () => {
    const selected = createEvaluationModel({model: 'fixture', options: {num_ctx: 16_384}})
    expect(selected.model.getProvider()).to.equal('ollama')
    expect(selected.model.getModel()).to.equal('fixture')
    selected.close()
  })
})
