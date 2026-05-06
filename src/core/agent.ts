// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {Message, Model, Provider} from './models/index.js'
import type {Operator, OperatorOptions} from './processor/index.js'

import {getModel} from './models/index.js'
import {formatOperatorName, OperatorType} from './processor/index.js'
import {Session} from './session/index.js'

export interface AgentOptions {
  deps?: {
    createModel?: typeof getModel
  }
  model?: {
    name?: string
    provider?: Provider
  }
}

export class Agent implements Operator<Message[], Message, OperatorOptions> {
  private readonly model: Model

  constructor(options: AgentOptions = {}) {
    const createModel = options.deps?.createModel ?? getModel
    this.model = createModel(options.model?.provider, options.model?.name)
  }

  getName(suffix?: string): string {
    return formatOperatorName(OperatorType.Agent, suffix)
  }

  invoke(messages: Message[], options?: Partial<OperatorOptions>): Promise<Message> {
    return this.model.invoke(messages, options)
  }

  newSession(): Session {
    return new Session()
  }

  async run(_session: Session, messages: Message[], options?: Partial<OperatorOptions>): Promise<Message> {
    return this.model.invoke(messages, options)
  }
}
