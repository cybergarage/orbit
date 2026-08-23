// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {Message} from '../../message/index.js'
import type {ToolResult} from '../../tools/index.js'
import type {ModelToolCallPayload, ModelToolResultPayload} from '../model.js'

import {toolResultText} from '../../tools/index.js'

export type JSONSchema = Record<string, unknown>

export function getToolCalls(message: Message) {
  return isModelToolCallPayload(message.payload) ? message.payload.toolCalls : []
}

export function getToolResult(message: Message): ModelToolResultPayload | undefined {
  return isModelToolResultPayload(message.payload) ? message.payload : undefined
}

export function stringifyToolOutput(output: unknown): string {
  if (isToolResult(output)) return toolResultText(output)
  return typeof output === 'string' ? output : (JSON.stringify(output) ?? String(output))
}

function isModelToolCallPayload(payload: unknown): payload is ModelToolCallPayload {
  if (typeof payload !== 'object' || payload === null || !('toolCalls' in payload)) {
    return false
  }

  return Array.isArray((payload as ModelToolCallPayload).toolCalls)
}

function isModelToolResultPayload(payload: unknown): payload is ModelToolResultPayload {
  if (typeof payload !== 'object' || payload === null) {
    return false
  }

  const result = payload as Partial<ModelToolResultPayload>
  return typeof result.toolCallId === 'string' && typeof result.name === 'string'
}

function isToolResult(value: unknown): value is ToolResult {
  return typeof value === 'object' && value !== null && 'content' in value && Array.isArray(value.content)
}
