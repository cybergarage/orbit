// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import type {Model, Prompt, Provider} from './models/index.js'

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

  newSession(): Session {
    return new Session()
  }

  prompt(prompts: Prompt[]): Promise<string> {
    return this.model.prompt(prompts)
  }

  run(session: Session, prompts: Prompt[]): Promise<string> {
    return this.model.prompt(prompts)
  }
}
