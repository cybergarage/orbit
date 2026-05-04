// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {z} from 'zod'

import type {Processor, ProcessorOptions} from '../processor/index.js'

import {formatProcessorName, ProcessorType} from '../processor/index.js'

export type ToolInput = unknown
export type ToolOutput = unknown
export type ToolContext = Record<string, unknown>

export interface ToolOptions extends ProcessorOptions {
  context?: ToolContext
}

export type ToolHandler<Input, Output, Options extends ToolOptions = ToolOptions> = (
  input: Input,
  config: Partial<Options>,
) => Output | Promise<Output>

export interface ToolConfig<Input> {
  description: string
  name: string
  schema: z.ZodType<Input>
}

export class Tool<
  Input = ToolInput,
  Output = ToolOutput,
  Options extends ToolOptions = ToolOptions,
> implements Processor<Input, Output, Options> {
  public readonly description: string
  public readonly name: string
  public readonly schema: z.ZodType<Input>

  constructor(
    private readonly handler: ToolHandler<Input, Output, Options>,
    config: ToolConfig<Input>,
  ) {
    this.description = config.description
    this.name = config.name
    this.schema = config.schema
  }

  getName(suffix?: string): string {
    return formatProcessorName(ProcessorType.Tool, suffix)
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
