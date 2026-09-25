// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {Model} from './model.js'

export interface ModelContextInfo {
  contextWindow: null | number
  maxInputTokens: null | number
  maxOutputTokens: null | number
  /** A local runtime must have a known window before its model maximum is usable. */
  requiresRuntimeContext?: boolean
  runtimeContextWindow: null | number
  source: 'api' | 'catalog' | 'unknown'
}

export interface ModelContextOptions {
  /** Explicit invocation setting, serialized as num_ctx by Ollama. */
  contextWindow?: number
  outputReserve?: number
  safetyMargin?: number
  signal?: AbortSignal
  /** An accounting ceiling; cannot enlarge a known runtime window. */
  windowLimit?: number
}

export interface ModelContextCapacity extends ModelContextInfo {
  effectiveContextWindow: null | number
  inputBudget: null | number
  model: string
  outputReserve: number
  provider: string
  safetyMargin: number
}

export function positiveTokenLimit(value: unknown): null | number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

export function unknownModelContextInfo(): ModelContextInfo {
  return {
    contextWindow: null,
    maxInputTokens: null,
    maxOutputTokens: null,
    runtimeContextWindow: null,
    source: 'unknown',
  }
}

function minimum(...values: Array<null | number | undefined>): null | number {
  const known = values.filter((value): value is number => value !== null && value !== undefined)
  return known.length > 0 ? Math.min(...known) : null
}

function validateCapacityOptions(options: ModelContextOptions): {outputReserve: number; safetyMargin: number} {
  for (const key of ['contextWindow', 'windowLimit'] as const)
    if (options[key] !== undefined && positiveTokenLimit(options[key]) === null)
      throw new Error(`Invalid ${key}: expected a positive safe integer`)
  const outputReserve = options.outputReserve ?? 0
  const safetyMargin = options.safetyMargin ?? 0
  for (const value of [outputReserve, safetyMargin])
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid context reserve')
  return {outputReserve, safetyMargin}
}

/** Resolve capacity without loading a model or enabling automatic compaction. */
export async function resolveModelContextCapacity(
  model: Model,
  options: ModelContextOptions = {},
): Promise<ModelContextCapacity> {
  const {outputReserve, safetyMargin} = validateCapacityOptions(options)
  options.signal?.throwIfAborted()
  const info = (await model.getContextInfo?.({signal: options.signal})) ?? unknownModelContextInfo()
  options.signal?.throwIfAborted()
  const normalized = {
    ...info,
    contextWindow: positiveTokenLimit(info.contextWindow),
    maxInputTokens: positiveTokenLimit(info.maxInputTokens),
    maxOutputTokens: positiveTokenLimit(info.maxOutputTokens),
    runtimeContextWindow: positiveTokenLimit(info.runtimeContextWindow),
  }
  if (normalized.maxOutputTokens !== null && outputReserve > normalized.maxOutputTokens)
    throw new Error('Context output reserve exceeds the model output limit')
  const runtime = options.contextWindow ?? normalized.runtimeContextWindow
  // A manual profile supplies the runtime only when no active/configured window is known.
  const available = runtime ?? options.windowLimit ?? (info.requiresRuntimeContext ? null : normalized.contextWindow)
  const effectiveContextWindow =
    available === null ? null : minimum(available, normalized.contextWindow, options.windowLimit)
  const inputLimit = minimum(
    effectiveContextWindow === null ? null : Math.max(0, effectiveContextWindow - outputReserve),
    normalized.maxInputTokens,
  )
  return {
    ...normalized,
    effectiveContextWindow,
    inputBudget: inputLimit === null ? null : Math.max(0, inputLimit - safetyMargin),
    model: model.getModel(),
    outputReserve,
    provider: model.getProvider(),
    safetyMargin,
  }
}

/** Bound optional discovery independently of an unlimited generation budget. */
export async function readModelMetadata(read: () => Promise<unknown>, signal?: AbortSignal): Promise<unknown> {
  signal?.throwIfAborted()
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  try {
    return await Promise.race([
      Promise.resolve()
        .then(read)
        .catch(() => {}),
      new Promise<void>((resolve) => {
        timer = setTimeout(() => resolve(), 5000)
      }),
      new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(signal?.reason ?? new Error('Model metadata discovery aborted'))
        signal?.addEventListener('abort', onAbort, {once: true})
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    if (onAbort !== undefined) signal?.removeEventListener('abort', onAbort)
    signal?.throwIfAborted()
  }
}

export function metadataRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
