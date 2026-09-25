// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {Message} from '../message/index.js'

import {ContextOverflowError, IncompleteModelResponseError} from '../errors/index.js'

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

/** Only ordinary generation failures are eligible; callers must first reduce input. */
export function isRecoverableContextFailure(error: unknown): boolean {
  return (
    error instanceof ContextOverflowError ||
    (error instanceof IncompleteModelResponseError &&
      ['invalid-tool-arguments', 'length', 'max_tokens', 'model_context_window_exceeded'].includes(error.stopReason))
  )
}
