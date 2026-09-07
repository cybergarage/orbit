// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {z} from 'zod'

import type {OperationPreparation} from '../execution/authorization.js'

export type JsonSchema = Record<string, unknown>

export interface ModelToolSpec {
  description: string
  inputSchema: JsonSchema
  name: string
}

export interface ToolInputCodec<Input> {
  jsonSchema: JsonSchema
  parse(value: unknown): Input
}

export type ToolContent = {data: string; mediaType: string; type: 'image'} | {text: string; type: 'text'}

export interface ToolResult<Details = unknown> {
  content: ToolContent[]
  details?: Details
  isError?: boolean
}

export interface ToolExecutionContext extends Record<string, unknown> {
  callId: string
  cwd: string
  emitUpdate(update: ToolResult): void
  signal: AbortSignal
}

export type ToolScheduling = 'parallel' | 'serial'

export type ToolSource = {id: string; kind: 'custom'} | {kind: 'builtin'} | {kind: 'mcp'; server: string; tool?: string}

export interface ToolDefinition<Input = unknown, Details = unknown> {
  execute(input: Input, context: ToolExecutionContext): Promise<ToolResult<Details>>
  input: ToolInputCodec<Input>
  prepare?(input: Input, context: ToolExecutionContext): Promise<OperationPreparation>
  scheduling: ToolScheduling
  source: ToolSource
  spec: ModelToolSpec
}

export function zodToolInput<Input>(schema: z.ZodType<Input>): ToolInputCodec<Input> {
  return {
    jsonSchema: zodJsonSchema(schema),
    parse(value) {
      return schema.parse(value)
    },
  }
}

export function rawToolInput(schema: JsonSchema): ToolInputCodec<Record<string, unknown>> {
  return {
    jsonSchema: schema,
    parse(value) {
      return isRecord(value) ? value : {}
    },
  }
}

export function textToolResult(text: string, options: {details?: unknown; isError?: boolean} = {}): ToolResult {
  return {
    content: [{text, type: 'text'}],
    ...(options.details === undefined ? {} : {details: options.details}),
    ...(options.isError === undefined ? {} : {isError: options.isError}),
  }
}

export function normalizeToolResult(output: unknown): ToolResult {
  if (isToolResult(output)) return output

  if (isRecord(output) && Array.isArray(output.content)) {
    const content = output.content.flatMap((item) => normalizeContent(item))
    if (content.length > 0) {
      return {
        content,
        ...('isError' in output && typeof output.isError === 'boolean' ? {isError: output.isError} : {}),
        ...('details' in output ? {details: output.details} : {}),
      }
    }
  }

  return textToolResult(stringifyUnknown(output))
}

export function toolResultText(result: ToolResult): string {
  return result.content
    .map((content) => (content.type === 'text' ? content.text : `[image: ${content.mediaType}]`))
    .join('\n')
}

function isToolResult(value: unknown): value is ToolResult {
  if (!isRecord(value) || !Array.isArray(value.content)) return false
  return value.content.every(
    (content) =>
      isRecord(content) &&
      ((content.type === 'text' && typeof content.text === 'string') ||
        (content.type === 'image' && typeof content.data === 'string' && typeof content.mediaType === 'string')),
  )
}

function normalizeContent(value: unknown): ToolContent[] {
  if (!isRecord(value)) return []
  if (value.type === 'text' && typeof value.text === 'string') return [{text: value.text, type: 'text'}]
  if (value.type !== 'image' || typeof value.data !== 'string') return []
  const mediaType =
    typeof value.mediaType === 'string'
      ? value.mediaType
      : typeof value.mimeType === 'string'
        ? value.mimeType
        : 'application/octet-stream'
  return [{data: value.data, mediaType, type: 'image'}]
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value) ?? String(value)
}

function zodJsonSchema<Input>(schema: z.ZodType<Input>): JsonSchema {
  return z.toJSONSchema(schema, {io: 'input'}) as JsonSchema
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
