// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {z} from 'zod'

import {ProcessorType, tool, Tool} from '../../src/core/index.js'

describe('tools', () => {
  it('builds a Tool instance with metadata', () => {
    const schema = z.object({value: z.string()})
    const sampleTool = tool(({value}) => value, {
      description: 'Return the value.',
      name: 'return_value',
      schema,
    })

    expect(sampleTool).to.be.instanceOf(Tool)
    expect(sampleTool.name).to.equal('return_value')
    expect(sampleTool.description).to.equal('Return the value.')
    expect(sampleTool.schema).to.equal(schema)
  })

  it('validates input and returns handler output', async () => {
    const addOne = tool(({value}: {value: number}) => value + 1, {
      description: 'Add one.',
      name: 'add_one',
      schema: z.object({value: z.number()}),
    })

    expect(await addOne.invoke({value: 41})).to.equal(42)
  })

  it('passes context through the invoke options', async () => {
    const getUserName = tool(
      (_, config) => config.context?.user_name,
      {
        description: "Get the user's name.",
        name: 'get_user_name',
        schema: z.object({}),
      },
    )

    // Match the LangChain-style example field name.
    // eslint-disable-next-line camelcase
    expect(await getUserName.invoke({}, {context: {user_name: 'Orbit'}})).to.equal('Orbit')
  })

  it('throws zod errors for invalid input', async () => {
    const addOne = tool(({value}: {value: number}) => value + 1, {
      description: 'Add one.',
      name: 'add_one',
      schema: z.object({value: z.number()}),
    })

    try {
      await addOne.invoke({value: 'nope'} as never)
      throw new Error('Expected tool invocation to fail.')
    } catch (error) {
      expect(error).to.be.instanceOf(z.ZodError)
    }
  })

  it('returns the tool processor name with optional suffixes', () => {
    const sampleTool = tool((input: string) => input, {
      description: 'Identity.',
      name: 'identity',
      schema: z.string(),
    })

    expect(sampleTool.getName()).to.equal(ProcessorType.Tool)
    expect(sampleTool.getName('Suffix')).to.equal(`${ProcessorType.Tool}:Suffix`)
    expect(sampleTool.getName('')).to.equal(ProcessorType.Tool)
  })
})
