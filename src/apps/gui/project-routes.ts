// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {Router as createRouter, type Router} from 'express'
import {z} from 'zod'

import type {OrbitApplicationService} from '../../core/application.js'

import {ProjectStoreError} from '../../core/projects/types.js'

const id = z.string().uuid()
const sessionId = z.string().regex(/^[A-Za-z0-9_-]{1,160}$/u)
const projectInput = z
  .object({directory: z.string().min(1).max(4096).nullable(), name: z.string().trim().min(1).max(256), operationId: id})
  .strict()
const moveInput = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    operationId: id,
    projectId: id.nullable(),
    sourceProjectId: id.nullable(),
  })
  .strict()

/** Mounted after the shared capability-token and origin middleware. */
export function projectRoutes(service: OrbitApplicationService): Router {
  const router = createRouter()
  const catalog = () => {
    if (!service.projects) throw new ProjectStoreError('missing', 'Project catalog is not configured')
    return service.projects
  }

  const changed = (projectId: null | string, revision: number) =>
    service.diagnostics.emit({data: {projectId, revision}, type: 'project.changed'})
  router.get('/projects', async (request, response) => {
    const query = z
      .object({
        after: id.optional(),
        archived: z.enum(['true', 'false']).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .strict()
      .parse(request.query)
    if (!service.projects) return response.json({data: [], enabled: false})
    const data = await catalog().store.query({
      after: query.after,
      archived: query.archived === 'true',
      kind: 'projects',
      limit: query.limit,
    })
    return response.json({data, enabled: true, ...(data.length === query.limit ? {nextCursor: data.at(-1)!.id} : {})})
  })
  router.post('/projects', async (request, response) => {
    const project = await catalog().create(projectInput.parse(request.body))
    changed(project.id, project.revision)
    response.status(201).json(project)
  })
  router.patch('/projects/:projectId', async (request, response) => {
    const project = await catalog().update(
      id.parse(request.params.projectId),
      projectInput.extend({archived: z.boolean(), expectedRevision: z.number().int().positive()}).parse(request.body),
    )
    changed(project.id, project.revision)
    response.json(project)
  })
  router.get('/projects/:projectId/sessions', async (request, response) => {
    const query = z
      .object({after: sessionId.optional(), limit: z.coerce.number().int().min(1).max(200).default(50)})
      .strict()
      .parse(request.query)
    response.json(await catalog().listSessions(id.parse(request.params.projectId), query))
  })
  router.post('/projects/:projectId/threads', async (request, response) => {
    response
      .status(201)
      .json(
        await service.createProjectThread(
          id.parse(request.params.projectId),
          z.object({operationId: id}).strict().parse(request.body),
        ),
      )
  })
  router.post('/projects/:projectId/sessions/:sessionId/resume', async (request, response) => {
    const projectId = id.parse(request.params.projectId)
    const sid = sessionId.parse(request.params.sessionId)
    const member = await catalog().membership(sid)
    if (member?.projectId !== projectId || member.unavailable)
      throw new ProjectStoreError('missing', 'Session does not belong to this Project')
    response.json(await service.resumeSession(sid))
  })
  router.get('/sessions/:sessionId/membership', async (request, response) => {
    response.json({
      membership: service.projects ? await catalog().membership(sessionId.parse(request.params.sessionId)) : null,
    })
  })
  router.post('/sessions/:sessionId/membership', async (request, response) => {
    const member = await catalog().changeMembership(
      sessionId.parse(request.params.sessionId),
      moveInput.parse(request.body),
    )
    changed(member.projectId, member.revision)
    response.json(member)
  })
  router.get('/unassigned', async (request, response) => {
    const query = z
      .object({cursor: z.string().max(160).optional(), limit: z.coerce.number().int().min(1).max(200).default(50)})
      .strict()
      .parse(request.query)
    const page = await service.listSessions(query)
    const items = await Promise.all(
      page.data.map(async (session) => {
        if (!service.projects) return {...session, pendingProjectCreation: false}
        const membership = await catalog().membership(session.id)
        if (membership?.projectId) return null
        const reservation = id.safeParse(session.id).success
          ? await catalog().store.query({id: session.id, kind: 'reservation'})
          : null
        return {
          ...session,
          pendingProjectCreation: reservation?.state === 'pending',
          pendingProjectId: reservation?.state === 'pending' ? reservation.projectId : undefined,
        }
      }),
    )
    response.json({...page, data: items.filter((item) => item !== null)})
  })
  return router
}
