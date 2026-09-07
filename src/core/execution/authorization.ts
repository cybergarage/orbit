// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {randomUUID} from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import type {ToolDefinition, ToolExecutionContext, ToolResult} from '../tools/definition.js'
import type {RunContext} from './run.js'

import {resolveShell} from '../tools/builtins/bash.js'
import {textToolResult} from '../tools/definition.js'
import {copyJSON} from './journal.js'

export type OperationEffect = 'command' | 'mcp' | 'opaque' | 'read' | 'write'
export interface PreparedOperation {
  binding: Record<string, unknown>
  cwd: string
  effect: OperationEffect
  id: string
  input: unknown
  name: string
  preview: Record<string, unknown>
  runId: string
  sessionId: string
  targets: string[]
  variant: 'mcp-startup' | 'tool-call'
  version: 1
}
export interface OperationPreparation {
  binding: Record<string, unknown>
  effect: OperationEffect
  execute(): Promise<ToolResult>
  preview: Record<string, unknown>
  revalidate(): Promise<boolean>
  targets: string[]
}
export interface ExecutionPolicy {
  /** Application-owned rules may narrow the product profile, never model text. */
  decide?: (operation: Readonly<PreparedOperation>) => 'allow' | 'ask' | 'deny'
  generation: string
  profile: 'unrestricted' | 'workspace-confirm'
  revoked?: () => boolean
  roots: readonly string[]
}
export interface ManagedToolOptions {
  allowLegacyTools?: boolean
  policy: ExecutionPolicy
}

const serverOwners = new Map<string, RunContext>()
const resourceOwners = new Map<string, RunContext>()

export async function canonicalPath(file: string): Promise<string> {
  try {
    return await fs.realpath(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const parent = path.dirname(file)
    if (parent === file) throw error
    return path.join(await canonicalPath(parent), path.basename(file))
  }
}

export async function allowedPath(file: string, policy: ExecutionPolicy): Promise<boolean> {
  if (policy.profile === 'unrestricted') return true
  const target = await canonicalPath(path.resolve(file))
  for (const root of policy.roots) {
    // Resolve each declared root before deciding containment.
    // eslint-disable-next-line no-await-in-loop
    const resolved = await canonicalPath(path.resolve(root))
    const relative = path.relative(resolved, target)
    if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)))
      return true
  }

  return false
}

export function assertManagedTool(definition: ToolDefinition, options: ManagedToolOptions): void {
  if (
    definition.source.kind === 'custom' &&
    !definition.prepare &&
    !(options.policy.profile === 'unrestricted' && options.allowLegacyTools)
  )
    throw new Error(`Tool requires a trusted preparation adapter: ${definition.spec.name}`)
}

export async function executeManagedTool(
  run: RunContext,
  definition: ToolDefinition,
  input: unknown,
  context: ToolExecutionContext,
  options: ManagedToolOptions,
): Promise<ToolResult> {
  const id = randomUUID()
  let preparation: OperationPreparation
  let parsed: unknown
  try {
    assertManagedTool(definition, options)
    parsed = copyJSON(definition.input.parse(copyJSON(input)))
    preparation = definition.prepare
      ? await run.wait('prepare', definition.prepare(parsed, context))
      : await run.wait('prepare', prepareDefault(definition, parsed, context, options.policy))
  } catch (error) {
    if (run.signal.aborted) throw error
    run.operations.push({id, status: 'invalid'})
    await run.record('operation-result', {operationId: id, status: 'invalid'})
    return textToolResult('Invalid or unauthorized operation preparation', {isError: true})
  }

  const descriptor: PreparedOperation = {
    binding: {
      ...preparation.binding,
      callId: context.callId,
      catalog: run.catalogIdentity() ?? '',
      iteration: context.iteration ?? 0,
      policy: options.policy.generation,
      source: copyJSON(definition.source),
    },
    cwd: context.cwd,
    effect: preparation.effect,
    id,
    input: copyJSON(parsed),
    name: definition.spec.name,
    preview: redactPreview(preparation.preview),
    runId: run.id,
    sessionId: run.options.sessionId,
    targets: preparation.targets,
    variant: 'tool-call',
    version: 1,
  }
  return executePrepared(run, descriptor, preparation, options.policy)
}

