// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio} from 'node:child_process'

import {spawn} from 'node:child_process'
import {isAbsolute} from 'node:path'
import {performance} from 'node:perf_hooks'

import type {Message} from '../../message/index.js'
import type {Model, ModelInvokeOptions, PreparedModelInvocation} from '../model.js'
import type {Provider} from '../provider.js'

import {ContextOverflowError, ModelAbortError} from '../../errors/index.js'
import {Message as CoreMessage, MessageType} from '../../message/index.js'
import {formatOperatorName, OperatorType} from '../../processor/index.js'
import {emitModelFailure, emitModelRequest, emitModelResponse} from '../diagnostics.js'
import {freezeModelRequest} from '../prepared.js'
import {getModelOutputParts, getToolCalls, getToolResult} from './tools.js'

const BYTE_LIMIT = 1024 * 1024
const MAX_MESSAGES = 256

export interface AppleAvailability {
  available: boolean
  reason?: string
}

export interface AppleHelperTransport {
  request(request: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<unknown>
}

export interface AppleFoundationModelsOptions {
  helperPath?: string
  timeoutMs?: number
  transport?: AppleHelperTransport
}

/** One bounded process per request. No shell and no inherited stdin. */
export class AppleHelperClient implements AppleHelperTransport {
  constructor(
    private readonly helperPath: string,
    private readonly timeoutMs = 120_000,
    private readonly start: (
      command: string,
      args: readonly string[],
      options: SpawnOptionsWithoutStdio,
    ) => ChildProcessWithoutNullStreams = spawn,
  ) {
    if (!isAbsolute(helperPath) || helperPath.includes('\0')) throw new Error('Apple helper path must be absolute')
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000)
      throw new Error('Apple helper timeout must be between 1 and 600000 milliseconds')
  }

  request(request: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) return Promise.reject(new ModelAbortError('Apple model invocation cancelled'))
    const input = JSON.stringify(request)
    if (Buffer.byteLength(input) > BYTE_LIMIT) return Promise.reject(new Error('Apple helper input exceeds 1 MiB'))
    return new Promise((resolve, reject) => {
      const child = this.start(this.helperPath, [], {shell: false, stdio: ['pipe', 'pipe', 'pipe']})
      let output = Buffer.alloc(0)
      let errorBytes = 0
      let failure: Error | undefined
      let killTimer: ReturnType<typeof setTimeout> | undefined
      const stop = (error: Error) => {
        if (failure) return
        failure = error
        child.kill('SIGTERM')
        killTimer = setTimeout(() => child.kill('SIGKILL'), 250)
        killTimer.unref()
      }

      const abort = () => stop(new ModelAbortError('Apple model invocation cancelled'))
      const timer = setTimeout(() => stop(new Error('Apple helper timed out')), this.timeoutMs)
      signal?.addEventListener('abort', abort, {once: true})
      if (signal?.aborted) abort()
      child.stdout!.on('data', (data: Buffer) => {
        if (failure) return
        if (output.length + data.length > BYTE_LIMIT) stop(new Error('Apple helper output exceeds 1 MiB'))
        else output = Buffer.concat([output, data])
      })
      child.stderr!.on('data', (data: Buffer) => {
        errorBytes += data.length
        if (errorBytes > 16_384) stop(new Error('Apple helper stderr exceeds 16 KiB'))
      })
      child.stdin!.on('error', () => stop(new Error('Apple helper closed its input')))
      child.on('error', () =>
        stop(new Error('Cannot start Apple helper; compile it and check its path and permissions')),
      )
      child.on('close', (code) => {
        clearTimeout(timer)
        if (killTimer) clearTimeout(killTimer)
        signal?.removeEventListener('abort', abort)
        if (failure) return reject(failure)
        if (code !== 0) return reject(new Error(`Apple helper exited unsuccessfully (${code})`))
        try {
          const result: unknown = JSON.parse(output.toString('utf8'))
          if (!result || typeof result !== 'object' || !('version' in result) || result.version !== 1)
            throw new Error('Invalid Apple helper protocol response')
          resolve(result)
        } catch {
          reject(new Error('Invalid Apple helper protocol response'))
        }
      })
      child.stdin!.end(input)
    })
  }
}

export class AppleFoundationModelsAgent implements Model {
  private readonly options: AppleFoundationModelsOptions

  constructor(
    private readonly model: string,
    private readonly provider: Provider,
    options: AppleFoundationModelsOptions = {},
  ) {
    if (model !== 'system') throw new Error('Apple Foundation Models supports only the system model')
    if (provider.getHost() !== undefined) throw new Error('Apple Foundation Models does not use a host URL')
    this.options = {...options}
  }

  getModel(): string {
    return this.model
  }

  getName(suffix?: string): string {
    return formatOperatorName(OperatorType.Model, suffix)
  }

  getProvider(): string {
    return this.provider.getName()
  }

