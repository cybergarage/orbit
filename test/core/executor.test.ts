// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import type {Agent, Executor, ExecutorOptions, Message, Model, Tool, ToolOptions} from '../../src/core/models/index.js'

import {ExecutorSequence, ExecutorSequenceEmptyError, ExecutorType} from '../../src/core/models/index.js'

type Assert<T extends true> = T
type Extends<T, U> = T extends U ? true : false

describe('Executor', () => {
  it('defines executor type names', () => {
    expect(ExecutorType).to.deep.equal({
      Agent: 'agent',
      Model: 'model',
      Sequence: 'sequence',
      Tool: 'tool',
    })
  })

  it('accepts models as message executors at the type level', () => {
    type ModelIsMessageExecutor = Assert<Extends<Model, Executor<Message[], Message, ExecutorOptions>>>

    const _typeCheck: ModelIsMessageExecutor = true

    expect(_typeCheck).to.equal(true)
  })

  it('accepts agents as message executors at the type level', () => {
    type AgentIsMessageExecutor = Assert<Extends<Agent, Executor<Message[], Message, ExecutorOptions>>>

    const _typeCheck: AgentIsMessageExecutor = true

    expect(_typeCheck).to.equal(true)
  })

  it('accepts executor sequences at the type level', () => {
    type SequenceIsExecutor = Assert<Extends<ExecutorSequence<string, number>, Executor<string, number>>>

    const _typeCheck: SequenceIsExecutor = true

    expect(_typeCheck).to.equal(true)
  })

  it('accepts tools as executors at the type level', () => {
    type ToolIsExecutor = Assert<Extends<Tool<unknown, unknown>, Executor<unknown, unknown, ToolOptions>>>

    const _typeCheck: ToolIsExecutor = true

    expect(_typeCheck).to.equal(true)
  })

  it('runs executors sequentially and returns the final output', async () => {
    const calls: string[] = []
    const sequence = new ExecutorSequence<string, string>([
      createExecutor<string, number>('length', async (input) => {
        calls.push(`length:${input}`)
        return input.length
      }),
      createExecutor<number, string>('label', async (input) => {
        calls.push(`label:${input}`)
        return `count:${input}`
      }),
    ])

    expect(await sequence.invoke('orbit')).to.equal('count:5')
    expect(calls).to.deep.equal(['length:orbit', 'label:5'])
  })

  it('passes options to every executor', async () => {
    const calls: unknown[] = []
    const sequence = new ExecutorSequence<string, string>([
      createExecutor<string, string>('first', async (input, options) => {
        calls.push(options)
        return `${input}:first`
      }),
      createExecutor<string, string>('second', async (input, options) => {
        calls.push(options)
        return `${input}:second`
      }),
    ])
    const options = {traceId: 'trace-1'}

    expect(await sequence.invoke('start', options)).to.equal('start:first:second')
    expect(calls).to.deep.equal([options, options])
  })

  it('returns the sequence executor name with optional suffixes', () => {
    const sequence = new ExecutorSequence<string, string>([
      createExecutor<string, string>('identity', async (input) => input),
    ])

    expect(sequence.getName()).to.equal(ExecutorType.Sequence)
    expect(sequence.getName('Suffix')).to.equal(`${ExecutorType.Sequence}:Suffix`)
    expect(sequence.getName('')).to.equal(ExecutorType.Sequence)
  })

  it('throws when constructed without executors', () => {
    expect(() => new ExecutorSequence<unknown, unknown>([])).to.throw(
      ExecutorSequenceEmptyError,
      'ExecutorSequence requires at least one executor.',
    )
  })
})

function createExecutor<RunInput, RunOutput>(
  name: string,
  invoke: (input: RunInput, options?: Partial<ExecutorOptions>) => Promise<RunOutput>,
): Executor<RunInput, RunOutput> {
  return {
    getName(suffix?: string) {
      return suffix ? `${name}:${suffix}` : name
    },
    invoke,
  }
}
