// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {ProcessorSequenceEmptyError} from '../errors/index.js'
import {formatProcessorName, type Processor, type ProcessorOptions, ProcessorType} from './processor.js'

export class ProcessorSequence<
  RunInput,
  RunOutput,
  CallOptions extends ProcessorOptions = ProcessorOptions,
> implements Processor<RunInput, RunOutput, CallOptions> {
  constructor(private readonly processors: readonly Processor<unknown, unknown, CallOptions>[]) {
    if (processors.length === 0) {
      throw new ProcessorSequenceEmptyError()
    }
  }

  getName(suffix?: string): string {
    return formatProcessorName(ProcessorType.Sequence, suffix)
  }

  async invoke(input: RunInput, options?: Partial<CallOptions>): Promise<RunOutput> {
    let current: unknown = input

    for (const processor of this.processors) {
      // Processors are intentionally chained: each output becomes the next input.
      // eslint-disable-next-line no-await-in-loop
      current = await processor.invoke(current, options)
    }

    return current as RunOutput
  }
}
