// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {ModelCapabilitySupport} from '../capabilities.js'

import {metadataRecord} from '../context-capacity.js'

const knownOllamaCapabilities = new Set(['audio', 'completion', 'embedding', 'insert', 'thinking', 'tools', 'vision'])

/** Missing or unrecognized schemas are unknown, not a negative tools observation. */
export function ollamaToolCapability(value: unknown): ModelCapabilitySupport {
  const {capabilities} = metadataRecord(value)
  if (!Array.isArray(capabilities) || !capabilities.every((item) => typeof item === 'string')) return 'unknown'
  if (capabilities.includes('tools')) return 'supported'
  return capabilities.every((item) => knownOllamaCapabilities.has(item)) ? 'unsupported' : 'unknown'
}

/** Existing native Claude catalog rule; lifecycle is not itself a negative capability. */
export function supportsAnthropicClientTools(value: unknown): boolean {
  const record = metadataRecord(value)
  return record.type === 'model' && record.lifecycle === 'active'
}

/** Resolve the declared SDK route; do not bless compatibility URLs or unidentified injection. */
export function nativeCapabilityRoute(options: {
  client?: {baseURL?: string}
  environment?: string
  host?: string
  injected: boolean
  nativeURL: string
}): boolean {
  if (options.host !== undefined && !sameEndpoint(options.host, options.nativeURL)) return false
  const endpoint = options.client?.baseURL ?? (options.injected ? undefined : options.environment || options.nativeURL)
  return endpoint !== undefined && sameEndpoint(endpoint, options.nativeURL)
}

function sameEndpoint(value: string, native: string): boolean {
  try {
    const url = new URL(value)
    if (url.username || url.password || url.search || url.hash) return false
    return url.href.replace(/\/$/u, '') === native
  } catch {
    return false
  }
}
