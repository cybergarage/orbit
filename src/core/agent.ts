// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import type {Model, Prompt, Provider} from './models/index.js'
import type {SessionOptions} from './session.js'

import {getModel} from './models/index.js'
import {Session} from './session.js'

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

  newSession(options: SessionOptions = {}): Session {
    return new Session(options)
  }

  prompt(prompts: Prompt[]): Promise<Prompt> {
    return this.model.prompt(prompts)
  }

  run(session: Session, prompts: Prompt[]): Promise<Prompt> {
    return this.model.prompt(prompts)
  }
}
