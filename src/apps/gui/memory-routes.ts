// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {Router as createRouter, type Router} from 'express'
import {z} from 'zod'

import type {OrbitApplicationService} from '../../core/application.js'
import type {ProjectMemoryEntry} from '../../core/projects/types.js'

import {parseMemorySelection} from '../../core/projects/memory-context.js'
import {ProjectStoreError} from '../../core/projects/types.js'

const id = z.string().uuid()
const sourceId = z.string().regex(/^[A-Za-z0-9_-]{1,160}$/u)
const write = z
  .object({body: z.string().min(1).max(8192), operationId: id, title: z.string().trim().min(1).max(256)})
  .strict()

export function memoryRoutes(service: OrbitApplicationService): Router {
  const router = createRouter()
  const memory = () => {
    if (!service.projectMemory) throw new ProjectStoreError('missing', 'Project memory is not configured')
    return service.projectMemory
  }

  const changed = async (entry: ProjectMemoryEntry) => {
    const project = await service.projects!.store.query({id: entry.projectId, kind: 'project'})
    service.diagnostics.emit({
      data: {
        entryId: entry.id,
        generation: project!.memoryGeneration,
        projectId: entry.projectId,
        revision: entry.revision,
      },
      type: 'project.memory.changed',
    })
    return entry
  }

  router.get('/projects/:projectId/memory', async (request, response) => {
    memory()
    const projectId = id.parse(request.params.projectId)
    const query = z
      .object({
        after: id.optional(),
        limit: z.coerce.number().int().min(1).max(200).default(100),
        retired: z.enum(['true', 'false', 'all']).default('false'),
      })
      .strict()
      .parse(request.query)
    const data = await service.projects!.store.query({
      after: query.after,
      kind: 'memories',
      limit: query.limit,
      projectId,
      ...(query.retired === 'all' ? {} : {retired: query.retired === 'true'}),
    })
    response.json({data, ...(data.length === query.limit ? {nextCursor: data.at(-1)!.id} : {})})
  })
  router.post('/projects/:projectId/memory', async (request, response) => {
    response
      .status(201)
      .json(await changed(await memory().create(id.parse(request.params.projectId), write.parse(request.body))))
  })
  router.post('/projects/:projectId/memory/excerpts', async (request, response) => {
    const input = write
      .omit({body: true})
      .extend({
        body: z.string().min(1).max(8192).optional(),
        excerpt: z.string().min(1).max(8192),
        messageId: sourceId,
        sessionId: sourceId,
      })
      .strict()
      .parse(request.body)
    response.status(201).json(await changed(await memory().saveExcerpt(id.parse(request.params.projectId), input)))
  })
  router.patch('/projects/:projectId/memory/:entryId', async (request, response) => {
    response.json(
      await changed(
        await memory().edit(
          id.parse(request.params.projectId),
          id.parse(request.params.entryId),
          write
            .extend({expectedRevision: z.number().int().positive(), retired: z.boolean()})
            .strict()
            .parse(request.body),
        ),
      ),
    )
  })
  router.post('/threads/:threadId/memory/preview', async (request, response) => {
    response.json(
      await service.previewProjectMemory(sourceId.parse(request.params.threadId), parseMemorySelection(request.body)),
    )
  })
  router.get('/sessions/:sessionId/project-context', async (request, response) => {
    response.json(await service.projectContextHistory(sourceId.parse(request.params.sessionId)))
  })
  return router
}
