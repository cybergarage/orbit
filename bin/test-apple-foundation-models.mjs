#!/usr/bin/env node
// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

// Opt-in only: uses synthetic text and never enables or downloads a model.
import assert from 'node:assert/strict'

import {AppleFoundationModelsAgent, createProvider, Message, MessageType, ModelAbortError} from '../dist/index.js'

if (process.argv.length !== 2) throw new Error('This smoke test does not accept arguments')
const model = new AppleFoundationModelsAgent('system', createProvider('apple'), {timeoutMs: 30_000})
const availability = await model.probeAvailability()
console.log('Availability:', JSON.stringify(availability))
if (!availability.available) throw new Error(`Apple model unavailable: ${availability.reason}`)

const messages = [
  new Message(MessageType.Session, {content: 'Respond briefly in English.'}),
  new Message(MessageType.User, {
    content: 'Remember that my favorite color is cobalt. Acknowledge this in one short sentence.',
  }),
]
const first = await model.invoke(messages, {maxOutputTokens: 64})
assert.ok(first.content.trim().length > 0)
console.log('First response:', first.content)
messages.push(
  first,
  new Message(MessageType.User, {content: 'What is my favorite color? Reply with only the color name.'}),
)
const second = await model.invoke(messages, {maxOutputTokens: 32})
assert.match(second.content, /cobalt/iu)
console.log('Transcript replay:', second.content)

const controller = new AbortController()
const cancelled = model.invoke([new Message(MessageType.User, {content: 'Write a long story about a lighthouse.'})], {
  maxOutputTokens: 512,
  signal: controller.signal,
})
const timer = setTimeout(() => controller.abort(), 50)
try {
  await assert.rejects(cancelled, (error) => error instanceof ModelAbortError)
} finally {
  clearTimeout(timer)
}

console.log('Owned native process cancellation: passed')
console.log('Apple native text smoke test passed; tools are unsupported')
