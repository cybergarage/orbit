// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {Message} from '../message/index.js'

import {Role} from './role.js'

export interface Prompt {
  content: string
  role: Role
}

export function splitSystemPrompt(messages: Message[]): {messages: Message[]; systemPrompt?: string} {
  const systemMessages = messages
    .filter((message) => message.role === Role.System)
    .map((message) => message.content.trim())
  const visibleMessages = messages.filter((message) => message.role !== Role.System)

  return {
    messages: visibleMessages,
    systemPrompt: systemMessages.length > 0 ? systemMessages.join('\n\n') : undefined,
  }
}
