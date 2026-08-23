// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {z} from 'zod'

import type {Operator} from '../processor/index.js'
import type {JsonSchema, ToolDefinition, ToolExecutionContext, ToolScheduling, ToolSource} from './definition.js'
import type {ToolOptions} from './tool.js'

import {normalizeToolResult, rawToolInput, zodToolInput} from './definition.js'

export interface InvokableTool extends Operator<never, unknown, ToolOptions> {
  readonly description: string
  readonly inputSchema?: JsonSchema
  readonly name: string
  readonly scheduling?: ToolScheduling
  readonly schema: z.ZodType<unknown>
  readonly source?: ToolSource
}

export function adaptInvokableTool(tool: InvokableTool, source: ToolSource): ToolDefinition {
  const input = tool.inputSchema === undefined ? zodToolInput(tool.schema) : rawToolInput(tool.inputSchema)
  return {
    async execute(value, context: ToolExecutionContext) {
      const output = await tool.invoke(value as never, {context, signal: context.signal})
      return normalizeToolResult(output)
    },
    input,
    scheduling: tool.scheduling ?? 'serial',
    source,
    spec: {
      description: tool.description,
      inputSchema: input.jsonSchema,
      name: tool.name,
    },
  }
}
