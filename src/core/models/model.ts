// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import type {Prompt} from './prompt.js'
import type {Provider} from './provider.js'

export interface Model {
  getModel(): string
  getProvider(): Provider
  prompt(messages: Prompt[]): Promise<Prompt>
}
