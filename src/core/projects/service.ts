// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {randomUUID} from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import {z} from 'zod'

import type {CreateSessionOptions, SessionRepository} from '../session/repository.js'
import type {Session} from '../session/session.js'
import type {Project, ProjectMembership, ProjectMutation, ProjectReservation, ProjectStore} from './types.js'

import {WriterClaim} from '../session/coordination.js'
import {createSessionInformationFromSource} from '../session/information.js'
import {readProjectDeletion, readProjectSession} from './session-reader.js'
import {ProjectStoreError} from './types.js'

export interface ProjectSessionHost {
  closeThread(id: string): Promise<unknown>
  getThread(id: string): undefined | {run?: {quarantined?: boolean}; status: string}
}

/** Coordinates registered session ownership with catalog transactions. */
export class ProjectService {
  constructor(
    readonly store: ProjectStore,
    readonly repository: SessionRepository,
    private readonly host: ProjectSessionHost,
    private readonly startupDirectory: string,
  ) {}

  async changeMembership(
    sessionId: string,
    options: {
      expectedRevision: number
      operationId: string
      projectId: null | string
      sourceProjectId: null | string
      unavailable?: boolean
    },
  ): Promise<ProjectMembership> {
    const scope = this.repository.scope(sessionId)
    const mutation: ProjectMutation = {
      expectedRevision: options.expectedRevision,
      kind: 'membership',
      pairId: scope.pairId,
      projectId: options.projectId,
      sessionId,
      sourceProjectId: options.sourceProjectId,
      unavailable: options.unavailable ?? false,
    }
    if (await this.store.query({id: options.operationId, kind: 'operation'}))
      return (await this.store.mutate(options.operationId, mutation)) as ProjectMembership
    this.assertIdle(sessionId)
    await this.host.closeThread(sessionId)
    const guard = WriterClaim.acquire(scope, () => {})
    try {
      if (!(await readProjectSession(this.repository, sessionId)))
        throw new ProjectStoreError('missing', 'Session not found')
      return (await this.store.mutate(options.operationId, mutation)) as ProjectMembership
    } finally {
      guard.release()
    }
  }

  async create(options: {directory?: null | string; name: string; operationId: string}): Promise<Project> {
    const directory = options.directory ?? null
    if (directory !== null && !(await this.store.query({id: options.operationId, kind: 'operation'})))
      await this.directory(directory)
    return (await this.store.mutate(options.operationId, {
      directory,
      expectedRevision: 0,
      id: options.operationId,
      kind: 'create',
      name: options.name,
    })) as Project
  }

  /** Returns an owned, synchronized Session only after membership is committed. */
  async createSession(
    projectId: string,
    operationId: string,
    resolve: (cwd: string) => Promise<Omit<CreateSessionOptions, 'cwd' | 'id'>>,
  ): Promise<Session> {
    const scope = this.repository.scope(operationId)
    let reservation = await this.store.query({id: operationId, kind: 'reservation'})
    if (reservation && (reservation.projectId !== projectId || reservation.pairId !== scope.pairId))
      throw new ProjectStoreError('conflict', 'Project creation operation changed')
    if (!reservation) {
      const project = await this.store.query({id: projectId, kind: 'project'})
      if (!project) throw new ProjectStoreError('missing', 'Project not found')
      const cwd = project.defaultDirectory ?? this.startupDirectory
      await this.directory(cwd)
      reservation = (await this.store.mutate(operationId, {
        kind: 'reserve',
        reservation: {
          cwd,
          id: operationId,
          pairId: scope.pairId,
          projectId,
          projectRevision: project.revision,
          sessionId: operationId,
        },
      })) as ProjectReservation
    }

    const options = await resolve(reservation.cwd)
    const found = await readProjectSession(this.repository, reservation.sessionId)
    if (found && (found.parsed.header.cwd !== reservation.cwd || found.parsed.header.id !== reservation.sessionId))
      throw new ProjectStoreError('conflict', 'Reserved session header conflicts; retain it for inspection')
    let session: Session | undefined
    try {
      session = found
        ? this.repository.open(found.file)
        : this.repository.create({...options, cwd: reservation.cwd, id: reservation.sessionId})
      await session.synchronize(process.platform === 'win32' ? 'file-sync' : 'file-and-directory-sync')
      await this.store.mutate(randomUUID(), {kind: 'commit-reservation', reservationId: reservation.id})
      return session
    } catch (error) {
      await session?.close()
      throw new ProjectStoreError(
        'storage',
        `Project session creation incomplete; retry operation ${operationId}. Any unassigned session is retained. ${error instanceof Error ? error.message : ''}`,
      )
    }
  }

  async finishDeletion(sessionId: string): Promise<void> {
    const membership = await this.membership(sessionId)
    if (membership?.projectId)
      await this.store.mutate(randomUUID(), {
        expectedRevision: membership.revision,
        kind: 'membership',
        pairId: membership.pairId,
        projectId: null,
        sessionId,
        sourceProjectId: membership.projectId,
        unavailable: true,
      })
  }

