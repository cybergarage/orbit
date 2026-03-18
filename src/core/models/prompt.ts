// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import type {ChatMessage} from './agent.js'

export function splitSystemPrompt(messages: ChatMessage[]): {messages: ChatMessage[]; systemPrompt?: string} {
  const systemMessages = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content.trim())
  const visibleMessages = messages.filter((message) => message.role !== 'system')

  return {
    messages: visibleMessages,
    systemPrompt: systemMessages.length > 0 ? systemMessages.join('\n\n') : undefined,
  }
}
