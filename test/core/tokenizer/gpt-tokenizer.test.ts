// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import type {Tokenizer} from '../../../src/core/index.js'

import {GptTokenizer} from '../../../src/core/index.js'

describe('GptTokenizer', () => {
  it('implements the Tokenizer contract', () => {
    const tokenizer: Tokenizer = new GptTokenizer()

    expect(tokenizer).to.be.instanceOf(GptTokenizer)
  })

  it('encodes text into numeric tokens', () => {
    const tokenizer = new GptTokenizer()

    const tokens = tokenizer.encode('hello')

    expect(tokens).to.be.an('array').that.is.not.empty
    expect(tokens.every((token) => typeof token === 'number')).to.equal(true)
  })

  it('round-trips English text', () => {
    const tokenizer = new GptTokenizer()
    const text = 'hello tokenizer'

    expect(tokenizer.decode(tokenizer.encode(text))).to.equal(text)
  })

  it('round-trips Japanese text', () => {
    const tokenizer = new GptTokenizer()
    const text = 'こんにちは、世界'

    expect(tokenizer.decode(tokenizer.encode(text))).to.equal(text)
  })

  it('round-trips an empty string', () => {
    const tokenizer = new GptTokenizer()

    expect(tokenizer.decode(tokenizer.encode(''))).to.equal('')
  })
})
