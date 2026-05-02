// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import type {Agent, Message, Model, Processor, ProcessorOptions} from '../../src/core/models/index.js'

import {ProcessorSequence, ProcessorType} from '../../src/core/models/index.js'

type Assert<T extends true> = T
type Extends<T, U> = T extends U ? true : false

describe('Processor', () => {
  it('defines processor type names', () => {
    expect(ProcessorType).to.deep.equal({
      Agent: 'agent',
      Model: 'model',
      Sequence: 'sequence',
    })
  })

  it('accepts models as message processors at the type level', () => {
    type ModelIsMessageProcessor = Assert<Extends<Model, Processor<Message[], Message, ProcessorOptions>>>

    const _typeCheck: ModelIsMessageProcessor = true

    expect(_typeCheck).to.equal(true)
  })

  it('accepts agents as message processors at the type level', () => {
    type AgentIsMessageProcessor = Assert<Extends<Agent, Processor<Message[], Message, ProcessorOptions>>>

    const _typeCheck: AgentIsMessageProcessor = true

    expect(_typeCheck).to.equal(true)
  })

  it('accepts processor sequences at the type level', () => {
    type SequenceIsProcessor = Assert<Extends<ProcessorSequence<string, number>, Processor<string, number>>>

    const _typeCheck: SequenceIsProcessor = true

    expect(_typeCheck).to.equal(true)
  })

  it('runs processors sequentially and returns the final output', async () => {
    const calls: string[] = []
    const sequence = new ProcessorSequence<string, string>([
      createProcessor<string, number>('length', async (input) => {
        calls.push(`length:${input}`)
        return input.length
      }),
      createProcessor<number, string>('label', async (input) => {
        calls.push(`label:${input}`)
        return `count:${input}`
      }),
    ])

    expect(await sequence.invoke('orbit')).to.equal('count:5')
    expect(calls).to.deep.equal(['length:orbit', 'label:5'])
  })

  it('passes options to every processor', async () => {
    const calls: unknown[] = []
    const sequence = new ProcessorSequence<string, string>([
      createProcessor<string, string>('first', async (input, options) => {
        calls.push(options)
        return `${input}:first`
      }),
      createProcessor<string, string>('second', async (input, options) => {
        calls.push(options)
        return `${input}:second`
      }),
    ])
    const options = {traceId: 'trace-1'}

    expect(await sequence.invoke('start', options)).to.equal('start:first:second')
    expect(calls).to.deep.equal([options, options])
  })

  it('returns the sequence processor name with optional suffixes', () => {
    const sequence = new ProcessorSequence<string, string>([
      createProcessor<string, string>('identity', async (input) => input),
    ])

    expect(sequence.getName()).to.equal(ProcessorType.Sequence)
    expect(sequence.getName('Suffix')).to.equal(`${ProcessorType.Sequence}:Suffix`)
    expect(sequence.getName('')).to.equal(ProcessorType.Sequence)
  })

  it('throws when constructed without processors', () => {
    expect(() => new ProcessorSequence<unknown, unknown>([])).to.throw(
      'ProcessorSequence requires at least one processor.',
    )
  })
})

function createProcessor<RunInput, RunOutput>(
  name: string,
  invoke: (input: RunInput, options?: Partial<ProcessorOptions>) => Promise<RunOutput>,
): Processor<RunInput, RunOutput> {
  return {
    getName(suffix?: string) {
      return suffix ? `${name}:${suffix}` : name
    },
    invoke,
  }
}
