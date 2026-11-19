// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {Model} from './model.js'

import {metadataRecord, readModelMetadata} from './context-capacity.js'

export type ModelCapabilitySupport = 'supported' | 'unknown' | 'unsupported'
export interface ModelCapabilityOptions {
  signal?: AbortSignal
}
export interface ModelCapabilities {
  source: 'adapter' | 'api' | 'catalog' | 'unknown'
  tools: ModelCapabilitySupport
}
export interface ResolvedModelCapabilities extends ModelCapabilities {
  model: string
  provider: string
}

export function unknownModelCapabilities(): ModelCapabilities {
  return {source: 'unknown', tools: 'unknown'}
}

/** Supplying tool information is permitted for unknown; execution permissions are separate. */
export function canIncludeModelTools(capabilities: Pick<ModelCapabilities, 'tools'>): boolean {
  return capabilities.tools !== 'unsupported'
}

/** One bounded metadata attempt, including for older or non-cooperative custom adapters. */
export async function resolveModelCapabilities(
  model: Model,
  options: ModelCapabilityOptions = {},
): Promise<ResolvedModelCapabilities> {
  options.signal?.throwIfAborted()
  const identity = {model: model.getModel(), provider: model.getProvider()}
  const value = model.getCapabilities
    ? await readCapabilityMetadata((signal) => model.getCapabilities!({signal}), options.signal)
    : undefined
  options.signal?.throwIfAborted()
  const current = {model: model.getModel(), provider: model.getProvider()}
  if (current.model !== identity.model || current.provider !== identity.provider)
    return {...current, ...unknownModelCapabilities()}
  const info = metadataRecord(value)
  const tools = info.tools === 'supported' || info.tools === 'unsupported' ? info.tools : 'unknown'
  const source =
    info.source === 'adapter' || info.source === 'api' || info.source === 'catalog' ? info.source : 'unknown'
  return {...identity, source, tools}
}

/** Optional metadata has its own deadline and never cancels a shared generation client. */
export async function readCapabilityMetadata(
  read: (signal: AbortSignal) => Promise<unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  signal?.throwIfAborted()
  const controller = new AbortController()
  const onAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, {once: true})
  const timer = setTimeout(() => controller.abort(new Error('Capability discovery deadline exceeded')), 5000)
  try {
    return await readModelMetadata(() => {
      controller.signal.throwIfAborted()
      return read(controller.signal)
    }, controller.signal)
  } catch {
    signal?.throwIfAborted()
    return undefined
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}
