// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {type RequestHandler, Router} from 'express'
import {z} from 'zod'

import type {InitializationPlan, InitializationProfile} from '../../core/maintenance/initialization.js'

import {executeInitialization, planInitialization} from '../../core/maintenance/initialization.js'

const requestSchema = z
  .object({mode: z.enum(['settings', 'data', 'all']), settingsFiles: z.array(z.string()).max(32)})
  .strict()
const consentSchema = z
  .object({
    allWritersStopped: z.literal(true),
    automaticRestartersDisabled: z.literal(true),
    confirmation: z.literal('INITIALIZE'),
    exclusiveStorageControl: z.literal(true),
    id: z.string(),
  })
  .strict()

/** A stopped GUI never reopens resources or resumes requests after an initialization attempt. */
export function initializationRoutes(profile: InitializationProfile | undefined, close: () => Promise<void>) {
  const router = Router() // eslint-disable-line new-cap
  let completed = false
  let inflight = 0
  let maintenance = false
  let stopping = false
  let drained: (() => void) | undefined
  let reviewed: InitializationPlan | undefined
  const admission: RequestHandler = (request, response, next) => {
    if (maintenance) {
      response.status(503).json({error: 'Initialization maintenance: restart this GUI before further work.'})
      return
    }

    if (request.path === '/events') {
      next()
      return
    }

    inflight++
    let finished = false
    const finish = () => {
      if (!finished) {
        finished = true
        inflight--
        if (inflight === 0) drained?.()
      }
    }

    response.once('finish', finish)
    response.once('close', finish)
    next()
  }

  router.use('/initialization', (_request, response, next) => {
    if (!profile) {
      response.status(503).json({error: 'Initialization is unavailable in this host.'})
      return
    }

    next()
  })
  router.get('/initialization', (_request, response) =>
    response.json({maintenance, settingsFiles: profile!.settingsFiles}),
  )
  const selected = (body: unknown) => {
    const input = requestSchema.parse(body)
    if (input.mode === 'data' && input.settingsFiles.length > 0)
      throw new Error('data mode does not accept settings files')
    if (input.settingsFiles.some((file) => !profile!.settingsFiles.includes(file)))
      throw new Error('Unknown settings source')
    return {mode: input.mode, profile: {...profile!, settingsFiles: input.settingsFiles}}
  }

  router.post('/initialization/plan', (request, response) => {
    const input = selected(request.body)
    response.json(planInitialization(input.profile, input.mode))
  })
  router.post('/initialization/prepare', async (request, response) => {
    const input = selected(request.body)
    if (stopping || completed) {
      response.status(409).json({error: 'Initialization is already in progress or completed'})
      return
    }

    stopping = true
    maintenance = true
    reviewed = undefined
    try {
      const drain = async () => {
        if (inflight > 0)
          await new Promise<void>((resolve) => {
            drained = resolve
          })
        await close()
      }

      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          drain(),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error('Runtime stop is unconfirmed; no data removed. Restart only after inspecting cleanup.'),
                ),
              30_000,
            )
          }),
        ])
      } finally {
        clearTimeout(timer)
      }

      reviewed = planInitialization(input.profile, input.mode)
      response.json(reviewed)
    } finally {
      stopping = false
    }
  })
  router.post('/initialization/execute', (request, response) => {
    const consent = consentSchema.parse(request.body)
    if (!reviewed || stopping || completed || consent.id !== reviewed.id) {
      response.status(409).json({error: 'Review a stopped-host plan first'})
      return
    }

    const plan = reviewed
    reviewed = undefined
    const result = executeInitialization(plan, consent)
    completed = true
    response.json({...result, restartRequired: true})
  })
  return {admission, router}
}
