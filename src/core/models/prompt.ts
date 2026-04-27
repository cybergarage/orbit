// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {Role} from './role.js'

export interface Prompt {
  content: string
  role: Role
}

export function splitSystemPrompt(messages: Prompt[]): {messages: Prompt[]; systemPrompt?: string} {
  const systemMessages = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content.trim())
  const visibleMessages = messages.filter((message) => message.role !== 'system')

  return {
    messages: visibleMessages,
    systemPrompt: systemMessages.length > 0 ? systemMessages.join('\n\n') : undefined,
  }
}
