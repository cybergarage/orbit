// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {Message} from '../message/index.js'
import type {Session} from './session.js'

import {Message as CoreMessage} from '../message/index.js'

export interface SessionModelContext {
  messages: Message[]
}

/** Projects canonical session history into provider-neutral model input. */
export class SessionContextBuilder {
  build(session: Session): SessionModelContext {
    return {
      messages: session.getConversationMessages().map(
        (message) =>
          new CoreMessage(message.type, {
            contents: [...message.contents],
            id: message.id,
            parentid: message.parentid,
            ...(message.payload === undefined ? {} : {payload: message.payload}),
            role: message.role,
            timestamp: message.timestamp,
          }),
      ),
    }
  }
}