  async invoke(messages: Message[], options?: Partial<ModelInvokeOptions>): Promise<Message> {
    return this.prepare(messages, options).invoke()
  }

  prepare(messages: Message[], options?: Partial<ModelInvokeOptions>): PreparedModelInvocation {
    if (options?.tools?.length) throw new Error('Apple Foundation Models adapter does not support tools')
    if (options?.responseFormat !== undefined)
      throw new Error('Apple Foundation Models adapter does not support JSON formatting')
    if (options?.contextWindow !== undefined || this.provider.getContextWindow?.() !== undefined)
      throw new Error('Apple Foundation Models context window cannot be overridden')
    if (messages.length === 0 || messages.length > MAX_MESSAGES)
      throw new Error('Apple model requires 1 to 256 messages')
    let conversationStarted = false
    let lastRole = ''
    const projected = messages.map((message) => {
      if (message.type === MessageType.Tool || getToolResult(message) || getToolCalls(message).length > 0)
        throw new Error('Apple Foundation Models adapter does not support tool history')
      if (getModelOutputParts(message).some((part) => part.type !== 'text'))
        throw new Error('Apple Foundation Models adapter accepts text only')
      const role = message.role === 'developer' ? 'system' : message.role
      if (role === 'system') {
        if (conversationStarted) throw new Error('Apple instructions must precede the conversation')
      } else {
        if ((role !== 'user' && role !== 'assistant') || role === lastRole || (!conversationStarted && role !== 'user'))
          throw new Error('Apple conversation must alternate user and assistant messages')
        conversationStarted = true
        lastRole = role
      }

      return {content: message.contents.join('\n'), role}
    })
    if (lastRole !== 'user') throw new Error('Apple conversation must end with a user message')
    const cap = options?.maxOutputTokens ?? 1024
    if (!Number.isSafeInteger(cap) || cap < 1 || cap > 4096)
      throw new Error('Apple output cap must be between 1 and 4096 tokens')
    const request = freezeModelRequest(
      {maxOutputTokens: cap, messages: projected, operation: 'generate', version: 1},
      cap,
    )
    if (Buffer.byteLength(JSON.stringify(request)) > BYTE_LIMIT) throw new Error('Apple helper input exceeds 1 MiB')
    return {
      invoke: async () => {
        if (options?.signal?.aborted) throw new ModelAbortError('Apple model invocation cancelled')
        const startedAt = performance.now()
        const metadata = () => ({
          durationMs: performance.now() - startedAt,
          model: this.model,
          provider: this.getProvider(),
        })
        emitModelRequest(
          options,
          {messageCount: messages.length, model: this.model, provider: this.getProvider(), toolCount: 0},
          request,
        )
        try {
          const response = readResponse(await this.transport().request(request, options?.signal))
          if (typeof response.text !== 'string') throw new Error('Invalid Apple generation response')
          const content = response.text
          const details = {...metadata(), providerMetadata: {local: true, protocolVersion: 1}}
          emitModelResponse(options, {content, metadata: details, response, toolCalls: []})
          return new CoreMessage(MessageType.Assistant, {
            content,
            payload: {parts: [{text: content, type: 'text'}], response: details},
            previousMessage: messages.at(-1),
          })
        } catch (error) {
          emitModelFailure(options, metadata(), error)
          throw error
        }
      },
      request,
    }
  }

  async probeAvailability(signal?: AbortSignal): Promise<AppleAvailability> {
    const result = readResponse(await this.transport().request({operation: 'availability', version: 1}, signal))
    if (typeof result.available !== 'boolean' || (result.reason !== undefined && typeof result.reason !== 'string'))
      throw new Error('Invalid Apple availability response')
    return {available: result.available, ...(result.reason === undefined ? {} : {reason: result.reason as string})}
  }

  private transport(): AppleHelperTransport {
    if (this.options.transport) return this.options.transport
    if (process.platform !== 'darwin' || process.arch !== 'arm64')
      throw new Error('Apple Foundation Models requires an Apple silicon Mac with macOS 26 or newer')
    const helperPath = this.options.helperPath ?? process.env.ORBIT_APPLE_HELPER_PATH
    if (!helperPath) throw new Error('Set ORBIT_APPLE_HELPER_PATH to the explicitly compiled Apple helper')
    return new AppleHelperClient(helperPath, this.options.timeoutMs)
  }
}

function readResponse(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1)
    throw new Error('Invalid Apple helper protocol response')
  const response = value as Record<string, unknown>
  if (response.error !== undefined) {
    if (typeof response.error !== 'string' || !/^[a-z_]{1,64}$/u.test(response.error))
      throw new Error('Invalid Apple helper error response')
    if (response.error === 'context_overflow') throw new ContextOverflowError('Apple model context window exceeded')
    throw new Error(`Apple Foundation Models: ${response.error}`)
  }

  return response
}
