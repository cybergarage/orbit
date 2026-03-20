// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import type {Role} from './role.js'

export interface Prompt {
  content: string
  role: Role
}

export interface Agent {
  prompt(messages: Prompt[]): Promise<string>
}
