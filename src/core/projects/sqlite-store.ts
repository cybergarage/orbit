// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import path from 'node:path'
import {Worker} from 'node:worker_threads'

import type {ProjectMutation, ProjectMutationResult, ProjectQuery, ProjectQueryResults, ProjectStore} from './types.js'

import {ProjectStoreError} from './types.js'

interface WorkerReply {
  error?: {code: ProjectStoreError['code']; message: string}
  id?: number
  ready?: boolean
  result?: unknown
}

/** Native SQLite is imported only inside this adapter's owned worker. */
export class SqliteProjectStore implements ProjectStore {
  private closePromise?: Promise<void>
  private closing = false
  private failure?: Error
  private nextId = 0
  private readonly pending = new Map<number, {reject(error: Error): void; resolve(value: unknown): void}>()
  private readonly ready: Promise<void>
  private readonly stopped: Promise<void>
  private readonly worker: Worker

  private constructor(
    file: string,
    private readonly queueLimit: number,
    timeout: number,
  ) {
    this.worker = new Worker(new URL('sqlite-worker.js', import.meta.url), {workerData: {file, timeout}})
    this.stopped = new Promise((resolve) => {
      this.worker.once('exit', () => resolve())
    })
    this.ready = new Promise((resolve, reject) => {
      const fail = (error: Error): void => {
        this.failure = error
        reject(error)
        for (const pending of this.pending.values()) pending.reject(error)
        this.pending.clear()
      }

      this.worker.on('error', fail)
      this.worker.on('exit', (code) => {
        if (!this.closing || code !== 0 || this.pending.size > 0)
          fail(new ProjectStoreError('storage', `Project worker exited (${code})`))
      })
      this.worker.on('message', (reply: WorkerReply) => {
        const error = reply.error ? new ProjectStoreError(reply.error.code, reply.error.message) : undefined
        if (reply.ready !== undefined) {
          if (error) fail(error)
          else resolve()
          return
        }

        const pending = this.pending.get(reply.id!)
        if (!pending) return
        this.pending.delete(reply.id!)
        if (error) pending.reject(error)
        else pending.resolve(reply.result)
      })
    })
  }

  static async open(options: {file: string; queueLimit?: number; timeoutMs?: number}): Promise<SqliteProjectStore> {
    const queue = options.queueLimit ?? 64
    const timeout = options.timeoutMs ?? 1000
    if (
      !path.isAbsolute(options.file) ||
      !Number.isInteger(queue) ||
      queue < 1 ||
      queue > 1024 ||
      !Number.isInteger(timeout) ||
      timeout < 1 ||
      timeout > 5000
    )
      throw new ProjectStoreError('invalid', 'Invalid project store options')
    const store = new SqliteProjectStore(options.file, queue, timeout)
    try {
      await store.ready
      return store
    } catch (error) {
      await store.worker.terminate()
      throw error
    }
  }

  async backup(destination: string): Promise<void> {
    await this.send({destination, kind: 'backup'})
  }

  close(): Promise<void> {
    this.closing = true
    this.closePromise ??= (async () => {
      try {
        await this.send({kind: 'close'}, true)
      } finally {
        await this.stopped
      }
    })()
    return this.closePromise
  }

  async mutate(operationId: string, mutation: ProjectMutation): Promise<ProjectMutationResult> {
    return (await this.send({kind: 'mutate', mutation, operationId})) as ProjectMutationResult
  }

  async query<Q extends ProjectQuery>(query: Q): Promise<ProjectQueryResults[Q['kind']]> {
    return (await this.send({kind: 'query', query})) as ProjectQueryResults[Q['kind']]
  }

  private send(message: object, closing = false): Promise<unknown> {
    if (this.failure) return Promise.reject(this.failure)
    if (this.closing && !closing) return Promise.reject(new ProjectStoreError('closed', 'Project store is closed'))
    if (!closing && this.pending.size >= this.queueLimit)
      return Promise.reject(new ProjectStoreError('busy', 'Project worker queue is full'))
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      this.pending.set(id, {reject, resolve})
      try {
        this.worker.postMessage({...message, id})
      } catch (error) {
        this.pending.delete(id)
        reject(error)
      }
    })
  }
}
