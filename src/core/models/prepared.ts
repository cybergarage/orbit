// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/** Freeze the exact JSON projection that will be counted and sent. */
export function freezeModelRequest<T extends object>(request: T, cap?: number): T {
  if (cap !== undefined && (!Number.isSafeInteger(cap) || cap <= 0)) throw new Error('Invalid model output cap')
  // Match JSON serialization, including omitted undefined fields, before freezing the wire request.
  // eslint-disable-next-line unicorn/prefer-structured-clone
  const copy = JSON.parse(JSON.stringify(request)) as T
  const freeze = (value: unknown): void => {
    if (value !== null && typeof value === 'object') {
      for (const item of Object.values(value)) freeze(item)
      Object.freeze(value)
    }
  }

  freeze(copy)
  return copy
}
