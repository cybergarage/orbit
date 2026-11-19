// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {createHash} from 'node:crypto'
import {z} from 'zod'

import type {Message} from '../../message/index.js'
import type {Model, ModelInvokeOptions, PreparedModelInvocation} from '../model.js'
import type {Provider} from '../provider.js'
import type {AppleMemoryChannel, AppleMemoryChannelFactory, AppleMemoryFrame} from './apple-memory-ipc.js'

import {Message as CoreMessage, MessageType} from '../../message/index.js'
import {freezeModelRequest} from '../prepared.js'
import {appleMemoryNonce, createAppleMemoryChannel} from './apple-memory-ipc.js'
import {AppleFoundationModelsAgent} from './apple.js'
import {getToolCalls, getToolResult, isToolResultError, stringifyToolOutput} from './tools.js'

const TOOL = 'project_memory_search'
const inputSchema = z
  .object({limit: z.number().int().min(1).max(16), query: z.string().trim().min(1).max(512)})
  .strict()
const callSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/u),
    input: inputSchema,
    name: z.literal(TOOL),
    nonce: z.string(),
    type: z.literal('call'),
    version: z.literal(2),
  })
  .strict()

export interface AppleProjectMemoryOptions {
  /** Explicit dependency injection for protocol tests. No executable tool handlers. */
  channelFactory?: AppleMemoryChannelFactory
  helperPath?: string
  maxCalls?: number
  timeoutMs?: number
}

/** Explicit fixed-tool route; the existing Apple adapter stays text-only. */
export class AppleProjectMemoryAgent implements Model {
  private active?: {
    channel: AppleMemoryChannel
    expectedHistory: string
    ids: Set<string>
    nonce: string
    pending?: {id: string; input: z.infer<typeof inputSchema>}
  }

  constructor(
    private readonly provider: Provider,
    private readonly options: AppleProjectMemoryOptions,
  ) {
    if (provider.getHost() !== undefined) throw new Error('Apple memory does not use a host URL')
    const max = options.maxCalls ?? 4
    if (!Number.isSafeInteger(max) || max < 1 || max > 4) throw new Error('Apple memory permits 1 to 4 calls')
  }

  close() {
    this.active?.channel.close()
    this.active = undefined
  }

  async getCapabilities(options: {signal?: AbortSignal} = {}) {
    options.signal?.throwIfAborted()
    // This is deliberately not general-purpose tool support.
    return {namedTools: [TOOL], source: 'adapter' as const, tools: 'unsupported' as const}
  }

  getModel() {
    return 'system'
  }

  getName() {
    return 'Model:apple-project-memory'
  }

  getProvider() {
    return this.provider.getName()
  }

  async invoke(messages: Message[], options?: Partial<ModelInvokeOptions>): Promise<Message> {
    return this.prepare(messages, options).invoke()
  }

  prepare(messages: Message[], options?: Partial<ModelInvokeOptions>): PreparedModelInvocation {
    if (options?.tools?.length !== 1 || options.tools[0].name !== TOOL)
      throw new Error('Apple memory requires only the explicitly registered project_memory_search tool')
    if (
      options.responseFormat !== undefined ||
      options.contextWindow !== undefined ||
      this.provider.getContextWindow?.() !== undefined
    )
      throw new Error('Apple memory does not support format or context overrides')
    if (messages.length === 0 || messages.length > 256) throw new Error('Apple memory requires 1 to 256 messages')
    // Freeze caller input. A prepared invocation is single-use.
    const history = fingerprint(messages)
    const request = freezeModelRequest({
      maxOutputTokens: options.maxOutputTokens ?? 1024,
      messages: messages.map(({contents, payload, role}) => ({content: contents.join('\n'), payload, role})),
      operation: 'project-memory',
      toolNames: [TOOL],
      version: 2,
    })
    if (Buffer.byteLength(JSON.stringify(request)) > 1_048_576) throw new Error('Apple memory input exceeds limit')
    let used = false
    return {
      invoke: async () => {
        if (used) throw new Error('Apple memory prepared invocation already consumed')
        used = true
        if (fingerprint(messages) !== history) throw new Error('Apple memory input changed after preparation')
        const abort = this.close.bind(this)
        options.signal?.addEventListener('abort', abort, {once: true})
        try {
          options.signal?.throwIfAborted()
          if (this.active) {
            this.resume(messages)
          } else {
            await this.start(messages, options)
          }

          const active = this.active!
          const frame = await active.channel.next()
          this.checkEnvelope(frame, active.nonce)
          if (frame.type === 'error') throw new Error('Apple memory native generation failed')
          if (frame.type === 'call') {
            const parsed = callSchema.safeParse(frame)
            if (!parsed.success || active.ids.has(parsed.data.id) || active.ids.size >= (this.options.maxCalls ?? 4))
              throw new Error('Invalid Apple memory tool call')
            const {id, input, name} = parsed.data
            active.ids.add(id)
            active.pending = {id, input}
            const message = this.response(messages, '', {toolCalls: [{id, input, name}]})
            active.expectedHistory = fingerprint([...messages, message])
            return message
          }

          if (frame.type !== 'final' || typeof frame.text !== 'string' || Buffer.byteLength(frame.text) > 65_536)
            throw new Error('Invalid Apple memory final response')
          const transcript = z
            .object({
              calls: z.number().int().min(0).max(4),
              correlated: z.boolean().optional(),
              outputs: z.number().int().min(0).max(4),
            })
            .strict()
            .safeParse(frame.transcript)
          const message = this.response(messages, frame.text, {
            nativeTranscript: transcript.success ? transcript.data : undefined,
          })
          this.close()
          return message
        } catch (error) {
          this.close()
          throw error
        } finally {
          options.signal?.removeEventListener('abort', abort)
        }
      },
      request,
    }
  }