export async function executePrepared(
  run: RunContext,
  descriptor: PreparedOperation,
  preparation: OperationPreparation,
  policy: ExecutionPolicy,
): Promise<ToolResult> {
  const operation = freezeJSON(copyJSON({...descriptor, preview: redactPreview(descriptor.preview)}))
  const digest = run.journal.digest(operation)
  let decision: 'allow' | 'ask' | 'deny' =
    policy.profile === 'unrestricted' ? 'allow' : operation.effect === 'read' ? 'allow' : 'ask'
  if (policy.revoked?.()) decision = 'deny'
  // Resolve each declared root before deciding containment.
  // eslint-disable-next-line no-await-in-loop
  for (const target of operation.targets) if (!(await allowedPath(target, policy))) decision = 'deny'
  if (decision !== 'deny' && policy.decide) {
    try {
      decision = policy.decide(operation)
    } catch {
      decision = 'deny'
    }
  }

  let expiresAt = Infinity
  let authorization: string = randomUUID()
  if (decision === 'ask' && operation.effect === 'opaque' && !('input' in operation.preview)) decision = 'deny'
  if (decision === 'ask') {
    const answer = await run.ask(operation.id, digest, operation.preview, policy.generation)
    decision = answer.granted ? 'allow' : 'deny'
    expiresAt = answer.expiresAt
    authorization = answer.requestId
  } else
    await run.record('authorization-decided', {
      decision,
      digest,
      operationId: operation.id,
      policy: policy.generation,
      requestId: authorization,
    })
  if (decision !== 'allow') {
    run.operations.push({id: operation.id, status: 'denied'})
    await run.record('operation-result', {operationId: operation.id, status: 'denied'})
    return textToolResult('Operation denied or approval unavailable', {isError: true})
  }

  if (operation.effect === 'mcp') {
    const source = operation.binding.source as undefined | {server?: string}
    const server = String(operation.binding.server ?? source?.server ?? operation.name)
    const owner = serverOwners.get(server)
    if (owner && owner !== run) return notStarted(run, operation.id)
    if (!owner) {
      serverOwners.set(server, run)
      run.retain(() => {
        if (serverOwners.get(server) === run) serverOwners.delete(server)
      })
    }
  }

  // A whole-workspace lease also covers opaque shell/custom effects. Retain it if work remains unknown.
  const resources = await Promise.all([operation.cwd, ...operation.targets].map((target) => canonicalPath(target)))

  for (const resource of resources)
    for (const [reserved, owner] of resourceOwners) {
      if (owner !== run && (overlaps(resource, reserved) || overlaps(reserved, resource)))
        return notStarted(run, operation.id)
    }

  for (const resource of resources)
    if (!resourceOwners.has(resource)) {
      resourceOwners.set(resource, run)
      run.retain(() => {
        if (resourceOwners.get(resource) === run) resourceOwners.delete(resource)
      })
    }

  const valid = async () => !policy.revoked?.() && Date.now() < expiresAt && preparation.revalidate()
  if (!(await valid())) return notStarted(run, operation.id)
  run.check()
  await run.record('operation-intent', {
    authorization,
    budget: {...run.budget},
    ...(operation.variant === 'tool-call'
      ? {call: run.journal.digest(operation.binding.callId ?? operation.id), catalog: run.catalogIdentity()}
      : {}),
    digest,
    effect: operation.effect,
    operationId: operation.id,
    source: run.journal.digest(operation.binding.source ?? operation.binding.configuration ?? operation.name),
    variant: operation.variant,
  })
  if (!(await valid())) return notStarted(run, operation.id)
  run.check()
  if (policy.revoked?.() || Date.now() >= expiresAt) return notStarted(run, operation.id)
  const outcome = {id: operation.id, status: 'unknown' as 'failed' | 'succeeded' | 'unknown'}
  run.operations.push(outcome)
  // No await between the final checks, registration, and the trusted executor invocation.
  let resolve!: (value: ToolResult) => void
  let reject!: (error: unknown) => void
  const execution = new Promise<ToolResult>((done, fail) => {
    resolve = done
    reject = fail
  })
  run.track(`dispatch:${operation.id}`, execution)
  try {
    preparation.execute().then(resolve, reject)
  } catch (error) {
    reject(error)
  }

  try {
    const result = await run.wait(
      `operation:${operation.id}`,
      execution.then((result) => {
        outcome.status = result.isError ? 'failed' : 'succeeded'
        return result
      }),
    )
    await run.record('operation-result', {
      operationId: operation.id,
      outputDigest: run.journal.digest(result),
      status: outcome.status,
    })
    return result
  } catch (error) {
    if (!run.signal.aborted) {
      // Arbitrary executor rejection cannot establish external completion.
      run.requestStop(outcome.status === 'unknown' ? 'unknown-operation' : 'runtime-failed')
    }

    throw error
  }
}

async function notStarted(run: RunContext, id: string): Promise<ToolResult> {
  run.operations.push({id, status: 'cancelled-before-start'})
  await run.record('operation-result', {operationId: id, status: 'cancelled-before-start'})
  return textToolResult('Operation changed or expired; prepare a new request', {isError: true})
}

