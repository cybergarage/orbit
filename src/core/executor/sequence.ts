// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {ExecutorSequenceEmptyError} from '../errors/index.js'
import {type Executor, type ExecutorOptions, ExecutorType, formatExecutorName} from './executor.js'

export class ExecutorSequence<
  RunInput,
  RunOutput,
  CallOptions extends ExecutorOptions = ExecutorOptions,
> implements Executor<RunInput, RunOutput, CallOptions> {
  constructor(private readonly executors: readonly Executor<unknown, unknown, CallOptions>[]) {
    if (executors.length === 0) {
      throw new ExecutorSequenceEmptyError()
    }
  }

  getName(suffix?: string): string {
    return formatExecutorName(ExecutorType.Sequence, suffix)
  }

  async invoke(input: RunInput, options?: Partial<CallOptions>): Promise<RunOutput> {
    let current: unknown = input

    for (const executor of this.executors) {
      // Executors are intentionally chained: each output becomes the next input.
      // eslint-disable-next-line no-await-in-loop
      current = await executor.invoke(current, options)
    }

    return current as RunOutput
  }
}
