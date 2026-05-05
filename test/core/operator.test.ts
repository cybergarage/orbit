// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import type {Agent, Message, Model, Operator, OperatorOptions, Tool, ToolOptions} from '../../src/core/models/index.js'

import {OperatorSequence, OperatorSequenceEmptyError, OperatorType} from '../../src/core/models/index.js'

type Assert<T extends true> = T
type Extends<T, U> = T extends U ? true : false

describe('Operator', () => {
  it('defines operator type names', () => {
    expect(OperatorType).to.deep.equal({
      Agent: 'agent',
      Model: 'model',
      Sequence: 'sequence',
      Tool: 'tool',
    })
  })

  it('accepts models as message operators at the type level', () => {
    type ModelIsMessageOperator = Assert<Extends<Model, Operator<Message[], Message, OperatorOptions>>>

    const _typeCheck: ModelIsMessageOperator = true

    expect(_typeCheck).to.equal(true)
  })

  it('accepts agents as message operators at the type level', () => {
    type AgentIsMessageOperator = Assert<Extends<Agent, Operator<Message[], Message, OperatorOptions>>>

    const _typeCheck: AgentIsMessageOperator = true

    expect(_typeCheck).to.equal(true)
  })

  it('accepts operator sequences at the type level', () => {
    type SequenceIsOperator = Assert<Extends<OperatorSequence<string, number>, Operator<string, number>>>

    const _typeCheck: SequenceIsOperator = true

    expect(_typeCheck).to.equal(true)
  })

  it('accepts tools as operators at the type level', () => {
    type ToolIsOperator = Assert<Extends<Tool<unknown, unknown>, Operator<unknown, unknown, ToolOptions>>>

    const _typeCheck: ToolIsOperator = true

    expect(_typeCheck).to.equal(true)
  })

  it('runs operators sequentially and returns the final output', async () => {
    const calls: string[] = []
    const sequence = new OperatorSequence<string, string>([
      createOperator<string, number>('length', async (input) => {
        calls.push(`length:${input}`)
        return input.length
      }),
      createOperator<number, string>('label', async (input) => {
        calls.push(`label:${input}`)
        return `count:${input}`
      }),
    ])

    expect(await sequence.invoke('orbit')).to.equal('count:5')
    expect(calls).to.deep.equal(['length:orbit', 'label:5'])
  })

  it('passes options to every operator', async () => {
    const calls: unknown[] = []
    const sequence = new OperatorSequence<string, string>([
      createOperator<string, string>('first', async (input, options) => {
        calls.push(options)
        return `${input}:first`
      }),
      createOperator<string, string>('second', async (input, options) => {
        calls.push(options)
        return `${input}:second`
      }),
    ])
    const options = {traceId: 'trace-1'}

    expect(await sequence.invoke('start', options)).to.equal('start:first:second')
    expect(calls).to.deep.equal([options, options])
  })

  it('returns the sequence operator name with optional suffixes', () => {
    const sequence = new OperatorSequence<string, string>([
      createOperator<string, string>('identity', async (input) => input),
    ])

    expect(sequence.getName()).to.equal(OperatorType.Sequence)
    expect(sequence.getName('Suffix')).to.equal(`${OperatorType.Sequence}:Suffix`)
    expect(sequence.getName('')).to.equal(OperatorType.Sequence)
  })

  it('throws when constructed without operators', () => {
    expect(() => new OperatorSequence<unknown, unknown>([])).to.throw(
      OperatorSequenceEmptyError,
      'OperatorSequence requires at least one operator.',
    )
  })
})

function createOperator<RunInput, RunOutput>(
  name: string,
  invoke: (input: RunInput, options?: Partial<OperatorOptions>) => Promise<RunOutput>,
): Operator<RunInput, RunOutput> {
  return {
    getName(suffix?: string) {
      return suffix ? `${name}:${suffix}` : name
    },
    invoke,
  }
}
