// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {Message, Model, Provider} from './models/index.js'
import type {Operator, OperatorOptions} from './processor/index.js'
import type {Session} from './session/index.js'

import {getModel} from './models/index.js'
import {formatOperatorName, OperatorType} from './processor/index.js'
import {State} from './state.js'

export interface AgentOptions {
  deps?: {
    createModel?: typeof getModel
  }
  messages?: Message[]
  model?: {
    name?: string
    provider?: Provider
  }
  state?: State
}

export class Agent implements Operator<Message[], Message, OperatorOptions> {
  public readonly messages: Message[]
  public readonly state: State
  private readonly model: Model

  constructor(options: AgentOptions = {}) {
    const createModel = options.deps?.createModel ?? getModel
    this.model = createModel(options.model?.provider, options.model?.name)
    this.messages = [...(options.messages ?? [])]
    this.state = options.state ?? new State()
  }

  getModel(): Model {
    return this.model
  }

  getName(suffix?: string): string {
    return formatOperatorName(OperatorType.Agent, suffix)
  }

  getSession(): Session {
    return this.state.getSession()
  }

  getState(): State {
    return this.state
  }

  async invoke(messages: Message[], options?: Partial<OperatorOptions>): Promise<Message> {
    const session = this.getSession()
    session.appendMessages(messages)
    const modelMessage = await this.model.invoke([...this.messages, ...messages], options)
    session.appendMessages([modelMessage])
    return modelMessage
  }

  async run(_session: Session, messages: Message[], options?: Partial<OperatorOptions>): Promise<Message> {
    return this.invoke(messages, options)
  }
}
