// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {OperatorSequenceEmptyError} from '../errors/index.js'
import {formatOperatorName, type Operator, type OperatorOptions, OperatorType} from './operator.js'

export class OperatorSequence<
  RunInput,
  RunOutput,
  CallOptions extends OperatorOptions = OperatorOptions,
> implements Operator<RunInput, RunOutput, CallOptions> {
  constructor(private readonly operators: readonly Operator<unknown, unknown, CallOptions>[]) {
    if (operators.length === 0) {
      throw new OperatorSequenceEmptyError()
    }
  }

  getName(suffix?: string): string {
    return formatOperatorName(OperatorType.Sequence, suffix)
  }

  async invoke(input: RunInput, options?: Partial<CallOptions>): Promise<RunOutput> {
    let current: unknown = input

    for (const operator of this.operators) {
      // Operators are intentionally chained: each output becomes the next input.
      // eslint-disable-next-line no-await-in-loop
      current = await operator.invoke(current, options)
    }

    return current as RunOutput
  }
}
