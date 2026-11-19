// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {spawn} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {isAbsolute} from 'node:path'

import {ModelAbortError} from '../../errors/index.js'

export type AppleMemoryFrame = Record<string, unknown>
export interface AppleMemoryChannel {
  close(): void
  next(): Promise<AppleMemoryFrame>
  send(frame: AppleMemoryFrame): void
}
export type AppleMemoryChannelFactory = (initial: AppleMemoryFrame, signal?: AbortSignal) => AppleMemoryChannel

/** A fresh, bounded, duplex process per native generation. Never runs a shell. */
export function createAppleMemoryChannel(helperPath: string, timeoutMs = 120_000): AppleMemoryChannelFactory {
  if (!isAbsolute(helperPath) || helperPath.includes('\0')) throw new Error('Apple memory helper path must be absolute')
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000)
    throw new Error('Apple memory timeout must be between 1 and 120000 milliseconds')
  return (initial, signal) => {
    signal?.throwIfAborted()
    const child = spawn(helperPath, [], {shell: false, stdio: ['pipe', 'pipe', 'pipe']})
    let buffer = Buffer.alloc(0)
    let total = 0
    let stderr = 0
    let inputBytes = 0
    let failure: Error | undefined
    let waiter: undefined | {reject(error: Error): void; resolve(value: AppleMemoryFrame): void}
    const queue: AppleMemoryFrame[] = []
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const stop = (error: Error) => {
      if (failure) return
      failure = error
      queue.length = 0
      clearTimeout(timer)
      clearTimeout(handshake)
      signal?.removeEventListener('abort', abort)
      child.kill('SIGTERM')
      killTimer = setTimeout(() => child.kill('SIGKILL'), 250)
      killTimer.unref()
      waiter?.reject(error)
      waiter = undefined
    }

    const abort = () => stop(new ModelAbortError('Apple memory invocation cancelled'))
    const timer = setTimeout(() => stop(new Error('Apple memory generation timed out')), timeoutMs)
    const handshake = setTimeout(
      () => stop(new Error('Apple memory helper handshake timed out')),
      Math.min(timeoutMs, 3000),
    )
    signal?.addEventListener('abort', abort, {once: true})
    if (signal?.aborted) abort()
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.length
      if (stderr > 16_384) stop(new Error('Apple memory stderr exceeds limit'))
    })
    child.stdout.on('data', (chunk: Buffer) => {
      if (failure) return
      total += chunk.length
      if (total > 1_048_576) return stop(new Error('Apple memory output exceeds limit'))
      buffer = Buffer.concat([buffer, chunk])
      let index: number
      while ((index = buffer.indexOf(10)) >= 0) {
        const line = buffer.subarray(0, index)
        buffer = buffer.subarray(index + 1)
        try {
          const frame = JSON.parse(line.toString('utf8')) as AppleMemoryFrame
          if (!frame || typeof frame !== 'object' || Array.isArray(frame)) throw new Error('Invalid frame object')
          clearTimeout(handshake)
          if (waiter) {
            waiter.resolve(frame)
            waiter = undefined
          } else queue.push(frame)
        } catch {
          return stop(new Error('Invalid Apple memory frame'))
        }
      }
    })
    child.stdin.on('error', () => stop(new Error('Apple memory helper input closed')))
    child.on('error', () => stop(new Error('Cannot start Apple memory helper')))
    child.on('close', () => {
      if (killTimer) clearTimeout(killTimer)
      // Queued final frames are consumed before EOF, but incomplete frames fail closed.
      if (buffer.length > 0 || queue.length === 0) stop(new Error('Apple memory helper closed'))
      else {
        clearTimeout(timer)
        clearTimeout(handshake)
        signal?.removeEventListener('abort', abort)
      }
    })
    const channel: AppleMemoryChannel = {
      close: () => stop(new Error('Apple memory channel closed')),
      async next() {
        if (failure) throw failure
        const frame = queue.shift()
        if (frame) return frame
        if (waiter) throw new Error('Concurrent Apple memory reads are forbidden')
        return new Promise((resolve, reject) => {
          waiter = {reject, resolve}
        })
      },
      send(frame) {
        if (failure) throw failure
        const data = JSON.stringify(frame)
        inputBytes += Buffer.byteLength(data) + 1
        if (inputBytes > 1_048_576) throw new Error('Apple memory input exceeds limit')
        child.stdin.write(`${data}\n`)
      },
    }
    try {
      channel.send(initial)
    } catch (error) {
      stop(new Error('Apple memory initialization failed'))
      throw error
    }

    return channel
  }
}

export function appleMemoryNonce(): string {
  return randomUUID()
}
