// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

export const ExecutorType = {
  Agent: 'agent',
  Model: 'model',
  Sequence: 'sequence',
  Tool: 'tool',
} as const

export type ExecutorType = (typeof ExecutorType)[keyof typeof ExecutorType]
export type ExecutorInput = unknown
export type ExecutorOutput = unknown
export type ExecutorOptions = Record<string, unknown>

export interface Executor<
  RunInput = ExecutorInput,
  RunOutput = ExecutorOutput,
  CallOptions extends ExecutorOptions = ExecutorOptions,
> {
  getName(suffix?: string): string
  invoke(input: RunInput, options?: Partial<CallOptions>): Promise<RunOutput>
  name?: string
}

export function formatExecutorName(type: ExecutorType, suffix?: string): string {
  return suffix ? `${type}:${suffix}` : type
}
