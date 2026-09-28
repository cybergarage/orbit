// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {ToolDefinition, ToolResult} from './definition.js'

// Runtime-only adapter identities are never supplied by tool output or model input.
const adapters = new WeakMap<object, string>()
const results = new WeakMap<object, ToolObservationProvenance>()
export interface ToolObservationProvenance {
  adapter: string
  callId: string
  groupId: string
  inputDigest: string
  operationId: string
  outputDigest: string
  runId: string
  version: 1
}
export function markObservationAdapter(definition: ToolDefinition): void {
  if (['bash', 'edit', 'write'].includes(definition.spec.name))
    adapters.set(definition, `builtin-${definition.spec.name}-v1`)
}

export function copyObservationAdapter(source: ToolDefinition, target: ToolDefinition): void {
  const revision = adapters.get(source)
  if (revision) adapters.set(target, revision)
}

export function observationAdapter(definition: ToolDefinition): string | undefined {
  return adapters.get(definition)
}

export function bindObservationResult(result: ToolResult, provenance: ToolObservationProvenance): void {
  results.set(result, structuredClone(provenance))
}

export function observationProvenance(result: ToolResult): ToolObservationProvenance | undefined {
  const provenance = results.get(result)
  return provenance ? structuredClone(provenance) : undefined
}
