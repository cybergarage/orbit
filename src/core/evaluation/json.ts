// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {createHash} from 'node:crypto'

import {canonicalJSON} from '../execution/journal.js'

/** Immutable reader ceilings for evaluation revision 1, independent of producer policy. */
export const EVALUATION_FORMAT_LIMITS = Object.freeze({
  bytes: 16 * 1024 * 1024,
  checks: 64,
  depth: 32,
  metadataBytes: 2048,
  metrics: 64,
  slots: 1000,
  values: 200_000,
})

export interface ParseBudget {
  values: number
}

export function textBundle(texts: unknown[]): string[] {
  let bytes = 0
  for (const text of texts) {
    if (typeof text !== 'string') throw new Error('Evaluation input must be JSON text')
    if (text.length > EVALUATION_FORMAT_LIMITS.bytes) throw new Error('Evaluation bundle exceeds byte limit')
    bytes += Buffer.byteLength(text, 'utf8')
    if (bytes > EVALUATION_FORMAT_LIMITS.bytes) throw new Error('Evaluation bundle exceeds byte limit')
  }

  return texts as string[]
}

/** Parse incrementally; JSON.parse alone loses duplicate keys and allocates before depth checks. */
export function parseJSON(text: string, suppliedBudget?: ParseBudget, raw = false): unknown {
  const budget = suppliedBudget ?? {values: 0}
  let at = 0
  const fail = (): never => {
    throw new Error(`Invalid evaluation JSON at offset ${at}`)
  }

  const space = () => {
    while (/[\t\n\r ]/.test(text[at] ?? '\0')) at++
  }

  const string = (limit: number): string => {
    const start = at++
    let escaped = false
    while (at < text.length) {
      const c = text[at++]
      if (!escaped && c === '"') {
        const value = JSON.parse(text.slice(start, at)) as string
        if (
          Buffer.byteLength(value, 'utf8') > limit ||
          /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
        )
          fail()
        return value
      }

      escaped = Boolean(!escaped && c === '\\')
      // Each decoded UTF-16 unit occupies at most six JSON source characters.
      if (at - start > limit * 6 + 2) fail()
    }

    return fail()
  }

  const value = (depth: number, rawString = false): unknown => {
    if (depth > EVALUATION_FORMAT_LIMITS.depth || ++budget.values > EVALUATION_FORMAT_LIMITS.values) fail()
    space()
    const c = text[at]
    if (c === '"')
      return string(raw || rawString ? EVALUATION_FORMAT_LIMITS.bytes : EVALUATION_FORMAT_LIMITS.metadataBytes)
    if (c === '{') {
      at++
      const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>
      space()
      if (text[at] === '}') {
        at++
        return result
      }

      for (;;) {
        space()
        if (text[at] !== '"') fail()
        const key = string(EVALUATION_FORMAT_LIMITS.metadataBytes)
        if (Object.hasOwn(result, key)) fail()
        space()
        if (text[at++] !== ':') fail()
        result[key] = value(depth + 1, key === 'raw')
        space()
        if (text[at] === '}') {
          at++
          return result
        }

        if (text[at++] !== ',') fail()
      }
    }

    if (c === '[') {
      at++
      const result: unknown[] = []
      space()
      if (text[at] === ']') {
        at++
        return result
      }

      for (;;) {
        result.push(value(depth + 1))
        space()
        if (text[at] === ']') {
          at++
          return result
        }

        if (text[at++] !== ',') fail()
      }
    }

    for (const [token, literal] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ] as const) {
      if (text.startsWith(token, at)) {
        at += token.length
        return literal
      }
    }

    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(at))?.[0]
    if (!number) return fail()
    at += number.length
    const n = Number(number)
    if (!Number.isFinite(n) || Math.abs(n) > Number.MAX_SAFE_INTEGER) fail()
    const [mantissa, exponent = '0'] = number.replace(/^-/, '').split(/[eE]/)
    const [whole, fraction = ''] = mantissa.split('.')
    const digits = whole + fraction
    const point = whole.length + Number(exponent)
    if (Number.isInteger(n) && /[1-9]/.test(digits.slice(Math.max(0, point)))) fail()
    return Object.is(n, -0) ? 0 : n
  }

  const result = value(0)
  space()
  if (at !== text.length) fail()
  return result
}

export function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJSON(value)).digest('hex')
}

/** Hash newly parsed JSON, never inspect properties of caller-owned objects. */
export function evaluationDigest(jsonText: string): string {
  textBundle([jsonText])
  return digest(parseJSON(jsonText))
}
