// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import type {AppleMemoryChannel, AppleMemoryFrame} from '../../src/core/models/adapters/apple-memory-ipc.js'

import {AppleProjectMemoryAgent, createProvider, Message, MessageType} from '../../src/core/index.js'
import {getToolCalls} from '../../src/core/models/adapters/tools.js'
import {textToolResult} from '../../src/core/tools/definition.js'

const spec = {description: 'Synthetic search', inputSchema: {type: 'object'}, name: 'project_memory_search'}
const user = () => new Message(MessageType.User, {content: 'Find the saved choice.'})
const input = {limit: 2, query: 'catalog storage'}

function fixture(frames: AppleMemoryFrame[] = []) {
  let nonce = ''
  let closed = false
  const sent: AppleMemoryFrame[] = []
  let initial: AppleMemoryFrame = {}
  const queue = [{tool: spec.name, type: 'ready'}, ...frames]
  const channel: AppleMemoryChannel = {
    close() { closed = true },
    async next() { return {nonce, version: 2, ...queue.shift()} },
    send(frame) { sent.push(frame) },
  }
  const model = new AppleProjectMemoryAgent(createProvider('apple'), {channelFactory(value) {initial = value; nonce = value.nonce as string; return channel}})
  return {channel, get closed() {return closed}, get initial() {return initial}, model, queue, sent}
}

function result(call: Message, override = {}) {
  const value = getToolCalls(call)[0]
  return new Message(MessageType.Tool, {payload: {input: value.input, name: value.name, output: textToolResult('synthetic evidence'), toolCallId: value.id, ...override}})
}

async function rejected(work: Promise<unknown>, text: string) {
  try { await work; expect.fail('Expected rejection') } catch (error) {expect(String(error)).contains(text)}
}

describe('Apple fixed Project memory bridge', () => {
  it('exports the explicit adapter and describes only named support', async () => {
    const f = fixture()
    expect((await import('../../src/index.js')).AppleProjectMemoryAgent).equals(AppleProjectMemoryAgent)
    expect(await f.model.getCapabilities()).deep.equals({namedTools: [spec.name], source: 'adapter', tools: 'unsupported'})
  })

  it('round-trips actual calls and results without passing Project scope to Swift', async () => {
    const f = fixture([{id: 'one', input, name: spec.name, type: 'call'}, {text: 'answer', transcript: {calls: 1, outputs: 1}, type: 'final'}])
    const messages = [user()]
    const call = await f.model.invoke(messages, {tools: [spec]})
    expect(getToolCalls(call)).deep.equals([{id: 'one', input, name: spec.name}])
    expect(JSON.stringify(f.initial)).not.match(/projectId|sessionId|synthetic evidence/u)
    const final = await f.model.invoke([...messages, call, result(call)], {tools: [spec]})
    expect(final.content).equals('answer')
    expect(f.sent[0]).includes({id: 'one', text: 'synthetic evidence', type: 'result'})
    expect(f.closed).equals(true)
  })

  it('correlates different parallel calls arriving in reverse order and serializes Core rounds', async () => {
    const other = {limit: 1, query: 'deployment'}
    const f = fixture([{id: 'second', input: other, name: spec.name, type: 'call'}, {id: 'first', input, name: spec.name, type: 'call'}, {text: 'done', type: 'final'}])
    const messages = [user()]
    const second = await f.model.invoke(messages, {tools: [spec]})
    messages.push(second, result(second))
    const first = await f.model.invoke(messages, {tools: [spec]})
    messages.push(first, result(first))
    await f.model.invoke(messages, {tools: [spec]})
    expect(f.sent.map(({id}) => id)).deep.equals(['second', 'first'])
    expect(getToolCalls(second)[0].input).deep.equals(other)
    expect(getToolCalls(first)[0].input).deep.equals(input)
  })

  for (const [label, change] of Object.entries({
    'empty query': {input: {...input, query: ''}},
    'excessive limit': {input: {...input, limit: 17}},
    'model supplied Project': {input: {...input, projectId: 'another-project'}},
    'old text helper': {version: 1},
    'unknown tool': {name: 'bash'},
    'wrong nonce': {nonce: 'different'},
  })) it(`rejects ${label} without dispatch or value leakage`, async () => {
    const f = fixture([{id: 'one', input, name: spec.name, type: 'call', ...change}])
    await rejected(f.model.invoke([user()], {tools: [spec]}), 'Invalid Apple memory')
    expect(f.sent).length(0)
    expect(f.closed).equals(true)
  })

  for (const [label, change] of Object.entries({
    'denied read': {isError: true},
    'different input': {input: {limit: 2, query: 'other'}},
    'oversized result': {output: textToolResult('X'.repeat(65_537))},
    'wrong ID': {toolCallId: 'other'},
    'wrong name': {name: 'bash'},
  })) it(`rejects ${label} before feeding native Tool`, async () => {
    const f = fixture([{id: 'one', input, name: spec.name, type: 'call'}])
    const messages = [user()]
    const call = await f.model.invoke(messages, {tools: [spec]})
    await rejected(f.model.invoke([...messages, call, result(call, change)], {tools: [spec]}), 'Apple memory')
    expect(f.sent).length(0)
    expect(f.closed).equals(true)
  })

  it('rejects a different conversation continuation', async () => {
    const f = fixture([{id: 'one', input, name: spec.name, type: 'call'}])
    const call = await f.model.invoke([user()], {tools: [spec]})
    await rejected(f.model.invoke([new Message(MessageType.User, {content: 'other'}), call, result(call)], {tools: [spec]}), 'continuation')
  })

  it('rejects duplicate native IDs', async () => {
    const f = fixture(Array.from({length: 2}, () => ({id: 'one', input, name: spec.name, type: 'call'})))
    const messages = [user()]
    const call = await f.model.invoke(messages, {tools: [spec]})
    await rejected(f.model.invoke([...messages, call, result(call)], {tools: [spec]}), 'Invalid Apple memory tool call')
  })

  it('does not accept tool-free or arbitrary-tool registration', async () => {
    const f = fixture()
    await rejected(f.model.invoke([user()]), 'explicitly registered')
    await rejected(f.model.invoke([user()], {tools: [spec, {...spec, name: 'bash'}]}), 'explicitly registered')
  })

  it('drops delayed results after cancellation before resuming', async () => {
    const f = fixture([{id: 'one', input, name: spec.name, type: 'call'}])
    const controller = new AbortController()
    const messages = [user()]
    const call = await f.model.invoke(messages, {signal: controller.signal, tools: [spec]})
    controller.abort()
    await rejected(f.model.invoke([...messages, call, result(call)], {signal: controller.signal, tools: [spec]}), 'Abort')
    expect(f.sent).length(0)
    expect(f.closed).equals(true)
  })
})
