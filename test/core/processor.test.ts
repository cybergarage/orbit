// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import type {Processor, ProcessorOptions} from '../../src/core/index.js'

import {InvalidConfigurationError, OperatorType, ProcessorRegistry} from '../../src/core/index.js'

describe('ProcessorRegistry', () => {
  it('looks up registered processors by type and name', () => {
    const registry = new ProcessorRegistry()
    const processor = createProcessor(OperatorType.Tool, 'search')

    registry.register(processor)

    expect(registry.lookup(OperatorType.Tool, 'search')).to.equal(processor)
  })

  it('keeps processors with the same name but different types separate', () => {
    const registry = new ProcessorRegistry()
    const modelProcessor = createProcessor(OperatorType.Model, 'default')
    const toolProcessor = createProcessor(OperatorType.Tool, 'default')

    registry.register(modelProcessor)
    registry.register(toolProcessor)

    expect(registry.lookup(OperatorType.Model, 'default')).to.equal(modelProcessor)
    expect(registry.lookup(OperatorType.Tool, 'default')).to.equal(toolProcessor)
  })

  it('keeps processors with the same type but different names separate', () => {
    const registry = new ProcessorRegistry()
    const searchProcessor = createProcessor(OperatorType.Tool, 'search')
    const lookupProcessor = createProcessor(OperatorType.Tool, 'lookup')

    registry.register(searchProcessor)
    registry.register(lookupProcessor)

    expect(registry.lookup(OperatorType.Tool, 'search')).to.equal(searchProcessor)
    expect(registry.lookup(OperatorType.Tool, 'lookup')).to.equal(lookupProcessor)
  })

  it('returns undefined when no processor is registered for the type and name', () => {
    const registry = new ProcessorRegistry()

    expect(registry.lookup(OperatorType.Tool, 'missing')).to.equal(undefined)
  })

  it('throws when registering the same type and name twice', () => {
    const registry = new ProcessorRegistry()

    registry.register(createProcessor(OperatorType.Tool, 'search'))

    expect(() => registry.register(createProcessor(OperatorType.Tool, 'search'))).to.throw(
      InvalidConfigurationError,
      'Processor is already registered for type "tool" and name "search".',
    )
  })
})

function createProcessor(type: Processor['type'], name: string): Processor {
  return {
    getName(suffix?: string) {
      return suffix ? `${name}:${suffix}` : name
    },
    async invoke(input: unknown, _options?: Partial<ProcessorOptions>) {
      return input
    },
    name,
    type,
  }
}
