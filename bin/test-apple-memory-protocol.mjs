#!/usr/bin/env node
// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

// Uses the ORBIT_PROTOCOL_TEST Swift build. Never invokes a model.
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'

import {createAppleMemoryChannel} from '../dist/index.js'

const helper = process.env.ORBIT_APPLE_MEMORY_PROTOCOL_HELPER_PATH
if (!helper || process.argv.length !== 2) throw new Error('Set ORBIT_APPLE_MEMORY_PROTOCOL_HELPER_PATH; no arguments accepted')
const nonce = randomUUID()
const channel = createAppleMemoryChannel(helper, 5000)({maxCalls: 4, nonce, operation: 'generate', version: 2})
try {
  assert.equal((await channel.next()).type, 'ready')
  const a = await channel.next()
  const b = await channel.next()
  assert.notEqual(a.id, b.id)
  assert.notDeepEqual(a.input, b.input)
  for (const call of [b, a]) channel.send({id: call.id, nonce, text: call.input.query === 'synthetic-first' ? 'first-result' : 'second-result', type: 'result', version: 2})
  const final = await channel.next()
  assert.equal(final.type, 'final')
  assert.equal(final.text, 'protocol_ok')
  console.log(JSON.stringify({correlated: true, distinctCalls: 2, mockProtocol: true, nativeActor: true, reversedResults: true}))
} finally {channel.close()}
