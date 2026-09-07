// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable n/no-unsupported-features/node-builtins */
import {expect} from 'chai'
import {stub} from 'sinon'

import {Message, MessageType} from '../../../src/core/index.js'
import {AnthropicAgent} from '../../../src/core/models/adapters/anthropic.js'
import {OpenAIAgent} from '../../../src/core/models/adapters/openai.js'

// Exercise default SDK construction, not an injected client with its own retry settings.
describe('managed default provider retry policy', () => {
  for (const [name, Adapter] of [
    ['openai', OpenAIAgent],
    ['anthropic', AnthropicAgent],
  ] as const) {
    it(`makes one ${name} request when the provider returns 429`, async () => {
      let requests = 0
      const fetch = stub(globalThis, 'fetch').callsFake(async () => {
        requests++
        return new Response(JSON.stringify({error: {message: 'fixture rate limit', type: 'rate_limit_error'}}), {
          headers: {'content-type': 'application/json', 'retry-after': '0'},
          status: 429,
        })
      })
      try {
        const model = new Adapter('fixture', {
          getAPIKey: () => 'fake-fixture-key',
          getHost: () => 'https://fixture.invalid',
          getName: () => name,
        })
        await model.invoke([new Message(MessageType.User, {content: 'fixture'})]).then(
          () => {
            throw new Error('Unexpected success')
          },
          () => {},
        )
        expect(requests).equal(1)
      } finally {
        fetch.restore()
      }
    })
  }
})
