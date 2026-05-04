// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {Executor, ExecutorOptions} from './executor/index.js'
import type {Message, Model, Provider} from './models/index.js'
import type {SessionOptions} from './session/index.js'

import {ExecutorType, formatExecutorName} from './executor/index.js'
import {Dialogue} from './index.js'
import {getModel} from './models/index.js'
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

export class Agent implements Executor<Message[], Message, ExecutorOptions> {
  private readonly model: Model

  constructor(options: AgentOptions = {}) {
    const createModel = options.deps?.createModel ?? getModel
    this.model = createModel(options.model?.provider, options.model?.name)
  }

  getName(suffix?: string): string {
    return formatExecutorName(ExecutorType.Agent, suffix)
  }

  invoke(messages: Message[], options?: Partial<ExecutorOptions>): Promise<Message> {
    return this.model.invoke(messages, options)
  }

  newSession(options: SessionOptions = {}): Session {
    return new Session(options)
  }

  async run(session: Session, messages: Message[], options?: Partial<ExecutorOptions>): Promise<Message> {
    const answer = await this.model.invoke(messages, options)
    session.getMemory().add(new Dialogue(messages, answer))
    return answer
  }
}
