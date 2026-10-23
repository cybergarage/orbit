// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable camelcase -- Ollama wire fields use snake_case. */
import {expect} from 'chai'
import {getGlobalDispatcher, MockAgent, setGlobalDispatcher} from 'undici'

import {createOllamaKnowledgeExtractor} from '../../../src/core/models/adapters/ollama-knowledge.js'

describe('Bounded local knowledge transport', () => {
  const prior = getGlobalDispatcher()
  let mock: MockAgent

  beforeEach(() => {mock = new MockAgent(); mock.disableNetConnect(); setGlobalDispatcher(mock)})

  afterEach(async () => {setGlobalDispatcher(prior); await mock.close()})

  it('uses only a local tool-free bounded request and preserves reported usage', async () => {
    let request: Record<string, unknown> | undefined
    mock.get('http://127.0.0.1:11434').intercept({body(value) {request = JSON.parse(String(value)); return true}, method: 'POST', path: '/api/chat'})
      .reply(200, JSON.stringify({eval_count: 3, message: {content: '{"candidates":[]}'}, prompt_eval_count: 12}))
    const response = await createOllamaKnowledgeExtractor()('Synthetic input', new AbortController().signal)
    expect(response).deep.equals({inputTokens: 12, outputTokens: 3, text: '{"candidates":[]}'})
    expect(request).not.have.property('tools')
    expect(request?.options).deep.equals({num_ctx: 4096, num_predict: 1024, temperature: 0})
    expect(request?.model).equals('gemma4:12b')
  })

  it('rejects output exceeding the streaming byte limit', async () => {
    mock.get('http://127.0.0.1:11434').intercept({method: 'POST', path: '/api/chat'}).reply(200, 'x'.repeat(65_537))
    try {await createOllamaKnowledgeExtractor()('Synthetic', new AbortController().signal); throw new Error('Expected limit rejection')}
    catch (error) {expect(String(error)).contains('byte limit')}
  })

  it('keeps unknown usage unknown rather than inventing a measured count', async () => {
    mock.get('http://127.0.0.1:11434').intercept({method: 'POST', path: '/api/chat'}).reply(200, JSON.stringify({message: {content: '{"candidates":[]}'}}))
    const response = await createOllamaKnowledgeExtractor()('Synthetic', new AbortController().signal)
    expect(typeof response.inputTokens).equals('undefined')
    expect(typeof response.outputTokens).equals('undefined')
  })
})
