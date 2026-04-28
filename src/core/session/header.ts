// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {MessagePayload} from './message.js'

import {Message, MessageType} from './message.js'

export interface SessionHeaderOptions {
  payload?: MessagePayload
}

export class SessionHeader extends Message {
  constructor(options: SessionHeaderOptions = {}) {
    super(MessageType.Session, {
      parentid: null,
      ...options,
    })
  }
}