  async listSessions(projectId: string, options: {after?: string; limit?: number} = {}) {
    if (!(await this.store.query({id: projectId, kind: 'project'})))
      throw new ProjectStoreError('missing', 'Project not found')
    const {pairId} = this.repository.scope('project-list')
    const limit = options.limit ?? 50
    const members = await this.store.query({after: options.after, kind: 'memberships', limit, pairId, projectId})
    const data = []
    for (const membership of members) {
      // A CLI deletion never opens the catalog; reconcile its acknowledged marker here.
      // eslint-disable-next-line no-await-in-loop
      if ((await readProjectDeletion(this.repository, membership.sessionId)) === 'completed') {
        this.assertIdle(membership.sessionId)
        // eslint-disable-next-line no-await-in-loop
        await this.host.closeThread(membership.sessionId)
        const guard = WriterClaim.acquire(this.repository.scope(membership.sessionId), () => {}, true)
        try {
          // eslint-disable-next-line no-await-in-loop
          if ((await readProjectDeletion(this.repository, membership.sessionId)) === 'completed') {
            // eslint-disable-next-line no-await-in-loop
            await this.finishDeletion(membership.sessionId)
            continue
          }
        } finally {
          guard.release()
        }
      }
      // Bound aggregate source parsing to one transcript at a time.

      const source = membership.unavailable
        ? null
        : // eslint-disable-next-line no-await-in-loop
          await readProjectSession(this.repository, membership.sessionId).catch((error: unknown) => {
            if (error instanceof ProjectStoreError && error.code === 'missing') return null
            throw error
          })
      const session = source
        ? {
            ...createSessionInformationFromSource({
              createdAt: source.parsed.header.timestamp,
              cwd: source.parsed.header.cwd,
              entries: source.parsed.entries.slice(1),
              id: membership.sessionId,
              model: source.parsed.header.model,
              originator: source.parsed.header.originator,
              provider: source.parsed.header.provider,
            }),
            file: source.file,
          }
        : null
      data.push({membership, session, unavailable: !session})
    }

    return {data, ...(members.length === limit ? {nextCursor: members.at(-1)!.sessionId} : {})}
  }

  async markDeleting(sessionId: string): Promise<void> {
    this.assertIdle(sessionId)
    await this.host.closeThread(sessionId)
    const scope = this.repository.scope(sessionId)
    const guard = WriterClaim.acquire(scope, () => {}, true)
    try {
      const membership = await this.membership(sessionId)
      if (membership?.projectId && !membership.unavailable)
        await this.store.mutate(randomUUID(), {
          expectedRevision: membership.revision,
          kind: 'membership',
          pairId: scope.pairId,
          projectId: membership.projectId,
          sessionId,
          sourceProjectId: membership.projectId,
          unavailable: true,
        })
    } finally {
      guard.release()
    }
  }

  async membership(sessionId: string): Promise<null | ProjectMembership> {
    return this.store.query({kind: 'membership', pairId: this.repository.scope(sessionId).pairId, sessionId})
  }

  async requireActive(sessionId: string): Promise<null | ProjectMembership> {
    const member = await this.membership(sessionId)
    if (
      !member &&
      z.string().uuid().safeParse(sessionId).success &&
      (await this.store.query({id: sessionId, kind: 'reservation'}))?.state === 'pending'
    )
      throw new ProjectStoreError('conflict', 'Project creation is incomplete; retry its original operation')
    if (member?.projectId) {
      const project = await this.store.query({id: member.projectId, kind: 'project'})
      if (!project || member.unavailable) throw new ProjectStoreError('missing', 'Project session is unavailable')
      if (project.archived) throw new ProjectStoreError('archived', 'Project is archived')
    }

    return member
  }

  async update(
    id: string,
    options: {archived: boolean; directory: null | string; expectedRevision: number; name: string; operationId: string},
  ): Promise<Project> {
    if (options.directory !== null && !(await this.store.query({id: options.operationId, kind: 'operation'})))
      await this.directory(options.directory)
    return (await this.store.mutate(options.operationId, {
      archived: options.archived,
      directory: options.directory,
      expectedRevision: options.expectedRevision,
      id,
      kind: 'update',
      name: options.name,
    })) as Project
  }

  private assertIdle(sessionId: string): void {
    const thread = this.host.getThread(sessionId)
    if (thread?.status === 'running' || thread?.run?.quarantined)
      throw new ProjectStoreError('busy', 'Session must be idle before changing membership')
  }

  private async directory(cwd: string): Promise<void> {
    if (!path.isAbsolute(cwd) || !(await fs.stat(cwd)).isDirectory())
      throw new ProjectStoreError('invalid', 'Project directory must be an available absolute directory')
  }
}
