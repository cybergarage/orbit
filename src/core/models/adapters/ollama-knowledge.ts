// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable camelcase -- Ollama uses snake_case wire fields. */
import {fetch} from 'undici'

import type {KnowledgeExtractor} from '../../projects/automatic-memory.js'

/** Local-only, tool-free extraction with a bounded streaming response read. */
export function createOllamaKnowledgeExtractor(model = 'gemma4:12b'): KnowledgeExtractor {
  return async (input, signal) => {
    const response = await fetch('http://127.0.0.1:11434/api/chat', {
      body: JSON.stringify({
        format: 'json',
        keep_alive: '60s',
        messages: [{content: input, role: 'user'}],
        model,
        options: {num_ctx: 4096, num_predict: 1024, temperature: 0},
        stream: false,
        think: false,
      }),
      headers: {'Content-Type': 'application/json'},
      method: 'POST',
      signal,
    })
    if (!response.ok || !response.body) throw new Error('Local knowledge model unavailable')
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let bytes = 0
    try {
      while (true) {
        // A sequential bounded read also rejects servers that ignore num_predict.
        // eslint-disable-next-line no-await-in-loop
        const part = await reader.read()
        if (part.done) break
        bytes += part.value.byteLength
        if (bytes > 65_536) throw new Error('Local knowledge response exceeds byte limit')
        chunks.push(part.value)
      }
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }

    const output = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (typeof output.message?.content !== 'string') throw new Error('Invalid local knowledge response')
    return {inputTokens: output.prompt_eval_count, outputTokens: output.eval_count, text: output.message.content}
  }
}
