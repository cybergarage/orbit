// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {z} from 'zod'

import type {Operator, OperatorOptions} from '../processor/index.js'
import type {JsonSchema, ToolScheduling} from './definition.js'

import {formatOperatorName, OperatorType} from '../processor/index.js'

export type ToolInput = unknown
export type ToolOutput = unknown
export type ToolContext = Record<string, unknown>

export interface ToolOptions extends OperatorOptions {
  context?: ToolContext
  signal?: AbortSignal
}

export type ToolHandler<Input, Output, Options extends ToolOptions = ToolOptions> = (
  input: Input,
  config: Partial<Options>,
) => Output | Promise<Output>

export interface ToolConfig<Input> {
  description: string
  inputSchema?: JsonSchema
  name: string
  scheduling?: ToolScheduling
  schema: z.ZodType<Input>
}

export class Tool<
  Input = ToolInput,
  Output = ToolOutput,
  Options extends ToolOptions = ToolOptions,
> implements Operator<Input, Output, Options> {
  public readonly description: string
  public readonly inputSchema: JsonSchema
  public readonly name: string
  public readonly scheduling: ToolScheduling
  public readonly schema: z.ZodType<Input>

  constructor(
    private readonly handler: ToolHandler<Input, Output, Options>,
    config: ToolConfig<Input>,
  ) {
    this.description = config.description
    this.inputSchema = config.inputSchema ?? (z.toJSONSchema(config.schema, {io: 'input'}) as JsonSchema)
    this.name = config.name
    this.scheduling = config.scheduling ?? 'serial'
    this.schema = config.schema
  }

  getName(suffix?: string): string {
    return formatOperatorName(OperatorType.Tool, suffix)
  }

  async invoke(input: Input, options: Partial<Options> = {}): Promise<Output> {
    const parsedInput = this.schema.parse(input)
    return this.handler(parsedInput, options)
  }
}

export function tool<Input, Output, Options extends ToolOptions = ToolOptions>(
  handler: ToolHandler<Input, Output, Options>,
  config: ToolConfig<Input>,
): Tool<Input, Output, Options> {
  return new Tool(handler, config)
}
