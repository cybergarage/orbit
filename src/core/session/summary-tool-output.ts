// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {PersistedMessage} from './entries.js'

import {MessageType} from '../message/index.js'

type StreamReference = {contentIndex: number; length: number; start: number}
type OutputProjection = {
  encoding: 'orbit-tool-output-references-v1'
  streams: Record<string, StreamReference>
  value: Record<string, unknown>
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** Private summary rendering: references are UTF-16 string slices, never inferred evidence. */
export function projectSummaryToolOutput(message: PersistedMessage): PersistedMessage {
  if (message.type !== MessageType.Tool || !object(message.payload)) return message
  const {output} = message.payload
  if (!object(output) || !Array.isArray(output.content) || !object(output.details)) return message
  const details = {...output.details}
  const streams: Record<string, StreamReference> = {}
  for (const stream of ['stdout', 'stderr']) {
    const text = details[stream]
    if (typeof text !== 'string' || text.length === 0) continue
    for (const [contentIndex, block] of output.content.entries()) {
      if (!object(block) || block.type !== 'text' || typeof block.text !== 'string') continue
      const start = block.text.indexOf(text)
      if (start === -1) continue
      const reference = {contentIndex, length: text.length, start}
      // Even a single reference must save serialized bytes; keep short streams literal.
      if (Buffer.byteLength(JSON.stringify(reference)) >= Buffer.byteLength(JSON.stringify(text))) break
      streams[stream] = reference
      delete details[stream]
      break
    }
  }

  if (Object.keys(streams).length === 0) return message
  const projection: OutputProjection = {
    encoding: 'orbit-tool-output-references-v1',
    streams,
    value: {...output, details},
  }
  if (Buffer.byteLength(JSON.stringify(projection)) >= Buffer.byteLength(JSON.stringify(output))) return message
  return {...message, payload: {...message.payload, output: projection}}
}

/** Restore only a projection produced by projectSummaryToolOutput, not arbitrary tool data. */
export function restoreSummaryToolOutput(projected: PersistedMessage, original: PersistedMessage): PersistedMessage {
  if (projected === original) return original
  const payload = projected.payload as Record<string, unknown>
  const projection = payload.output as OutputProjection
  const content = projection.value.content as {text: string}[]
  const details = {...(projection.value.details as Record<string, unknown>)}
  for (const [stream, reference] of Object.entries(projection.streams)) {
    details[stream] = content[reference.contentIndex].text.slice(reference.start, reference.start + reference.length)
  }

  return {...projected, payload: {...payload, output: {...projection.value, details}}}
}
