// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {Message, Model, Provider} from './models/index.js'
import type {Operator, OperatorOptions} from './processor/index.js'

import {getModel} from './models/index.js'
import {formatOperatorName, OperatorType} from './processor/index.js'
import {Session} from './session/index.js'
import {State} from './state.js'

export interface AgentOptions {
  deps?: {
    createModel?: typeof getModel
  }
  model?: {
    name?: string
    provider?: Provider
  }
  state?: State
}

export class Agent implements Operator<Message[], Message, OperatorOptions> {
  public readonly state: State
  private readonly model: Model

  constructor(options: AgentOptions = {}) {
    const createModel = options.deps?.createModel ?? getModel
    this.model = createModel(options.model?.provider, options.model?.name)
    this.state = options.state ?? new State()
  }

  getModel(): Model {
    return this.model
  }

  getName(suffix?: string): string {
    return formatOperatorName(OperatorType.Agent, suffix)
  }

  getState(): State {
    return this.state
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
