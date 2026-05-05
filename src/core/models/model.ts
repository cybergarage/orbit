// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {Message} from '../message/index.js'
import type {Operator, OperatorOptions} from '../processor/index.js'
import type {Provider} from './provider.js'

export interface Model extends Operator<Message[], Message, OperatorOptions> {
  getModel(): string
  getName(suffix?: string): string
  getProvider(): Provider
  invoke(messages: Message[], options?: Partial<OperatorOptions>): Promise<Message>
}
