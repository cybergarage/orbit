// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

export type ChatRole = 'assistant' | 'system' | 'user'

export interface ChatMessage {
  content: string
  role: ChatRole
}

export interface Agent {
  chat(messages: ChatMessage[]): Promise<string>
}
