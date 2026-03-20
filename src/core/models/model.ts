// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import type {Prompt} from './prompt.js'

export interface Model {
  prompt(messages: Prompt[]): Promise<string>
}
