// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

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
