// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/** Reject lossy JSON before binding an operation or accepting a replay key. */
export function canonicalJSON(value: unknown): string {
  const seen = new Set<object>()
  const encode = (item: unknown): string => {
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return JSON.stringify(item)
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item)
    if (typeof item !== 'object' || item === null || seen.has(item)) throw new Error('Value is not canonical JSON')
    if (
      !Array.isArray(item) &&
      Object.getPrototypeOf(item) !== Object.prototype &&
      Object.getPrototypeOf(item) !== null
    )
      throw new Error('Only plain JSON objects are supported')
    seen.add(item)
    const result = Array.isArray(item)
      ? `[${Array.from(item, encode).join(',')}]`
      : `{${Object.keys(item)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${encode((item as Record<string, unknown>)[key])}`)
          .join(',')}}`
    seen.delete(item)
    return result
  }

  return encode(value)
}
