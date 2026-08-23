// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {randomUUID} from 'node:crypto'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import type {SessionEntry, SessionHeaderEntry} from './entries.js'

import {encodeSessionEntry} from './codec.js'

const openSessionFiles = new Set<string>()

interface SessionLock {
  pid: number
  token: string
}

export class SessionRecorder {
  public readonly file: string
  private closed = false
  private readonly lock: SessionLock
  private queue: Promise<void> = Promise.resolve()

  private constructor(file: string, lock: SessionLock) {
    this.file = path.resolve(file)
    this.lock = lock
  }

  static create(file: string, header: SessionHeaderEntry): SessionRecorder {
    const resolvedFile = path.resolve(file)
    fsSync.mkdirSync(path.dirname(resolvedFile), {mode: 0o700, recursive: true})
    const lock = reserveFile(resolvedFile)
    try {
      fsSync.writeFileSync(resolvedFile, encodeSessionEntry(header), {flag: 'wx', mode: 0o600})
      return new SessionRecorder(resolvedFile, lock)
    } catch (error) {
      releaseFile(resolvedFile, lock)
      throw error
    }
  }

  static isOpen(file: string): boolean {
    const resolvedFile = path.resolve(file)
    return openSessionFiles.has(resolvedFile) || isLocked(resolvedFile)
  }

  static open(file: string, prepare?: () => void): SessionRecorder {
    const resolvedFile = path.resolve(file)
    const lock = reserveFile(resolvedFile)
    try {
      if (!fsSync.existsSync(resolvedFile)) {
        throw new Error(`Session file does not exist: ${resolvedFile}`)
      }

      prepare?.()
      return new SessionRecorder(resolvedFile, lock)
    } catch (error) {
      releaseFile(resolvedFile, lock)
      throw error
    }
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
      releaseFile(this.file, this.lock)
    }
  }

  async flush(): Promise<void> {
    await this.queue
  }
}

function reserveFile(file: string): SessionLock {
  if (openSessionFiles.has(file)) throw new Error(`Session file is already open for writing: ${file}`)
  openSessionFiles.add(file)
  try {
    return acquireLock(file)
  } catch (error) {
    openSessionFiles.delete(file)
    throw error
  }
}

function acquireLock(file: string): SessionLock {
  const lock: SessionLock = {pid: process.pid, token: randomUUID()}
  const lockFile = lockFilePath(file)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fsSync.writeFileSync(lockFile, `${JSON.stringify(lock)}\n`, {flag: 'wx', mode: 0o600})
      return lock
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = readLock(lockFile)
      if (existing === undefined || isProcessAlive(existing.pid)) {
        throw new Error(`Session file is already open for writing: ${file}`)
      }

      try {
        fsSync.unlinkSync(lockFile)
      } catch (unlinkError) {
        if ((unlinkError as NodeJS.ErrnoException).code !== 'ENOENT') throw unlinkError
      }
    }
  }

  throw new Error(`Session file is already open for writing: ${file}`)
}

function isLocked(file: string): boolean {
  const lockFile = lockFilePath(file)
  if (!fsSync.existsSync(lockFile)) return false
  const lock = readLock(lockFile)
  if (lock === undefined || isProcessAlive(lock.pid)) return true
  try {
    fsSync.unlinkSync(lockFile)
    return false
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ENOENT'
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

function lockFilePath(file: string): string {
  return `${file}.lock`
}

function readLock(lockFile: string): SessionLock | undefined {
  try {
    const value = JSON.parse(fsSync.readFileSync(lockFile, 'utf8')) as Partial<SessionLock>
    if (!Number.isSafeInteger(value.pid) || (value.pid as number) <= 0 || typeof value.token !== 'string') return
    return {pid: value.pid as number, token: value.token}
  } catch {}
}

function releaseFile(file: string, lock: SessionLock): void {
  openSessionFiles.delete(file)
  const lockFile = lockFilePath(file)
  const current = readLock(lockFile)
  if (current?.token !== lock.token) return
  try {
    fsSync.unlinkSync(lockFile)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}
