// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {Message} from '../../message/index.js'
import type {ToolResult} from '../../tools/index.js'
import type {ModelAssistantPayload, ModelOutputPart, ModelToolCallPayload, ModelToolResultPayload} from '../model.js'

import {toolResultText} from '../../tools/index.js'

export type JSONSchema = Record<string, unknown>

export function getToolCalls(message: Message) {
  return isModelToolCallPayload(message.payload) ? message.payload.toolCalls : []
}

export function getToolResult(message: Message): ModelToolResultPayload | undefined {
  return isModelToolResultPayload(message.payload) ? message.payload : undefined
}

export function getModelOutputParts(message: Message): ModelOutputPart[] {
  return isModelAssistantPayload(message.payload) && Array.isArray(message.payload.parts) ? message.payload.parts : []
}

export function stringifyToolOutput(output: unknown): string {
  if (isToolResult(output)) return toolResultText(output)
  return typeof output === 'string' ? output : (JSON.stringify(output) ?? String(output))
}

export function getToolResultImages(output: unknown): string[] {
  if (!isToolResult(output)) return []
  return output.content.filter((content) => content.type === 'image').map((content) => content.data)
}

export function stringifyToolResult(result: ModelToolResultPayload): string {
  const text = stringifyToolOutput(result.output)
  const isError = result.isError === true || (isToolResult(result.output) && result.output.isError === true)
  if (!isError) return text
  return text.length === 0 ? 'Tool error: execution failed.' : `Tool error: ${text}`
}

function isModelToolCallPayload(payload: unknown): payload is ModelToolCallPayload {
  if (typeof payload !== 'object' || payload === null || !('toolCalls' in payload)) {
    return false
  }

  return Array.isArray((payload as ModelToolCallPayload).toolCalls)
}

function isModelAssistantPayload(payload: unknown): payload is ModelAssistantPayload {
  return typeof payload === 'object' && payload !== null && 'response' in payload
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
