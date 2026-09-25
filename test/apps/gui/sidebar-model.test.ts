// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {expect} from 'chai'

import type {Project, ProjectMembership, SessionSummary} from '../../../src/core/index.js'

import {moveSidebarSession, type SidebarApi, SidebarModel} from '../../../src/apps/gui/sidebar-model.js'

const session = (id: string, updatedAt = '2026-09-25T00:00:00Z'): SessionSummary => ({
  createdAt: updatedAt,
  cwd: '/fixture',
  file: `/fixture/${id}.jsonl`,
  id,
  status: 'new',
  updatedAt,
})
const project = (id: string): Project => ({
  archived: false,
  createdAt: '',
  defaultDirectory: null,
  id,
  memoryGeneration: 0,
  name: id,
  revision: 1,
  updatedAt: '',
})
const member = (id: string, projectId: null | string): ProjectMembership => ({
  pairId: 'pair',
  projectId,
  revision: 3,
  sessionId: id,
  unavailable: false,
})
const mockApi =
  (handler: (path: string, init?: Parameters<SidebarApi>[1]) => Promise<unknown>): SidebarApi =>
  async <T>(path: string, init?: Parameters<SidebarApi>[1]) =>
    (await handler(path, init)) as T

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return {promise, resolve}
}

describe('GUI sidebar lists and membership', () => {
  it('loads independent project groups and only unassigned chats in Recent', async () => {
    const requests: string[] = []
    const model = new SidebarModel(
      mockApi(async (path) => {
        requests.push(path)
        if (path.startsWith('/api/projects?')) return {data: [project('a'), project('b')], enabled: true}
        if (path.startsWith('/api/unassigned?'))
          return {data: [session('recent-old'), session('recent-new', '2026-09-25T01:00:00Z')]}
        const id = path.includes('/a/') ? 'a' : 'b'
        return {data: [{membership: member(id, id), session: session(id), unavailable: false}]}
      }),
      () => {},
    )
    await model.refresh()
    expect(model.groups[''].sessions.map((s) => s.id)).deep.equals(['recent-new', 'recent-old'])
    expect(model.groups.a.sessions.map((s) => s.id)).deep.equals(['a'])
    expect(model.groups.b.sessions.map((s) => s.id)).deep.equals(['b'])
    expect(requests.some((path) => path.startsWith('/api/sessions?'))).equals(false)
    model.toggle('a')
    expect(model.expanded.has('a')).equals(false)
    expect(model.expanded.has('b')).equals(true)
  })

  it('keeps pagination cursors scoped and deduplicates loaded sessions', async () => {
    const paths: string[] = []
    const model = new SidebarModel(
      mockApi(async (path) => {
        paths.push(path)
        if (path.startsWith('/api/unassigned')) return {data: [session('recent')], nextCursor: 'recent-cursor'}
        const more = path.includes('after=project-cursor')
        return {
          data: (more ? ['a', 'b'] : ['a']).map((id) => ({
            membership: member(id, 'p'),
            session: session(id),
            unavailable: false,
          })),
          nextCursor: more ? undefined : 'project-cursor',
        }
      }),
      () => {},
    )
    model.enabled = true
    await model.loadGroup('p')
    await model.loadGroup(null)
    await model.loadGroup('p', true)
    expect(model.groups.p.sessions.map((s) => s.id)).deep.equals(['a', 'b'])
    expect(model.groups[''].cursor).equals('recent-cursor')
    expect(paths.at(-1)).includes('after=project-cursor')
    await model.loadGroup(null, true)
    expect(paths.at(-1)).includes('cursor=recent-cursor')
  })

  it('ignores an older response that arrives after a refreshed list', async () => {
    const old = deferred<unknown>()
    let calls = 0
    const model = new SidebarModel(
      mockApi(async () => (++calls === 1 ? old.promise : {data: [session('new')]})),
      () => {},
    )
    const pending = model.loadGroup(null)
    await model.loadGroup(null)
    old.resolve({data: [session('old')]})
    await pending
    expect(model.groups[''].sessions.map((s) => s.id)).deep.equals(['new'])
  })

  it('discards an old pagination response after a refresh', async () => {
    const oldPage = deferred<unknown>()
    let initial = true
    const model = new SidebarModel(
      mockApi(async (path) => {
        if (path.includes('cursor=old-page')) return oldPage.promise
        if (initial) {
          initial = false
          return {data: [session('old')], nextCursor: 'old-page'}
        }

        return {data: [session('fresh')]}
      }),
      () => {},
    )
    await model.loadGroup(null)
    const pending = model.loadGroup(null, true)
    await model.loadGroup(null)
    oldPage.resolve({data: [session('stale-more')]})
    await pending
    expect(model.groups[''].sessions.map((s) => s.id)).deep.equals(['fresh'])
    expect(model.groups['']).not.to.have.property('error')
  })

  it('propagates rejected membership changes without reporting success', async () => {
    const api = mockApi(async () => {
      throw new Error('Active conversations cannot be moved')
    })
    try {
      await moveSidebarSession(api, {
        destination: 'target',
        membership: member('active', 'source'),
        operationId: 'move-active',
        sessionId: 'active',
      })
      expect.fail('Expected the server rejection')
    } catch (error) {
      expect((error as Error).message).equals('Active conversations cannot be moved')
    }
  })

  it('does not mix active and archived catalogs when requests complete out of order', async () => {
    const old = deferred<unknown>()
    const model = new SidebarModel(
      mockApi(async (path) => {
        if (path.includes('archived=false')) return old.promise
        if (path.includes('archived=true')) return {data: [project('archived')], enabled: true}
        return {data: []}
      }),
      () => {},
    )
    const pending = model.refresh()
    model.archived = true
    await model.refresh()
    old.resolve({data: [project('active')], enabled: true})
    await pending
    expect(model.projects.map((p) => p.id)).deep.equals(['archived'])
  })

  it('retains list failures for retry and keeps pending and unavailable entries distinct', async () => {
    let fail = true
    const model = new SidebarModel(
      mockApi(async (path) => {
        if (fail) throw new Error('Temporary failure')
        if (path.startsWith('/api/sessions?'))
          return {data: [{...session('pending'), pendingProjectCreation: true, pendingProjectId: 'p'}]}
        return {data: [{membership: member('missing', 'p'), session: null, unavailable: true}]}
      }),
      () => {},
    )
    await model.loadGroup('p')
    expect(model.groups.p.error).equals('Temporary failure')
    expect(model.groups.p.loading).equals(false)
    fail = false
    await model.loadGroup('p')
    await model.loadGroup(null)
    expect(model.groups.p).not.to.have.property('error')
    expect(model.groups.p.unavailable).deep.equals(['missing'])
    expect(model.groups[''].sessions[0].pendingProjectId).equals('p')
  })

  it('fetches every destination catalog page and falls back when projects are disabled', async () => {
    const paths: string[] = []
    const model = new SidebarModel(
      mockApi(async (path) => {
        paths.push(path)
        if (path.includes('after=a')) return {data: [project('b')], enabled: true}
        return {data: [project('a')], enabled: true, nextCursor: 'a'}
      }),
      () => {},
    )
    expect((await model.allProjects(false)).data.map((p) => p.id)).deep.equals(['a', 'b'])
    expect(paths[1]).includes('after=a')
    const disabled = new SidebarModel(
      mockApi(async (path) =>
        path.startsWith('/api/projects?') ? {data: [], enabled: false} : {data: [session('legacy')]},
      ),
      () => {},
    )
    await disabled.refresh()
    expect(disabled.enabled).equals(false)
    expect(disabled.groups[''].sessions[0].id).equals('legacy')
  })

  it('moves the context-menu target with its own source and revision, including detach and retries', async () => {
    const requests: {body: Record<string, unknown>; path: string}[] = []
    const api = mockApi(async (path, init) => {
      const body = JSON.parse(init!.body as string)
      requests.push({body, path})
      return {...member('right-clicked', body.projectId), revision: 4}
    })
    const source = member('right-clicked', 'source')
    await moveSidebarSession(api, {
      destination: 'destination',
      membership: source,
      operationId: 'retry-id',
      sessionId: 'right-clicked',
    })
    await moveSidebarSession(api, {
      destination: 'destination',
      membership: source,
      operationId: 'retry-id',
      sessionId: 'right-clicked',
    })
    expect(requests[0]).deep.equals(requests[1])
    expect(requests[0].path).equals('/api/sessions/right-clicked/membership')
    expect(requests[0].body).deep.equals({
      expectedRevision: 3,
      operationId: 'retry-id',
      projectId: 'destination',
      sourceProjectId: 'source',
    })
    await moveSidebarSession(api, {
      destination: null,
      membership: source,
      operationId: 'detach-id',
      sessionId: 'right-clicked',
    })
    expect(requests[2].body.projectId).equals(null)
    await moveSidebarSession(api, {
      destination: 'destination',
      membership: null,
      operationId: 'attach-id',
      sessionId: 'unassigned',
    })
    expect(requests[3].body).includes({expectedRevision: 0, sourceProjectId: null})
  })
})
