// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

export const OperatorType = {
  Agent: 'agent',
  Model: 'model',
  Sequence: 'sequence',
  Tool: 'tool',
} as const

export type OperatorType = (typeof OperatorType)[keyof typeof OperatorType]
export type OperatorInput = unknown
export type OperatorOutput = unknown
export type OperatorOptions = Record<string, unknown>

export interface Operator<
  RunInput = OperatorInput,
  RunOutput = OperatorOutput,
  CallOptions extends OperatorOptions = OperatorOptions,
> {
  getName(suffix?: string): string
  invoke(input: RunInput, options?: Partial<CallOptions>): Promise<RunOutput>
  name?: string
}

export function formatOperatorName(type: OperatorType, suffix?: string): string {
  return suffix ? `${type}:${suffix}` : type
}
