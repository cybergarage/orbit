// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {Message} from '../message/index.js'
import type {Session} from './session.js'

import {Message as CoreMessage} from '../message/index.js'
import {checkpointPrefix} from './compaction.js'

export interface SessionModelContext {
  messages: Message[]
}

/** Projects canonical session history into provider-neutral model input. */
export class SessionContextBuilder {
  build(session: Session): SessionModelContext {
    if (session.getEntries().some((entry) => entry.type === 'context_projection'))
      throw new Error('verified-context-required')
    const checkpoint = session.getCompaction()
    const all = session.getConversationMessages()
    const selected = checkpoint ? all.slice(all.findIndex((message) => message.id === checkpoint.firstRetainedId)) : all
    const summary = checkpoint ? checkpointPrefix(checkpoint, all) : []
    return {
      messages: [
        ...summary,
        ...selected.map(
          (message) =>
            new CoreMessage(message.type, {
              contents: [...message.contents],
              id: message.id,
              parentid: message.parentid,
              ...(message.payload === undefined ? {} : {payload: structuredClone(message.payload)}),
              role: message.role,
              timestamp: message.timestamp,
            }),
        ),
      ],
    }
  }
}