  private checkEnvelope(frame: AppleMemoryFrame, nonce: string) {
    if (frame.version !== 2 || frame.nonce !== nonce) throw new Error('Invalid Apple memory protocol envelope')
  }

  private response(messages: Message[], text: string, extra: Record<string, unknown>) {
    const toolCalls = extra.toolCalls as undefined | {id: string; input: unknown; name: string}[]
    return new CoreMessage(MessageType.Assistant, {
      content: text,
      payload: {
        parts: toolCalls?.map((toolCall) => ({toolCall, type: 'tool-call'})) ?? [{text, type: 'text'}],
        response: {
          durationMs: 0,
          model: 'system',
          provider: this.getProvider(),
          providerMetadata: {
            local: true,
            ...(extra.nativeTranscript === undefined ? {} : {nativeTranscript: extra.nativeTranscript}),
            protocolVersion: 2,
          },
          stopReason: toolCalls ? 'tool_calls' : 'stop',
        },
        ...(toolCalls ? {toolCalls} : {}),
      },
      previousMessage: messages.at(-1),
    })
  }

  private resume(messages: Message[]) {
    const active = this.active!
    const {pending} = active
    if (!pending || fingerprint(messages.slice(0, -1)) !== active.expectedHistory)
      throw new Error('Apple memory continuation does not match this generation')
    const result = getToolResult(messages.at(-1)!)
    if (
      !result ||
      result.toolCallId !== pending.id ||
      result.name !== TOOL ||
      JSON.stringify(result.input) !== JSON.stringify(pending.input)
    )
      throw new Error('Apple memory result correlation failed')
    if (isToolResultError(result)) throw new Error('Apple memory search was denied or failed')
    const text = stringifyToolOutput(result.output)
    if (Buffer.byteLength(text) > 65_536) throw new Error('Apple memory result exceeds limit')
    active.pending = undefined
    active.channel.send({id: pending.id, nonce: active.nonce, text, type: 'result', version: 2})
  }

  private async start(messages: Message[], options: Partial<ModelInvokeOptions>) {
    // Reuse all v1 text/role/output-cap validation, without invoking the v1 helper.
    const validated = new AppleFoundationModelsAgent('system', this.provider).prepare(messages, {
      ...options,
      tools: [],
    }).request
    if (messages.some((message) => getToolCalls(message).length > 0 || getToolResult(message)))
      throw new Error('Apple memory cannot replay tool history')
    const nonce = appleMemoryNonce()
    const initial = {...validated, maxCalls: this.options.maxCalls ?? 4, nonce, operation: 'generate', version: 2}
    const factory =
      this.options.channelFactory ?? createAppleMemoryChannel(this.options.helperPath ?? '', this.options.timeoutMs)
    const channel = factory(initial, options.signal)
    this.active = {channel, expectedHistory: '', ids: new Set(), nonce}
    const ready = await channel.next()
    this.checkEnvelope(ready, nonce)
    if (ready.type !== 'ready' || ready.tool !== TOOL) throw new Error('Apple memory helper is incompatible')
  }
}

function fingerprint(messages: Message[]): string {
  return createHash('sha256')
    .update(JSON.stringify(messages.map(({contents, payload, role, type}) => ({contents, payload, role, type}))))
    .digest('hex')
}
