// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import type {Model} from './models/model.js'
import type {Prompt} from './models/prompt.js'
import type {Provider} from './models/provider.js'

import {getModel} from './models/factory.js'

export interface AgentOptions {
  deps?: {
    createModel?: typeof getModel
  }
  model?: {
    name?: string
    provider?: Provider
  }
}

export class Agent {
  private readonly model: Model

  constructor(options: AgentOptions = {}) {
    const createModel = options.deps?.createModel ?? getModel
    this.model = createModel(options.model?.provider, options.model?.name)
  }

  prompt(messages: Prompt[]): Promise<string> {
    return this.model.prompt(messages)
  }
}
