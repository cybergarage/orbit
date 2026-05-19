// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {z} from 'zod'

import type {AgentTool} from '../../agent.js'
import type {Message} from '../../message/index.js'
import type {ModelToolCallPayload, ModelToolResultPayload} from '../model.js'

export type JSONSchema = Record<string, unknown>

export function getToolCalls(message: Message) {
  return isModelToolCallPayload(message.payload) ? message.payload.toolCalls : []
}

export function getToolResult(message: Message): ModelToolResultPayload | undefined {
  return isModelToolResultPayload(message.payload) ? message.payload : undefined
}

export function stringifyToolOutput(output: unknown): string {
  return typeof output === 'string' ? output : (JSON.stringify(output) ?? String(output))
}

export function toolInputSchema(tool: AgentTool): JSONSchema {
  return z.toJSONSchema(tool.schema, {io: 'input'}) as JSONSchema
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
