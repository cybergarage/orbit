// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'

export const studyHost = 'http://127.0.0.1:11434'
export const localRequestTimeoutMs = 120_000

/** Ollama's abort() does not cancel non-streaming HTTP requests. Bound the actual fetch. */
// eslint-disable-next-line n/no-unsupported-features/node-builtins -- Node 20.19 includes the fetch runtime used by Ollama.
export function studyFetch(input, options = {}, forward = globalThis.fetch) {
  const url = new URL(input)
  assert(
    url.origin === studyHost &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      ['/api/chat', '/api/tags'].includes(url.pathname),
    'Only loopback Ollama study requests are allowed',
  )
  const timeout = AbortSignal.timeout(localRequestTimeoutMs)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  return forward(url, {...options, redirect: 'error', signal})
}
