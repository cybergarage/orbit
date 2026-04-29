// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {Message} from '../message/index.js'
import type {Prompt} from './prompt.js'
import type {Provider} from './provider.js'

export interface Model {
  getModel(): string
  getProvider(): Provider
  prompt(messages: Prompt[]): Promise<Message>
}
