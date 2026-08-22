// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {MessageOptions, MessagePayload} from '../message/index.js'

import {Message, MessageType} from '../message/index.js'

export interface SessionHeaderOptions {
  id?: MessageOptions['id']
  payload?: MessagePayload
  timestamp?: MessageOptions['timestamp']
}

export class SessionHeader extends Message {
  constructor(options: SessionHeaderOptions = {}) {
    super(MessageType.Session, {
      parentid: null,
      ...options,
    })
  }
}
