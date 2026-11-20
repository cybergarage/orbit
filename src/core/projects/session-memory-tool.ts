// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {Model} from '../models/model.js'
import type {Session} from '../session/session.js'
import type {ToolDefinition, ToolResult} from '../tools/definition.js'
import type {ProjectMemoryService, ProjectSearchBinding} from './memory-service.js'

import {AppleProjectMemoryAgent} from '../models/adapters/apple-memory.js'
import {AppleFoundationModelsAgent} from '../models/adapters/apple.js'
import {canIncludeModelTools, resolveModelCapabilities} from '../models/capabilities.js'
import {textToolResult} from '../tools/definition.js'
import {createLeasedProjectMemorySearchTool} from './memory-search-tool.js'
import {sameSearchBinding} from './registered-pair-search.js'

const NAME = 'project_memory_search'

export type ProjectMemorySearchPermission = (scope: Readonly<{projectId: string; sessionId: string}>) => boolean

export interface SessionMemoryTool {
  check(signal?: AbortSignal): Promise<void>
  close(): void
  definition: ToolDefinition
  namedOnly: boolean
}

function permitted(permit: ProjectMemorySearchPermission, binding: ProjectSearchBinding): boolean {
  try {
    return permit(Object.freeze({projectId: binding.projectId, sessionId: binding.sessionId})) === true
  } catch {
    return false
  }
}

async function modelAllows(model: Model, signal?: AbortSignal): Promise<boolean> {
  const info = await resolveModelCapabilities(model, {signal})
  if (
    model.getProvider() === 'apple' ||
    model instanceof AppleProjectMemoryAgent ||
    model instanceof AppleFoundationModelsAgent
  )
    return model instanceof AppleProjectMemoryAgent && info.namedTools?.includes(NAME) === true
  return canIncludeModelTools(info)
}

/** Run-local adapter around the canonical factory; never mutates Agent defaults. */
export async function createSessionMemoryTool(options: {
  getModel: () => Model
  memory?: ProjectMemoryService
  permit?: ProjectMemorySearchPermission
  session: Session
  signal: AbortSignal
}): Promise<SessionMemoryTool | undefined> {
  const {getModel, memory, permit, session, signal} = options
  if (!permit) return undefined
  if (!memory) throw new Error('Automatic memory search requires the configured Project memory service')
  const binding = await memory.resolveSearchBinding(session, signal)
  if (!binding || !permitted(permit, binding)) return undefined
  const model = getModel()
  const identity = {model: model.getModel(), provider: model.getProvider()}
  if (!(await modelAllows(model, signal))) return undefined
  const checkIdentity = () => {
    if (
      !permitted(permit, binding) ||
      getModel() !== model ||
      model.getModel() !== identity.model ||
      model.getProvider() !== identity.provider
    )
      throw new Error('Automatic memory search permission or model changed')
  }

  const checkBinding = async (currentSignal: AbortSignal) => {
    const current = await memory.resolveSearchBinding(session, currentSignal)
    if (!sameSearchBinding(binding, current)) throw new Error('Automatic memory search membership changed')
  }

  const check = async (currentSignal = signal) => {
    currentSignal.throwIfAborted()
    checkIdentity()
    await checkBinding(currentSignal)
    if (!(await modelAllows(model, currentSignal))) throw new Error('Automatic memory search model capability changed')
    await checkBinding(currentSignal)
    checkIdentity()
  }

  await check()
  const original = createLeasedProjectMemorySearchTool(memory, session, binding)
  const guarded = async (execute: () => Promise<ToolResult>, currentSignal: AbortSignal) => {
    try {
      await check(currentSignal)
      const result = await execute()
      await check(currentSignal)
      return result
    } catch {
      // A settled read has no unknown external write outcome. Discard its evidence.
      return textToolResult('Project memory search is unavailable or no longer permitted', {isError: true})
    }
  }

  const definition: ToolDefinition = {
    ...original,
    execute: (input, context) => guarded(() => original.execute(original.input.parse(input), context), context.signal),
    async prepare(input, context) {
      await check(context.signal)
      const prepared = await original.prepare!(original.input.parse(input), context)
      return {
        ...prepared,
        execute: () => guarded(prepared.execute, context.signal),
        async revalidate() {
          try {
            await check(context.signal)
            return await prepared.revalidate()
          } catch {
            return false
          }
        },
      }
    },
  }
  return {
    check,
    close() {
      if (model instanceof AppleProjectMemoryAgent) model.close()
    },
    definition,
    namedOnly: model instanceof AppleProjectMemoryAgent,
  }
}
