// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {Model, ModelInvokeOptions} from '@cybergarage/orbit'

import {getModelRegistry, Message, MessageType, registerModelProvider} from '@cybergarage/orbit'
import {setTimeout as delay} from 'node:timers/promises'

// A deterministic adapter for trying the host without credentials or network calls.
// It exercises the real Agent, tool approval, journal and Session implementations.
class DemoModel implements Model {
  getModel() {
    return 'demo-v1'
  }

  getName() {
    return 'model:demo'
  }

  getProvider() {
    return 'orbit-demo'
  }

  async invoke(messages: Message[], options: Partial<ModelInvokeOptions> = {}): Promise<Message> {
    const last = messages.at(-1)
    if (last?.type === MessageType.Tool) {
      return new Message(MessageType.Assistant, {content: `Tool result: ${last.content}`})
    }

    if (last?.content === 'wait-demo') {
      await delay(30_000, undefined, {signal: options.signal})
    }

    if (last?.content === 'write-demo') {
      return new Message(MessageType.Assistant, {
        payload: {
          toolCalls: [
            {
              id: 'demo-write',
              input: {content: 'Written through an approved Orbit operation.\n', path: 'demo-note.txt'},
              name: 'write',
            },
          ],
        },
      })
    }

    return new Message(MessageType.Assistant, {content: `Demo reply: ${last?.content ?? ''}`})
  }
}

export function registerDemoModel(): void {
  if (!getModelRegistry().get('orbit-demo')) {
    registerModelProvider({create: () => new DemoModel(), defaultModel: 'demo-v1', name: 'orbit-demo'})
  }
}
