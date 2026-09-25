// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

/* global RequestInit */
import type {Project, ProjectMembership, SessionSummary} from '../../core/index.js'

export type SidebarApi = <T>(pathname: string, init?: RequestInit) => Promise<T>
export type SidebarSession = SessionSummary & {pendingProjectCreation?: boolean; pendingProjectId?: string}
export interface SessionGroup {
  cursor?: string
  error?: string
  loading: boolean
  sessions: SidebarSession[]
  unavailable: string[]
}

/** Independent request generations prevent stale refreshes and pagination from replacing newer lists. */
export class SidebarModel {
  archived = false
  catalogError?: string
  catalogLoading = false
  enabled = false
  expanded = new Set<string>()
  groups: Record<string, SessionGroup> = {}
  projects: Project[] = []
  private catalogVersion = 0
  private versions = new Map<string, number>()

  constructor(
    private api: SidebarApi,
    private changed: () => void,
  ) {}

  async allProjects(archived: boolean): Promise<{data: Project[]; enabled: boolean}> {
    const data: Project[] = []
    let after: string | undefined
    let enabled = false
    do {
      // Catalog pages are ordered by ID, so fetch them serially.
      // eslint-disable-next-line no-await-in-loop
      const page = await this.api<{data: Project[]; enabled: boolean; nextCursor?: string}>(
        `/api/projects?archived=${archived}&limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`,
      )
      data.push(...page.data)
      enabled = page.enabled
      after = page.nextCursor
    } while (after)

    return {data, enabled}
  }

  async loadGroup(projectId: null | string, more = false): Promise<void> {
    const key = projectId ?? ''
    const previous: SessionGroup = this.groups[key] ?? {loading: false, sessions: [], unavailable: []}
    if (more && (!previous.cursor || previous.loading)) return
    const version = (this.versions.get(key) ?? 0) + 1
    this.versions.set(key, version)
    const cursor = more ? previous.cursor : undefined
    this.groups[key] = {
      ...previous,
      error: undefined,
      loading: true,
      sessions: previous.sessions,
      unavailable: previous.unavailable,
    }
    this.changed()
    try {
      const {cursor: nextCursor, sessions, unavailable} = await this.queryGroup(projectId, cursor)

      if (this.versions.get(key) !== version) return
      const combined = new Map((more ? previous.sessions : []).map((s) => [s.id, s]))
      for (const session of sessions) combined.set(session.id, session)
      this.groups[key] = {
        cursor: nextCursor,
        loading: false,
        sessions: [...combined.values()].sort(
          (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
        ),
        unavailable: [...new Set([...(more ? previous.unavailable : []), ...unavailable])],
      }
    } catch (error) {
      if (this.versions.get(key) !== version) return
      this.groups[key] = {
        ...this.groups[key],
        error: error instanceof Error ? error.message : String(error),
        loading: false,
      }
    }

    this.changed()
  }

  async refresh(): Promise<void> {
    const version = ++this.catalogVersion
    this.catalogLoading = true
    this.catalogError = undefined
    this.changed()
    try {
      const result = await this.allProjects(this.archived)
      if (version !== this.catalogVersion) return
      this.enabled = result.enabled
      this.projects = result.data
      for (const project of this.projects) {
        if (!this.groups[project.id]) this.expanded.add(project.id)
      }
    } catch (error) {
      if (version !== this.catalogVersion) return
      this.catalogError = error instanceof Error ? error.message : String(error)
    } finally {
      if (version === this.catalogVersion) {
        this.catalogLoading = false
        this.changed()
      }
    }

    if (version !== this.catalogVersion) return
    await Promise.all([
      this.loadGroup(null),
      ...this.projects.filter((p) => this.expanded.has(p.id)).map((p) => this.loadGroup(p.id)),
    ])
  }

  toggle(projectId: string): void {
    if (this.expanded.has(projectId)) this.expanded.delete(projectId)
    else {
      this.expanded.add(projectId)
      this.loadGroup(projectId)
    }

    this.changed()
  }

  private async queryGroup(
    projectId: null | string,
    cursor?: string,
  ): Promise<Pick<SessionGroup, 'cursor' | 'sessions' | 'unavailable'>> {
    const suffix = cursor ? `&${projectId ? 'after' : 'cursor'}=${encodeURIComponent(cursor)}` : ''
    let sessions: SidebarSession[]
    let unavailable: string[] = []
    let nextCursor: string | undefined
    if (projectId) {
      const page = await this.api<{
        data: {membership: ProjectMembership; session: null | SessionSummary; unavailable: boolean}[]
        nextCursor?: string
      }>(`/api/projects/${encodeURIComponent(projectId)}/sessions?limit=20${suffix}`)
      sessions = page.data.flatMap((row) => (row.session && !row.unavailable ? [row.session] : []))
      unavailable = page.data.filter((row) => row.unavailable || !row.session).map((row) => row.membership.sessionId)
      nextCursor = page.nextCursor
    } else {
      const page = await this.api<{data: SidebarSession[]; nextCursor?: string}>(
        `${this.enabled ? '/api/unassigned' : '/api/sessions'}?limit=20${suffix}`,
      )
      sessions = page.data
      nextCursor = page.nextCursor
    }

    return {cursor: nextCursor, sessions, unavailable}
  }
}

export async function moveSidebarSession(
  api: SidebarApi,
  {
    destination,
    membership,
    operationId,
    sessionId,
  }: {
    destination: null | string
    membership: null | ProjectMembership
    operationId: string
    sessionId: string
  },
): Promise<ProjectMembership> {
  return api<ProjectMembership>(`/api/sessions/${encodeURIComponent(sessionId)}/membership`, {
    body: JSON.stringify({
      expectedRevision: membership?.revision ?? 0,
      operationId,
      projectId: destination,
      sourceProjectId: membership?.projectId ?? null,
    }),
    headers: {'Content-Type': 'application/json'},
    method: 'POST',
  })
}