async function prepareDefault(
  definition: ToolDefinition,
  input: unknown,
  context: ToolExecutionContext,
  policy: ExecutionPolicy,
): Promise<OperationPreparation> {
  const value =
    input !== null && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {}
  const preparedContext = {...context, cwd: await canonicalPath(context.cwd)}
  const {name} = definition.spec
  const builtin = definition.source.kind === 'builtin'
  const effect: OperationEffect =
    definition.source.kind === 'mcp'
      ? 'mcp'
      : builtin
        ? name === 'bash'
          ? 'command'
          : name === 'edit' || name === 'write'
            ? 'write'
            : 'read'
        : 'opaque'
  const target = await canonicalPath(path.resolve(context.cwd, typeof value.path === 'string' ? value.path : '.'))
  if (!(await allowedPath(target, policy))) throw new Error('Path outside configured roots')
  if (builtin && (name === 'glob' || name === 'grep')) {
    const patterns = name === 'glob' ? value.pattern : value.glob
    for (const pattern of Array.isArray(patterns) ? patterns : [patterns]) {
      if (typeof pattern === 'string' && (path.isAbsolute(pattern) || pattern.includes('..') || pattern.includes('\\')))
        throw new Error('Search patterns must stay within their declared base')
    }
  }

  let before: null | string = null
  let after: string | undefined
  if (effect === 'write') {
    // Preimage inspection is itself constrained by the read policy.
    const probe: PreparedOperation = {
      binding: {},
      cwd: context.cwd,
      effect: 'read',
      id: context.callId,
      input: {path: target},
      name: 'read',
      preview: {},
      runId: '',
      sessionId: '',
      targets: [target],
      variant: 'tool-call',
      version: 1,
    }
    if (policy.decide && policy.decide(probe) !== 'allow')
      throw new Error('Preparation read requires separate authorization')
    before = await readPreimage(target)
    if (name === 'write') after = String(value.content)
    else {
      if (before === null || typeof value.oldText !== 'string' || value.oldText.length === 0)
        throw new Error('Invalid edit preimage')
      const count = before.split(value.oldText).length - 1
      if (!count || (count > 1 && value.replaceAll !== true)) throw new Error('Ambiguous edit')
      after = value.replaceAll
        ? before.split(value.oldText).join(String(value.newText))
        : before.replace(value.oldText, () => String(value.newText))
      if (after === before) throw new Error('Unchanged edit')
    }
  }

  const frozenInput = freezeJSON(copyJSON(builtin ? {...value, ...(name === 'bash' ? {} : {path: target})} : input))
  const shell = effect === 'command' ? resolveShell() : undefined
  const environment =
    effect === 'command'
      ? Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
        )
      : undefined
  const binding = {
    target,
    ...(shell ? {environment: environment!, shell} : {}),
    ...(effect === 'write' ? {after: after!, before} : {}),
  }
  return {
    binding,
    effect,
    execute: () =>
      definition.execute(frozenInput, {
        ...preparedContext,
        ...(shell ? {preparedEnvironment: environment, preparedShell: shell} : {}),
      }),
    preview: builtin
      ? {
          name,
          ...(frozenInput as Record<string, unknown>),
          ...(effect === 'write' ? {after: after!, before} : {}),
          ...(effect === 'command'
            ? {warning: 'This command is not OS-sandboxed and may change files or access the network.'}
            : {}),
        }
      : {
          name,
          source: definition.source,
          ...(effect === 'mcp' ? {input: frozenInput} : {}),
          warning: 'External effects; no OS sandbox is supplied.',
        },
    async revalidate() {
      if (
        (await canonicalPath(path.resolve(context.cwd, typeof value.path === 'string' ? value.path : '.'))) !== target
      )
        return false
      return effect !== 'write' || (await readPreimage(target)) === before
    },
    targets: [target],
  }
}

async function readPreimage(file: string): Promise<null | string> {
  try {
    return await fs.readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/** Display redaction is separate from the full keyed execution binding. */
export function redactPreview(value: Record<string, unknown>): Record<string, unknown> {
  const sensitive = /token|secret|password|credential|authorization|api.?key/iu
  const visit = (item: unknown, key = ''): unknown => {
    if (sensitive.test(key)) return '[redacted]'
    if (Array.isArray(item)) return item.map((child) => visit(child))
    if (item && typeof item === 'object')
      return Object.fromEntries(Object.entries(item).map(([name, child]) => [name, visit(child, name)]))
    if (typeof item === 'string') {
      let text = item
      for (const [name, secret] of Object.entries(process.env))
        if (sensitive.test(name) && secret && secret.length >= 4) text = text.split(secret).join('[redacted]')
      return text.replaceAll(/((?:token|password|secret|api[_-]?key)\s*[=:]\s*)[^\s,;]+/giu, '$1[redacted]')
    }

    return item
  }

  return visit(value) as Record<string, unknown>
}

function freezeJSON<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeJSON(child)
    Object.freeze(value)
  }

  return value
}

function overlaps(left: string, right: string): boolean {
  const relative = path.relative(left, right)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}
