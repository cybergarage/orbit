// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {CatalogBackend, CatalogRows, CatalogTable} from './engine.js'
import type {ProjectMutation, ProjectMutationResult, ProjectQuery, ProjectQueryResults, ProjectStore} from './types.js'

import {CatalogEngine} from './engine.js'
import {ProjectStoreError} from './types.js'

/** Isolated transactional adapter for tests and ephemeral hosts. */
export class MemoryProjectStore implements ProjectStore {
  private closed = false
  private readonly engine: CatalogEngine
  private rows = new Map<string, CatalogRows[CatalogTable]>()

  constructor() {
    const backend: CatalogBackend = {
      get: <T extends CatalogTable>(table: T, key: string) =>
        structuredClone(this.rows.get(`${table}/${key}`) ?? null) as CatalogRows[T] | null,
      list: <T extends CatalogTable>(table: T, filter: Parameters<CatalogBackend['list']>[1] = {}) => {
        const result = [...this.rows]
          .filter(([key]) => key.startsWith(`${table}/`))
          .map(([, row]) => structuredClone(row))
        const id = (row: CatalogRows[CatalogTable]): string =>
          'sessionId' in row && table === 'memberships' ? row.sessionId : (row as {id: string}).id
        return result
          .filter(
            (row) =>
              (!filter.after || id(row) > filter.after) &&
              (filter.archived === undefined || ('archived' in row && row.archived === filter.archived)) &&
              (filter.projectId === undefined || ('projectId' in row && row.projectId === filter.projectId)) &&
              (filter.pairId === undefined || ('pairId' in row && row.pairId === filter.pairId)),
          )
          .sort((a, b) => (id(a) < id(b) ? -1 : id(a) === id(b) ? 0 : 1))
          .slice(0, filter.limit) as CatalogRows[T][]
      },
      put: (table, key, row) => {
        this.rows.set(`${table}/${key}`, structuredClone(row))
      },
      transaction: (work, write) => {
        const before = write ? structuredClone(this.rows) : this.rows
        try {
          return work()
        } catch (error) {
          this.rows = before
          throw error
        }
      },
    }
    this.engine = new CatalogEngine(backend)
  }

  async close(): Promise<void> {
    this.closed = true
  }

  async mutate(operationId: string, mutation: ProjectMutation): Promise<ProjectMutationResult> {
    this.assertOpen()
    return structuredClone(this.engine.mutate(operationId, mutation))
  }

  async query<Q extends ProjectQuery>(query: Q): Promise<ProjectQueryResults[Q['kind']]> {
    this.assertOpen()
    return structuredClone(this.engine.query(query))
  }

  private assertOpen(): void {
    if (this.closed) throw new ProjectStoreError('closed', 'Project store is closed')
  }
}
