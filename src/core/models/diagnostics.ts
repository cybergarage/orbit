// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {ModelInvokeOptions, ModelResponseMetadata, ModelToolCall} from './model.js'

export function emitModelRequest(
  options: Partial<ModelInvokeOptions> | undefined,
  metadata: {messageCount: number; model: string; provider: string; toolCount: number},
  request: unknown,
): void {
  options?.diagnostics?.emit({
    ...options.diagnosticContext,
    data: metadata,
    fullData: {request},
    type: 'model.request.started',
  })
}

export function emitModelResponse(
  options: Partial<ModelInvokeOptions> | undefined,
  result: {content: string; metadata: ModelResponseMetadata; response: unknown; toolCalls: ModelToolCall[]},
): void {
  const {content, metadata, response, toolCalls} = result
  options?.diagnostics?.emit({
    ...options.diagnosticContext,
    data: {
      ...metadata,
      contentLength: content.length,
      toolCallCount: toolCalls.length,
    },
    fullData: {content, response, toolCalls},
    type: 'model.response.completed',
  })
}

export function emitModelFailure(
  options: Partial<ModelInvokeOptions> | undefined,
  metadata: {durationMs: number; model: string; provider: string},
  error: unknown,
): void {
  options?.diagnostics?.emit({
    ...options.diagnosticContext,
    data: {
      ...metadata,
      error: error instanceof Error ? error.message : String(error),
    },
    level: 'error',
    type: 'model.response.failed',
  })
}
