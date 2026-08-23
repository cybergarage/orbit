// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {z} from 'zod'

import type {ToolDefinition, ToolExecutionContext, ToolResult, ToolScheduling} from '../definition.js'

import {zodToolInput} from '../definition.js'

export function defineBuiltinTool<Input, Details = unknown>(options: {
  description: string
  execute(input: Input, context: ToolExecutionContext): Promise<ToolResult<Details>>
  name: string
  scheduling: ToolScheduling
  schema: z.ZodType<Input>
}): ToolDefinition<Input, Details> {
  const input = zodToolInput(options.schema)
  return {
    execute: options.execute,
    input,
    scheduling: options.scheduling,
    source: {kind: 'builtin'},
    spec: {
      description: options.description,
      inputSchema: input.jsonSchema,
      name: options.name,
    },
  }
}
