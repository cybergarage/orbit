// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {Router} from 'express'
import {z} from 'zod'

import type {LocalScheduler} from './local-scheduler.js'

export function schedulingRoutes(scheduler?: LocalScheduler): Router {
  const router = Router() // eslint-disable-line new-cap
  router.use(['/schedules', '/scheduled-runs'], (_request, response, next) => {
    if (!scheduler) {
      response.status(503).json({error: 'Local scheduling is unavailable in this host.'})
      return
    }

    next()
  })
  router.get('/schedules', (_request, response) => response.json(scheduler!.snapshot()))
  router.post('/schedules', async (request, response) =>
    response.status(201).json({id: await scheduler!.create(request.body)}),
  )
  router.patch('/schedules/:id', (request, response) => {
    const {paused} = z.object({paused: z.boolean()}).strict().parse(request.body)
    scheduler!.pause(request.params.id, paused)
    response.json({paused})
  })
  router.delete('/schedules/:id', (request, response) => {
    scheduler!.remove(request.params.id)
    response.json({deleted: true})
  })
  router.post('/scheduled-runs/:id/cancel', (request, response) => {
    scheduler!.cancel(request.params.id)
    response.status(202).json({requested: true})
  })
  router.post('/scheduled-runs/:id/reconcile', (request, response) => {
    const body = z
      .object({confirmedStopped: z.literal(true), evidence: z.string().trim().min(1).max(2000)})
      .strict()
      .parse(request.body)
    scheduler!.reconcile(request.params.id, body.evidence, body.confirmedStopped)
    response.json({reconciled: true})
  })
  return router
}
