// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {Operator, OperatorInput, OperatorOptions, OperatorOutput, OperatorType} from './operator.js'

export type ProcessorType = OperatorType
export type ProcessorInput = OperatorInput
export type ProcessorOutput = OperatorOutput
export type ProcessorOptions = OperatorOptions

export interface Processor<
  RunInput = ProcessorInput,
  RunOutput = ProcessorOutput,
  CallOptions extends ProcessorOptions = ProcessorOptions,
> extends Operator<RunInput, RunOutput, CallOptions> {
  name: string
  type: ProcessorType
}
