// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {Executor, ExecutorOptions} from '../executor/index.js'
import type {Message} from '../message/index.js'
import type {Provider} from './provider.js'

export interface Model extends Executor<Message[], Message, ExecutorOptions> {
  getModel(): string
  getName(suffix?: string): string
  getProvider(): Provider
  invoke(messages: Message[], options?: Partial<ExecutorOptions>): Promise<Message>
}
