// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {Processor, ProcessorType} from './processor.js'

import {InvalidConfigurationError} from '../errors/index.js'

export class ProcessorRegistry {
  private readonly processors = new Map<string, Processor>()

  lookup(type: ProcessorType, name: string): Processor | undefined {
    return this.processors.get(this.getKey(type, name))
  }

  register(processor: Processor): void {
    const key = this.getKey(processor.type, processor.name)

    if (this.processors.has(key)) {
      throw new InvalidConfigurationError(
        `Processor is already registered for type "${processor.type}" and name "${processor.name}".`,
      )
    }

    this.processors.set(key, processor)
  }

  private getKey(type: ProcessorType, name: string): string {
    return `${type}:${name}`
  }
}
