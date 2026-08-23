// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import type {SessionEntry, SessionHeaderEntry} from './entries.js'

import {encodeSessionEntry} from './codec.js'

const openSessionFiles = new Set<string>()

export class SessionRecorder {
  public readonly file: string
  private closed = false
  private queue: Promise<void> = Promise.resolve()

  private constructor(file: string) {
    this.file = path.resolve(file)
  }

  static create(file: string, header: SessionHeaderEntry): SessionRecorder {
    const resolvedFile = path.resolve(file)
    reserveFile(resolvedFile)
    try {
      fsSync.mkdirSync(path.dirname(resolvedFile), {mode: 0o700, recursive: true})
      fsSync.writeFileSync(resolvedFile, encodeSessionEntry(header), {flag: 'wx', mode: 0o600})
      return new SessionRecorder(resolvedFile)
    } catch (error) {
      openSessionFiles.delete(resolvedFile)
      throw error
    }
  }

  static isOpen(file: string): boolean {
    return openSessionFiles.has(path.resolve(file))
  }

  static open(file: string): SessionRecorder {
    const resolvedFile = path.resolve(file)
    reserveFile(resolvedFile)
    if (!fsSync.existsSync(resolvedFile)) {
      openSessionFiles.delete(resolvedFile)
      throw new Error(`Session file does not exist: ${resolvedFile}`)
    }

    return new SessionRecorder(resolvedFile)
  }

  append(entry: SessionEntry): void {
    if (this.closed) throw new Error(`Session recorder is closed: ${this.file}`)
    const encoded = encodeSessionEntry(entry)
    this.queue = this.queue.then(() => fs.appendFile(this.file, encoded, {encoding: 'utf8'}))
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    try {
      await this.queue
    } finally {
      openSessionFiles.delete(this.file)
    }
  }

  async flush(): Promise<void> {
    await this.queue
  }
}

function reserveFile(file: string): void {
  if (openSessionFiles.has(file)) throw new Error(`Session file is already open for writing: ${file}`)
  openSessionFiles.add(file)
}
