// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {createAppleMemoryChannel} from '../../src/core/models/adapters/apple-memory-ipc.js'

async function rejection(work: Promise<unknown>, expected: string) {
  try {
    await work
    expect.fail('Expected rejection')
  } catch (error) {
    expect(String(error)).contains(expected)
  }
}

;(process.platform === 'win32' ? describe.skip : describe)('Apple memory owned duplex process', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-ipc-'))
  })

  afterEach(async () => {
    await fs.rm(root, {force: true, recursive: true})
  })
  async function helper(body: string) {
    const file = path.join(root, 'helper.cjs')
    await fs.writeFile(file, `#!${process.execPath}\n${body}\n`, {mode: 0o700})
    return file
  }

  it('reads fragmented frames and feeds results over the same stdin', async () => {
    const file = await helper(
      String.raw`let text=''; process.stdin.on('data', c=>{text+=c;let i;while((i=text.indexOf('\n'))>=0){const f=JSON.parse(text.slice(0,i));text=text.slice(i+1);if(f.type==='result'){process.stdout.write(JSON.stringify({type:'final',text:f.text})+'\n')}else {process.stdout.write('{\"type\":');process.stdout.write('\"ready\"}\n')}}});`,
    )
    const channel = createAppleMemoryChannel(file, 2000)({version: 2})
    try {
      expect(await channel.next()).deep.equals({type: 'ready'})
      channel.send({id: 'two', text: 'synthetic', type: 'result'})
      expect(await channel.next()).deep.equals({text: 'synthetic', type: 'final'})
    } finally {
      channel.close()
    }
  })

  it('bounds old EOF-only helpers and hung native work', async () => {
    const file = await helper('process.stdin.resume();')
    const channel = createAppleMemoryChannel(file, 150)({version: 2})
    await rejection(channel.next(), 'timed out')
    await rejection(channel.next(), 'timed out')
  })

  it('kills owned work on cancellation and drops a delayed response', async () => {
    const file = await helper(
      String.raw`process.stdin.resume();setTimeout(()=>process.stdout.write('{\"type\":\"final\"}\n'),500);`,
    )
    const abort = new AbortController()
    const channel = createAppleMemoryChannel(file, 2000)({version: 2}, abort.signal)
    const work = channel.next()
    abort.abort()
    await rejection(work, 'cancelled')
    expect(() => channel.send({id: 'late', text: 'must not be sent', type: 'result'})).throws('cancelled')
  })

  it('does not expose malformed native output or stderr values', async () => {
    const file = await helper(
      String.raw`process.stdin.once('data',()=>{process.stderr.write('PRIVATE');process.stdout.write('PRIVATE-not-json\n')});`,
    )
    const channel = createAppleMemoryChannel(file, 2000)({version: 2})
    await rejection(channel.next(), 'Invalid Apple memory frame')
  })

  it('bounds output and hides helper failures', async () => {
    const file = await helper("process.stdin.once('data',()=>process.stdout.write('PRIVATE'.repeat(160000)));")
    const channel = createAppleMemoryChannel(file, 2000)({version: 2})
    await rejection(channel.next(), 'output exceeds limit')
  })
})
