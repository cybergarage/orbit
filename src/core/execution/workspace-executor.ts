// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import type {BashToolInput} from '../tools/builtins/bash.js'
import type {EditToolInput} from '../tools/builtins/edit.js'
import type {GlobToolInput} from '../tools/builtins/glob.js'
import type {GrepToolInput} from '../tools/builtins/grep.js'
import type {ListToolInput} from '../tools/builtins/list.js'
import type {ReadToolInput} from '../tools/builtins/read.js'
import type {WriteToolInput} from '../tools/builtins/write.js'
import type {ToolDefinition, ToolResult} from '../tools/definition.js'

import {copyJSON} from './journal.js'

interface WorkspaceInputs {
  bash: BashToolInput
  edit: EditToolInput
  glob: GlobToolInput
  grep: GrepToolInput
  list: ListToolInput
  read: ReadToolInput
  write: WriteToolInput
}

type Name = keyof WorkspaceInputs
type ReadonlyInput<T> = {
  readonly [K in keyof T]: T[K] extends infer V ? (V extends string[] ? readonly string[] : V) : never
}
type ExecutionDetails<N extends Name> = N extends 'bash'
  ? {readonly effect: 'command'}
  : N extends 'edit' | 'write'
    ? {readonly effect: 'write'; readonly preimageSha256: null | string; readonly resultSha256: string}
    : {readonly effect: 'read'}

/** Core-reviewed input in the host's canonical workspace namespace. */
export type PreparedWorkspaceOperation = {
  [N in Name]: ExecutionDetails<N> & {
    readonly cwd: string
    readonly input: ReadonlyInput<WorkspaceInputs[N]>
    readonly name: N
    readonly target: string
    readonly version: 1
  }
}[Name]

/** Trusted application dependency; this is not a sandbox, policy, or tool catalog. */
export interface WorkspaceExecutor {
  execute(operation: PreparedWorkspaceOperation, signal: AbortSignal): Promise<ToolResult>
  /** Only these managed built-ins use this executor; omitted means all. */
  readonly toolNames?: readonly PreparedWorkspaceOperation['name'][]
}

export function captureWorkspaceExecutor(value: undefined | WorkspaceExecutor): undefined | WorkspaceExecutor {
  if (value === undefined) return undefined
  if (typeof value?.execute !== 'function') throw new Error('Invalid workspace executor')
  const selected = value.toolNames
  if (selected === undefined) return Object.freeze({execute: value.execute.bind(value)})
  if (!Array.isArray(selected)) throw new Error('Invalid workspace executor tool names')
  const toolNames = Object.freeze([...selected])
  if (toolNames.some((name) => !names.has(name)) || new Set(toolNames).size !== toolNames.length)
    throw new Error('Invalid workspace executor tool names')
  return Object.freeze({execute: value.execute.bind(value), toolNames})
}

const names = new Set<string>(['bash', 'edit', 'glob', 'grep', 'list', 'read', 'write'])
const registered = new WeakMap<ToolDefinition, Name>()
const MAX_BYTES = 1024 * 1024

/** Runtime-only registration, not inferred from tool name, schema, or model input. */
export function markWorkspaceBuiltin(definition: ToolDefinition): void {
  if (names.has(definition.spec.name)) registered.set(definition, definition.spec.name as Name)
}

export function copyWorkspaceBuiltin(source: ToolDefinition, target: ToolDefinition): void {
  const name = registered.get(source)
  if (name !== undefined) registered.set(target, name)
}

export function isWorkspaceBuiltin(definition: ToolDefinition, toolNames?: WorkspaceExecutor['toolNames']): boolean {
  const name = registered.get(definition)
  return (
    name !== undefined &&
    name === definition.spec.name &&
    definition.source.kind === 'builtin' &&
    (toolNames === undefined || toolNames.includes(name))
  )
}

export function boundWorkspaceOperation(value: PreparedWorkspaceOperation): PreparedWorkspaceOperation {
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_BYTES) throw new Error('Workspace operation exceeds byte limit')
  return Object.freeze(value)
}

/** Detach trusted backend output before it is journaled or exposed to the model. */
export function boundWorkspaceResult(value: ToolResult): ToolResult {
  const result = copyJSON(value)
  if (
    !Array.isArray(result.content) ||
    result.content.some((part) => part.type !== 'text' || typeof part.text !== 'string') ||
    (result.isError !== undefined && typeof result.isError !== 'boolean') ||
    Buffer.byteLength(JSON.stringify(result)) > MAX_BYTES
  )
    throw new Error('Invalid workspace execution result')
  return result
}
