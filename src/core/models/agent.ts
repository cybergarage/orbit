// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import type {Role} from './role.js'

export interface ChatMessage {
  content: string
  role: Role
}

export interface Agent {
  chat(messages: ChatMessage[]): Promise<string>
}
