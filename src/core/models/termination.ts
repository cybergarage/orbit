// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {Message} from '../message/index.js'

import {IncompleteModelResponseError} from '../errors/index.js'

/** A rejected response is never appended as executable conversation history. */
export function assertCompleteModelResponse(message: Message): void {
  const payload = message.payload as undefined | {response?: {stopReason?: unknown}}
  const reason = payload?.response?.stopReason
  if (typeof reason === 'string' && incompleteReasons.has(reason)) throw new IncompleteModelResponseError(reason)
}

const incompleteReasons = new Set([
  'content_filter',
  'length',
  'max_tokens',
  'model_context_window_exceeded',
  'pause_turn',
  'refusal',
])
