// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {Memory} from './memory/index.js'

import {PromptMemory} from './memory/index.js'

export interface SessionOptions {
  memory?: Memory
}

export class Session {
  public readonly memory: Memory
  public readonly options: SessionOptions

  constructor(options: SessionOptions = {}) {
    this.memory = options.memory ?? new PromptMemory()
    this.options = options
  }

  getMemory(): Memory {
    return this.memory
  }
}
