// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {RunContext} from '../execution/run.js'
import type {Message} from '../message/index.js'
import type {PreparedModelInvocation} from '../models/model.js'

import {IncompleteModelResponseError} from '../errors/index.js'
import {
  assertCompleteModelResponse,
  isOllamaTransportFailure,
  isRetryableOllamaTransportFailure,
} from '../models/termination.js'

export interface SummaryCallService {
  check(): void
  invoke(request: PreparedModelInvocation, details: Record<string, unknown>): Promise<Message>
}

export function createSummaryCallService(options: {
  diagnostic(type: string, data: Record<string, unknown>, level?: 'error' | 'info'): void
  estimate(request: PreparedModelInvocation): number
  provider: string
  run: RunContext
}): SummaryCallService {
  const {diagnostic} = options
  return {
    check: () => options.run.check(),
    async invoke(request, details) {
      const invokeOnce = async (attempt: number) => {
        const startedAt = performance.now()
        options.run.consume('modelCalls')
        diagnostic('context.summary.started', {
          attempt,
          ...details,
          inputTokens: options.estimate(request),
        })
        try {
          const response = await options.run.wait('context-summary', request.invoke())
          diagnostic('context.summary.completed', {attempt, durationMs: performance.now() - startedAt})
          return response
        } catch (error) {
          const cause = error instanceof Error ? error.cause : undefined
          const causeCode = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined
          diagnostic(
            'context.summary.failed',
            {
              attempt,
              ...(typeof causeCode === 'string' ? {causeCode} : {}),
              durationMs: performance.now() - startedAt,
              reason: isOllamaTransportFailure(error) ? 'transport-failed' : 'request-failed',
            },
            'error',
          )
          throw error
        }
      }

      let response: Message
      try {
        response = await invokeOnce(1)
      } catch (error) {
        if (options.provider !== 'ollama' || !isRetryableOllamaTransportFailure(error)) throw error
        options.run.check()
        // A failed fetch has no response to turn into assistant history; charge one retry to this Run.
        response = await invokeOnce(2)
      }

      options.run.check()
      try {
        assertCompleteModelResponse(response)
      } catch (error) {
        if (error instanceof IncompleteModelResponseError && ['length', 'max_tokens'].includes(error.stopReason))
          diagnostic('context.summary.truncated', {...details, reason: error.stopReason})
        throw error
      }

      return response
    },
  }
}
