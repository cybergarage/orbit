// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'
import {z} from 'zod'

import type {
  AgentOptions,
  Model,
  ModelInvokeOptions,
  ThreadAgentFactory,
  ThreadEvent,
} from '../../src/core/index.js'

import {
  Agent,
  Message,
  MessageType,
  ModelAbortError,
  OperatorType,
  ThreadEventType,
  ThreadManager,
  ThreadStatus,
  tool,
} from '../../src/core/index.js'

describe('ThreadManager', () => {
  it('creates and lists serializable thread snapshots', async () => {
    const manager = new ThreadManager({createAgent: createAgentFactory(async () => assistantMessage('ok'))})

    const created = manager.createThread({id: 'thread-1'})

    expect(created).to.include({id: 'thread-1', status: ThreadStatus.Idle})
    expect(created.messages).to.deep.equal([])
    expect(manager.getThread('thread-1')).to.deep.equal(created)
    expect(manager.listThreads()).to.deep.equal([created])
    await manager.close()
  })

  it('preserves conversation history between GUI requests', async () => {
    const calls: Message[][] = []
    const manager = new ThreadManager({
      createAgent: createAgentFactory(async (messages) => {
        calls.push(messages)
        return assistantMessage(`reply-${calls.length}`)
      }),
    })
    manager.createThread({id: 'thread-1'})

    await manager.sendMessage('thread-1', 'first')
    await manager.sendMessage('thread-1', 'second')

    expect(calls.map((messages) => messages.map((message) => message.content))).to.deep.equal([
      ['first'],
      ['first', 'reply-1', 'second'],
    ])
    expect(manager.getThread('thread-1')?.messages.map((message) => message.content)).to.deep.equal([
      'first',
      'reply-1',
      'second',
      'reply-2',
    ])
    await manager.close()
  })

  it('emits typed run, model, message, and tool lifecycle events', async () => {
    const events: ThreadEvent[] = []
    let modelCallCount = 0
    const searchTool = tool(({query}: {query: string}) => `result:${query}`, {
      description: 'Search for a value.',
      name: 'search',
      schema: z.object({query: z.string()}),
    })
    const manager = new ThreadManager({
      createAgent: createAgentFactory(
        async () => {
          modelCallCount += 1
          if (modelCallCount === 1) {
            return new Message(MessageType.Assistant, {
              payload: {
                toolCalls: [{id: 'call-1', input: {query: 'orbit'}, name: 'search'}],
              },
            })
          }

          return assistantMessage('done')
        },
        {tools: [searchTool]},
      ),
      onEvent: (event) => events.push(event),
    })
    manager.createThread({id: 'thread-1'})

    await manager.sendMessage('thread-1', 'search')

    expect(events.map((event) => event.type)).to.deep.equal([
      ThreadEventType.RunStarted,
      ThreadEventType.ModelStarted,
      ThreadEventType.MessageCompleted,
      ThreadEventType.ToolStarted,
      ThreadEventType.ToolCompleted,
      ThreadEventType.ModelStarted,
      ThreadEventType.MessageCompleted,
      ThreadEventType.RunCompleted,
    ])
    const completedTool = events.find((event) => event.type === ThreadEventType.ToolCompleted)
    expect(completedTool).to.include({iteration: 0, threadId: 'thread-1'})
    if (completedTool?.type === ThreadEventType.ToolCompleted) {
      expect(completedTool.message.payload).to.deep.equal({
        input: {query: 'orbit'},
        isError: false,
        name: 'search',
        output: 'result:orbit',
        toolCallId: 'call-1',
      })
    }

    await manager.close()
  })

  it('cancels an active run by its event run id', async () => {
    let runId = ''
    const manager = new ThreadManager({
      createAgent: createAgentFactory(
        (_messages, options) =>
          new Promise((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () => reject(new Error('request aborted')), {once: true})
          }),
      ),
      onEvent(event) {
        if (event.type === ThreadEventType.RunStarted) runId = event.runId
      },
    })
    manager.createThread({id: 'thread-1'})

    const pending = manager.sendMessage('thread-1', 'wait')
    expect(runId).not.to.equal('')
    expect(manager.getThread('thread-1')?.status).to.equal(ThreadStatus.Running)
    expect(manager.cancelRun(runId)).to.equal(true)

    try {
      await pending
      throw new Error('Expected the thread run to be cancelled.')
    } catch (error) {
      expect(error).to.be.instanceOf(ModelAbortError)
    }

    expect(manager.getThread('thread-1')?.status).to.equal(ThreadStatus.Idle)
    expect(manager.cancelRun(runId)).to.equal(false)
    await manager.close()
  })

  it('rejects concurrent runs for the same thread', async () => {
    let release = noop
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const manager = new ThreadManager({
      createAgent: createAgentFactory(async () => {
        await gate
        return assistantMessage('done')
      }),
    })
    manager.createThread({id: 'thread-1'})

    const firstRun = manager.sendMessage('thread-1', 'first')
    try {
      await manager.sendMessage('thread-1', 'second')
      throw new Error('Expected the concurrent run to fail.')
    } catch (error) {
      expect((error as Error).message).to.equal('Thread is already running: thread-1')
    }

    release()
    await firstRun
    await manager.close()
  })

  it('aborts an active run before closing its agent', async () => {
    let closeCalls = 0
    const manager = new ThreadManager({
      createAgent: () => ({
        async close() {
          closeCalls += 1
        },
        async invoke(_messages, options) {
          return new Promise((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () => reject(new ModelAbortError('aborted')), {once: true})
          })
        },
      }),
    })
    manager.createThread({id: 'thread-1'})

    const pending = manager.sendMessage('thread-1', 'wait').catch((error: unknown) => error)
    expect(await manager.closeThread('thread-1')).to.equal(true)
    expect(await pending).to.be.instanceOf(ModelAbortError)
    expect(closeCalls).to.equal(1)
    expect(manager.getThread('thread-1')).to.equal(undefined)
  })
})

function noop(): void {}

function assistantMessage(content: string): Message {
  return new Message(MessageType.Assistant, {content})
}

function createAgentFactory(
  invoke: (messages: Message[], options?: Partial<ModelInvokeOptions>) => Promise<Message>,
  defaults: AgentOptions = {},
): ThreadAgentFactory {
  return (options) =>
    new Agent({
      ...defaults,
      ...options,
      deps: {
        ...defaults.deps,
        ...options.deps,
        createModel: (): Model => ({
          getModel() {
            return 'test-model'
          },
          getName() {
            return OperatorType.Model
          },
          getProvider() {
            return 'ollama'
          },
          invoke,
        }),
      },
      tools: [...(defaults.tools ?? []), ...(options.tools ?? [])],
    })
}
