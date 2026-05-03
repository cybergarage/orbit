// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import {
  ContextOverflowError,
  InvalidConfigurationError,
  InvalidInputError,
  ModelAbortError,
  OrbitError,
  OrbitErrorCode,
  ProcessorSequence,
  ProcessorSequenceEmptyError,
} from '../../src/core/index.js'

describe('core errors', () => {
  it('identifies Orbit errors', () => {
    const error = new OrbitError('base error')

    expect(error).to.be.instanceOf(Error)
    expect(error).to.be.instanceOf(OrbitError)
    expect(error.name).to.equal('OrbitError')
    expect(error.message).to.equal('base error')
    expect(OrbitError.isInstance(error)).to.equal(true)
    expect(OrbitError.isInstance(new Error('plain error'))).to.equal(false)
    expect(OrbitError.isInstance('plain string')).to.equal(false)
  })

  it('stores error codes and causes', () => {
    const cause = new Error('source')
    const error = new InvalidInputError('bad input', {cause})

    expect(error.code).to.equal(OrbitErrorCode.InvalidInput)
    expect(error.cause).to.equal(cause)
    expect(error.message).to.equal('bad input')
  })

  it('defines common derived errors', () => {
    expect(new InvalidConfigurationError('bad config').code).to.equal(OrbitErrorCode.InvalidConfiguration)
    expect(new ProcessorSequenceEmptyError().code).to.equal(OrbitErrorCode.ProcessorSequenceEmpty)
    expect(new ModelAbortError('aborted').code).to.equal(OrbitErrorCode.ModelAborted)
    expect(new ContextOverflowError('too long').code).to.equal(OrbitErrorCode.ContextOverflow)
  })

  it('throws a processor sequence empty error for empty sequences', () => {
    expect(() => new ProcessorSequence<unknown, unknown>([])).to.throw(ProcessorSequenceEmptyError)
  })
})
