// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs/promises'
import path from 'node:path'

import {Message} from '../dist/index.js'
import {cloudMetrics} from './cloud-metrics.mjs'
import {consumeCredential, stageCredential} from './evaluation-credentials.mjs'
import {createEvaluationModel} from './evaluation-model.mjs'

const response = (provider, model, usage) => ({
  data: {
    model,
    provider,
    response: {usage},
    usage: {
      inputTokens: usage.prompt_tokens ?? usage.input_tokens,
      outputTokens: usage.completion_tokens ?? usage.output_tokens,
    },
  },
  type: 'model.response.completed',
})
const started = {type: 'model.request.started'}
const openai = {model: 'gpt-4o-2024-08-06', provider: 'openai'}
const anthropic = {model: 'claude-opus-4-6', provider: 'anthropic'}

describe('Cloud evaluation accounting and credential delivery', () => {
  it('charges OpenAI cached input once and attributes summary and worker calls', () => {
    const reply = response(openai.provider, openai.model, {
      completion_tokens: 100,
      prompt_tokens: 1000,
      prompt_tokens_details: {cached_tokens: 800},
    })
    const result = cloudMetrics(
      [{type: 'context.summary.started'}, started, reply, {type: 'context.summary.completed'}, started, reply],
      openai,
    )
    expect(result).to.include({
      cacheTokens: 1600,
      inputTokens: 2000,
      summaryInputTokens: 1000,
      uncachedInputTokens: 400,
      usageComplete: true,
      workerInputTokens: 1000,
    })
    expect(result.estimatedListCostUSD).closeTo(0.005, 1e-12)
    expect(result.billedCostUSD).equal(null)
  })

  it('adds Anthropic cache input and prices both write TTLs without double counting', () => {
    const result = cloudMetrics(
      [
        started,
        response(anthropic.provider, anthropic.model, {
          cache_creation: {ephemeral_1h_input_tokens: 200, ephemeral_5m_input_tokens: 100},
          cache_creation_input_tokens: 300,
          cache_read_input_tokens: 200,
          input_tokens: 100,
          output_tokens: 100,
        }),
      ],
      anthropic,
    )
    expect(result).include({
      cacheTokens: 200,
      cacheWrite1hTokens: 200,
      cacheWrite5mTokens: 100,
      inputTokens: 600,
      uncachedInputTokens: 100,
      usageComplete: true,
    })
    expect(result.estimatedListCostUSD).closeTo(0.005_725, 1e-12)
  })

  it('keeps late, missing, failed, unpriced and mismatched usage distinct', () => {
    const reply = response(openai.provider, openai.model, {
      completion_tokens: 100,
      prompt_tokens: 1000,
      prompt_tokens_details: {cached_tokens: 0},
    })
    const partial = cloudMetrics([started, reply, started], openai)
    expect(partial).include({cacheTokens: null, estimatedListCostUSD: null, usageComplete: false})
    expect(partial.observedListCostUSD).greaterThan(0)
    expect(
      cloudMetrics([started, {...reply, data: {...reply.data, model: 'different'}}], openai).estimatedListCostUSD,
    ).equal(null)
    expect(cloudMetrics([started, {type: 'model.response.failed'}], openai).usageComplete).equal(false)
    expect(cloudMetrics([], openai).estimatedListCostUSD).equal(null)
    expect(
      cloudMetrics(
        [
          started,
          response('anthropic', anthropic.model, {
            cache_creation_input_tokens: 3,
            cache_read_input_tokens: 0,
            input_tokens: 100,
            output_tokens: 10,
          }),
        ],
        anthropic,
      ).usageComplete,
    ).equal(false)
  })

  it('consumes and deletes a private staged key before a model or tool runs', async () => {
    const secret = await stageCredential('openai', {ORBIT_TEST_OPENAI_API_KEY: 'fake-evaluation-key'})
    try {
      if (process.platform !== 'win32') expect((await fs.stat(path.dirname(secret.file))).mode % 512).equal(0o700)
      expect(await consumeCredential(secret.file, 'openai')).deep.equal({
        ORBIT_TEST_OPENAI_API_KEY: 'fake-evaluation-key',
      })
      let missing = false
      try {
        await fs.stat(secret.file)
      } catch (error) {
        missing = error.code === 'ENOENT'
      }

      expect(missing).equal(true)
    } finally {
      await secret.cleanup()
    }
  })

  it('caps every cloud request including FHA and keeps keys out of prepared requests', () => {
    for (const provider of ['openai', 'anthropic']) {
      const {model} = createEvaluationModel(
        {model: 'fixture', options: {num_predict: 123}, provider},
        {[`ORBIT_TEST_${provider.toUpperCase()}_API_KEY`]: 'fake-evaluation-key'},
      )
      for (const maxOutputTokens of [undefined, 200, 12]) {
        const {request} = model.prepare([new Message('user', {content: 'test'})], {maxOutputTokens})
        expect(request.max_tokens ?? request.max_completion_tokens).equal(maxOutputTokens === 12 ? 12 : 123)
        expect(JSON.stringify(request)).not.include('fake-evaluation-key')
      }
    }
  })
})
