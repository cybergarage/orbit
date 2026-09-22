// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import {parentPort, workerData} from 'node:worker_threads'

import type {CatalogBackend, CatalogRows, CatalogTable} from './engine.js'
import type {ProjectMutation, ProjectQuery} from './types.js'

import {CatalogEngine, validateCatalogRow} from './engine.js'
import {ProjectStoreError} from './types.js'

const port = parentPort!
const {file, timeout} = workerData as {file: string; timeout: number}
let db: Database.Database | undefined

function syncDirectory(directory: string): void {
  // Windows does not expose portable directory fsync through Node. Database
  // commits still use SQLite FULL; directory power-loss durability is not claimed.
  if (process.platform === 'win32') return
  const fd = fs.openSync(directory, 'r')
  try {
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}

function initialize(): CatalogEngine {
  const parent = path.dirname(file)
  const created = fs.mkdirSync(parent, {mode: 0o700, recursive: true})
  if (created) {
    let dir = parent
    while (true) {
      syncDirectory(dir)
      if (dir === path.dirname(created)) break
      dir = path.dirname(dir)
    }
  }

  try {
    const descriptor = fs.openSync(file, 'wx', 0o600)
    try {
      fs.fsyncSync(descriptor)
    } finally {
      fs.closeSync(descriptor)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }

  db = new Database(file, {timeout})
  db.pragma('foreign_keys = ON')
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = FULL')
  if (
    db.pragma('journal_mode', {simple: true}) !== 'wal' ||
    db.pragma('foreign_keys', {simple: true}) !== 1 ||
    db.pragma('synchronous', {simple: true}) !== 2
  )
    throw new ProjectStoreError('storage', 'Required SQLite durability settings unavailable')
  db.transaction(() => {
    const version = db!.pragma('user_version', {simple: true})
    if (version !== 0 && version !== 1) throw new ProjectStoreError('storage', 'Unsupported project catalog schema')
    if (version === 0) {
      if (
        (
          db!.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").get() as {
            count: number
          }
        ).count !== 0
      )
        throw new ProjectStoreError('storage', 'Unversioned nonempty project catalog')
      db!.exec(`
        CREATE TABLE projects (key TEXT PRIMARY KEY CHECK(length(key)=36), payload TEXT NOT NULL CHECK(json_valid(payload)), archived INTEGER NOT NULL CHECK(archived IN (0,1)));
        CREATE TABLE memberships (key TEXT PRIMARY KEY, payload TEXT NOT NULL CHECK(json_valid(payload)), projectId TEXT REFERENCES projects(key), pairId TEXT NOT NULL, sessionId TEXT NOT NULL, UNIQUE(pairId, sessionId));
        CREATE INDEX membership_project ON memberships(projectId, pairId, sessionId);
        CREATE TABLE memories (key TEXT PRIMARY KEY CHECK(length(key)=36), payload TEXT NOT NULL CHECK(json_valid(payload)), projectId TEXT NOT NULL REFERENCES projects(key));
        CREATE INDEX memory_project ON memories(projectId, key);
        CREATE TABLE reservations (key TEXT PRIMARY KEY CHECK(length(key)=36), payload TEXT NOT NULL CHECK(json_valid(payload)), projectId TEXT NOT NULL REFERENCES projects(key), pairId TEXT NOT NULL, sessionId TEXT NOT NULL, UNIQUE(pairId, sessionId));
        CREATE TABLE operations (key TEXT PRIMARY KEY CHECK(length(key)=36), payload TEXT NOT NULL CHECK(json_valid(payload)));
        PRAGMA user_version = 1;
      `)
    }
  }).exclusive()
  if (db.pragma('quick_check', {simple: true}) !== 'ok' || (db.pragma('foreign_key_check') as unknown[]).length > 0)
    throw new ProjectStoreError('storage', 'Corrupt project catalog')
  syncDirectory(parent)
  const backend: CatalogBackend = {
    get<T extends CatalogTable>(table: T, key: string): CatalogRows[T] | null {
      const row = db!.prepare(`SELECT payload FROM ${table} WHERE key = ?`).get(key) as undefined | {payload: string}
      return row ? validateCatalogRow(table, JSON.parse(row.payload)) : null
    },
    list<T extends CatalogTable>(table: T, filter: Parameters<CatalogBackend['list']>[1] = {}): CatalogRows[T][] {
      const clauses: string[] = []
      const params: (number | string)[] = []
      const order = table === 'memberships' ? 'sessionId' : 'key'
      if (filter.after) {
        clauses.push(`${order} > ?`)
        params.push(filter.after)
      }

      if (filter.archived !== undefined) {
        clauses.push('archived = ?')
        params.push(Number(filter.archived))
      }

      if (filter.projectId !== undefined) {
        if (filter.projectId === null) clauses.push('projectId IS NULL')
        else {
          clauses.push('projectId = ?')
          params.push(filter.projectId)
        }
      }

      if (filter.pairId !== undefined) {
        clauses.push('pairId = ?')
        params.push(filter.pairId)
      }

      const rows = db!
        .prepare(
          `SELECT payload FROM ${table}${clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY ${order} LIMIT ?`,
        )
        .all(...params, filter.limit ?? -1) as {payload: string}[]
      return rows.map((row) => validateCatalogRow(table, JSON.parse(row.payload)))
    },
    put(table, key, row) {
      const columns = ['key', 'payload']
      const values: (null | number | string)[] = [key, JSON.stringify(row)]
      if ('projectId' in row) {
        columns.push('projectId')
        values.push(row.projectId)
      }

      if ('pairId' in row) {
        columns.push('pairId', 'sessionId')
        values.push(row.pairId, row.sessionId)
      }

      if ('archived' in row) {
        columns.push('archived')
        values.push(Number(row.archived))
      }

      db!
        .prepare(
          `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')}) ON CONFLICT(key) DO UPDATE SET ${columns
            .slice(1)
            .map((column) => `${column}=excluded.${column}`)
            .join(',')}`,
        )
        .run(...values)
    },
    transaction: (work, write) => (write ? db!.transaction(work).immediate() : db!.transaction(work).deferred()),
  }
  return new CatalogEngine(backend)
}

try {
  const engine = initialize()
  port.postMessage({ready: true})
  let sequence = Promise.resolve()
  port.on(
    'message',
    (message: {
      destination?: string
      id: number
      kind: 'backup' | 'close' | 'mutate' | 'query'
      mutation?: ProjectMutation
      operationId?: string
      query?: ProjectQuery
    }) => {
      sequence = sequence.then(async () => {
        try {
          let result: unknown
          switch (message.kind) {
            case 'backup': {
              if (!message.destination || !path.isAbsolute(message.destination) || fs.existsSync(message.destination))
                throw new ProjectStoreError('invalid', 'Backup requires a new absolute destination')
              const reserved = fs.openSync(message.destination, 'wx', 0o600)
              fs.closeSync(reserved)
              await db!.backup(message.destination)
              const completed = fs.openSync(message.destination, 'r')
              try {
                fs.fsyncSync(completed)
              } finally {
                fs.closeSync(completed)
              }

              syncDirectory(path.dirname(message.destination))
              break
            }

            case 'close': {
              db!.close()
              break
            }

            case 'mutate': {
              result = engine.mutate(message.operationId!, message.mutation!)
              break
            }

            case 'query': {
              result = engine.query(message.query!)
              break
            }
          }

          port.postMessage({id: message.id, result})
          if (message.kind === 'close') port.close()
        } catch (error) {
          const code =
            error instanceof ProjectStoreError
              ? error.code
              : (error as {code?: string}).code === 'SQLITE_BUSY'
                ? 'busy'
                : 'storage'
          port.postMessage({
            error: {code, message: error instanceof Error ? error.message : 'Catalog operation failed'},
            id: message.id,
          })
          if (message.kind === 'close') port.close()
        }
      })
    },
  )
} catch (error) {
  db?.close()
  port.postMessage({
    error: {code: 'storage', message: error instanceof Error ? error.message : 'Catalog open failed'},
    ready: false,
  })
  port.close()
}
