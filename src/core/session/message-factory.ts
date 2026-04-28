// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {MessageOptions, MessageType} from './message.js'

import {Message} from './message.js'

export type CreateMessageOptions = MessageOptions

export function createMessage(type: MessageType, options: CreateMessageOptions = {}): Message {
  return new Message(type, options)
}
