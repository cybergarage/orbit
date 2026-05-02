// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

export const ProcessorType = {
  Agent: 'agent',
  Model: 'model',
  Sequence: 'sequence',
} as const

export type ProcessorType = (typeof ProcessorType)[keyof typeof ProcessorType]
export type ProcessorInput = unknown
export type ProcessorOutput = unknown
export type ProcessorOptions = Record<string, unknown>

export interface Processor<
  RunInput = ProcessorInput,
  RunOutput = ProcessorOutput,
  CallOptions extends ProcessorOptions = ProcessorOptions,
> {
  getName(suffix?: string): string
  invoke(input: RunInput, options?: Partial<CallOptions>): Promise<RunOutput>
  name?: string
}

export function formatProcessorName(type: ProcessorType, suffix?: string): string {
  return suffix ? `${type}:${suffix}` : type
}
